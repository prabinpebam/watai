import { runAgentAttempt, type AgentAttemptInput, type AgentAttemptResult } from "./agentRunner.js";
import { mkdir, realpath } from "node:fs/promises";
import { isAbsolute, relative } from "node:path";
import { issueMeasuredUsageReceipt, type ProviderUsageReceiptIssuer } from "./copilotExecution.js";
import { ExecutionAttemptError, type ProviderUsageReceipt } from "./executionCoordinator.js";
import type { BudgetReservation, BudgetState, ClaimEffectCommand, EffectExecution } from "./execution.js";
import { GatewayService, type GatewayValidationRunner } from "./gatewayService.js";
import type { SqliteHarnessStore } from "./sqliteStore.js";
import type { LockedTaskSpec } from "./taskSpec.js";
import {
  prepareWorkerLaunch,
  type CredentialBrokerAttestation,
  type SessionCredentialBroker,
  type WorkerAuthorities,
  type WorkerIsolationAttestation,
  type WorkerLaunchManifest,
  type WorkerRuntimePlan,
} from "./worker.js";
import { prepareCandidateWorktree, type CandidateWorktree } from "./worktree.js";

export interface DurableExecutionStore {
  beginEffectDispatch(
    runId: string,
    effectId: string,
    idempotency: EffectExecution["idempotency"],
    reservation: BudgetReservation,
    command: Omit<ClaimEffectCommand, "expectedRevision" | "reservation">,
  ): { effect: EffectExecution; budget: BudgetState };
  bindEffectSession(effectId: string, expectedRevision: number, sessionId: string, updatedAt: string): void;
  renewEffect(
    effectId: string,
    expectedRevision: number,
    fencingEpoch: number,
    now: string,
    leaseUntil: string,
    minimumLeaseMs: number,
  ): EffectExecution;
  markEffectUnknown(
    runId: string,
    effectId: string,
    expectedEffectRevision: number,
    fencingEpoch: number,
    expectedBudgetRevision: number,
    reservationId: string,
    updatedAt: string,
  ): { effect: EffectExecution; budget: BudgetState };
  completeEffect(
    runId: string,
    effectId: string,
    expectedEffectRevision: number,
    fencingEpoch: number,
    expectedBudgetRevision: number,
    reservationId: string,
    providerReceipt: ProviderUsageReceipt,
  ): { effect: EffectExecution; budget: BudgetState };
}

export interface DurableCopilotExecutionInput {
  store: DurableExecutionStore;
  task: LockedTaskSpec;
  manifest: WorkerLaunchManifest;
  effectId: string;
  idempotency: EffectExecution["idempotency"];
  reservation: BudgetReservation;
  claim: Omit<ClaimEffectCommand, "expectedRevision" | "reservation">;
  credentialBroker: SessionCredentialBroker;
  gateway: GatewayService;
  usageReceiptIssuer: ProviderUsageReceiptIssuer;
  verifyProviderUsage(receipt: ProviderUsageReceipt): boolean;
  now(): number;
  leaseDurationMs: number;
  runAttempt?: typeof runAgentAttempt;
}

export interface DurableCopilotExecutionResult {
  outcome: "completed" | "outcome-unknown";
  effect: EffectExecution;
  budget: BudgetState;
  attempt?: AgentAttemptResult;
  usageReceipt?: ProviderUsageReceipt;
  blocker?: { code: string; message: string };
}

export async function executeDurableCopilotEffect(
  input: DurableCopilotExecutionInput,
): Promise<DurableCopilotExecutionResult> {
  const started = input.store.beginEffectDispatch(
    input.task.runId,
    input.effectId,
    input.idempotency,
    input.reservation,
    input.claim,
  );
  let effectRevision = started.effect.revision;
  const budgetRevision = started.budget.revision;
  try {
    const attempt = await (input.runAttempt ?? runAgentAttempt)({
      task: input.task,
      manifest: input.manifest,
      credentialBroker: input.credentialBroker,
      gatewayTransport: input.gateway,
      now: input.now,
      onSessionStarted: async (sessionId) => {
        input.store.bindEffectSession(
          input.effectId,
          effectRevision,
          sessionId,
          new Date(input.now()).toISOString(),
        );
      },
      renewLease: async () => {
        const nowMs = input.now();
        const deadlineMs = Date.parse(input.task.deadline);
        const leaseUntilMs = Math.min(deadlineMs, nowMs + input.leaseDurationMs);
        const renewed = input.store.renewEffect(
          input.effectId,
          effectRevision,
          input.task.fencingEpoch,
          new Date(nowMs).toISOString(),
          new Date(leaseUntilMs).toISOString(),
          input.claim.minimumLeaseMs,
        );
        effectRevision = renewed.revision;
      },
    });
    const usageReceipt = await issueMeasuredUsageReceipt({
      attempt,
      runId: input.task.runId,
      effectId: input.effectId,
      reservationId: input.reservation.reservationId,
      providerId: input.manifest.runtime.providerId,
      model: input.manifest.runtime.model,
      issuer: input.usageReceiptIssuer,
    });
    if (!input.verifyProviderUsage(usageReceipt)) {
      throw new ExecutionAttemptError("PROVIDER_USAGE_RECEIPT_INVALID", "Provider usage receipt signature is untrusted.");
    }
    const completed = input.store.completeEffect(
      input.task.runId,
      input.effectId,
      effectRevision,
      input.task.fencingEpoch,
      budgetRevision,
      input.reservation.reservationId,
      usageReceipt,
    );
    return { outcome: "completed", ...completed, attempt, usageReceipt };
  } catch (error) {
    const uncertain = input.store.markEffectUnknown(
      input.task.runId,
      input.effectId,
      effectRevision,
      input.task.fencingEpoch,
      budgetRevision,
      input.reservation.reservationId,
      new Date(input.now()).toISOString(),
    );
    return {
      outcome: "outcome-unknown",
      ...uncertain,
      blocker: {
        code: error instanceof ExecutionAttemptError ? error.code : "PROVIDER_OUTCOME_UNKNOWN",
        message: error instanceof Error ? error.message : "Provider execution outcome is unknown.",
      },
    };
  }
}

export interface PrepareLocalExecutionInput {
  repositoryRoot: string;
  worktreeRoot: string;
  store: SqliteHarnessStore;
  task: LockedTaskSpec;
  runtime: WorkerRuntimePlan;
  isolation: WorkerIsolationAttestation;
  brokerAttestation: CredentialBrokerAttestation;
  workerAuthorities: WorkerAuthorities;
  validationRunner?: GatewayValidationRunner;
}

function inside(root: string, target: string): boolean {
  const path = relative(root, target);
  return path === "" || (!path.startsWith("..") && !isAbsolute(path));
}

export async function prepareLocalExecution(input: PrepareLocalExecutionInput): Promise<{
  worktree: CandidateWorktree;
  manifest: WorkerLaunchManifest;
  gateway: GatewayService;
}> {
  const worktree = await prepareCandidateWorktree({
    repositoryRoot: input.repositoryRoot,
    worktreeRoot: input.worktreeRoot,
    sliceId: input.task.sliceId,
    runId: input.task.runId,
    baseSha: input.task.source.sourceSha,
  });
  const preparation = prepareWorkerLaunch(
    input.task,
    input.runtime,
    input.isolation,
    input.brokerAttestation,
    input.workerAuthorities,
  );
  if (preparation.outcome !== "LAUNCH_READY" || !preparation.manifest) {
    throw new Error(`Worker launch blocked: ${preparation.blockers.map((blocker) => blocker.code).join(", ")}`);
  }
  await Promise.all([
    mkdir(input.runtime.brokerScratchDirectory, { recursive: true, mode: 0o700 }),
    mkdir(input.runtime.brokerHomeDirectory, { recursive: true, mode: 0o700 }),
  ]);
  const [repositoryRoot, worktreePath, scratchPath, homePath] = await Promise.all([
    realpath(input.repositoryRoot),
    realpath(worktree.path),
    realpath(input.runtime.brokerScratchDirectory),
    realpath(input.runtime.brokerHomeDirectory),
  ]);
  if (
    scratchPath === homePath ||
    inside(repositoryRoot, scratchPath) ||
    inside(repositoryRoot, homePath) ||
    inside(worktreePath, scratchPath) ||
    inside(worktreePath, homePath)
  ) {
    throw new Error("Broker scratch and home must be distinct external directories outside all repository worktrees.");
  }
  const gateway = await GatewayService.create({
    workspaceRoot: worktree.path,
    task: input.task,
    manifest: preparation.manifest,
    receiptStore: input.store.gatewayReceiptStore(),
    ...(input.validationRunner ? { validationRunner: input.validationRunner } : {}),
  });
  return { worktree, manifest: preparation.manifest, gateway };
}
