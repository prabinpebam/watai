import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createLocalGhTokenProvider } from "./credentialBroker.js";
import { executeDurableCopilotEffect, prepareLocalExecution } from "./durableExecutor.js";
import { CommandArtifactSigner } from "./externalSigner.js";
import { loadOperationalAuthority } from "./operationalAuthority.js";
import { SqliteHarnessStore } from "./sqliteStore.js";
import { verifyLockedTaskSpec, type LockedTaskSpec } from "./taskSpec.js";
import { canonical } from "./trust.js";
import type {
  CredentialBrokerAttestation,
  WorkerIsolationAttestation,
  WorkerRuntimePlan,
} from "./worker.js";
import type { EffectExecution } from "./execution.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function required(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function args(value: string | undefined): string[] {
  if (!value?.trim()) return [];
  const parsed = JSON.parse(value) as unknown;
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw new Error("WATAI_EVIDENCE_SIGNER_ARGS_JSON must be a JSON string array.");
  }
  return parsed;
}

async function json<T>(path: string): Promise<T> {
  return JSON.parse(await readFile(resolve(path), "utf8")) as T;
}

const authority = await loadOperationalAuthority(root, "implementation");
const [task, runtime, isolation, brokerAttestation] = await Promise.all([
  json<LockedTaskSpec>(required("WATAI_TASK_SPEC_PATH")),
  json<WorkerRuntimePlan>(required("WATAI_WORKER_RUNTIME_PATH")),
  json<WorkerIsolationAttestation>(required("WATAI_WORKER_ISOLATION_PATH")),
  json<CredentialBrokerAttestation>(required("WATAI_CREDENTIAL_BROKER_ATTESTATION_PATH")),
]);
if (!verifyLockedTaskSpec(task, authority.policy, authority.authorities)) {
  throw new Error("Locked TaskSpec digest or signature is invalid.");
}
if (canonical(task.bindings) !== canonical(authority.bundle.taskSpecBindings)) {
  throw new Error("TaskSpec authority bindings do not match the current external root.");
}
if (task.mode !== "implementation" || !task.dispatchAuthorized) {
  throw new Error("TaskSpec is not authorized for implementation dispatch.");
}
if (!task.agentRuntime) throw new Error("Implementation TaskSpec has no bound agent runtime.");
const agentRuntime = task.agentRuntime;

const databasePath = process.env.WATAI_HARNESS_DB_PATH?.trim() || resolve(root, ".harness-state", "harness.sqlite");
const store = new SqliteHarnessStore(databasePath);
try {
  const taskBudgetLimits = {
    usd: task.budgets.maxUsd,
    inputTokens: task.budgets.maxInputTokens,
    outputTokens: task.budgets.maxOutputTokens,
    requests: task.budgets.maxRequests,
  };
  const existingBudget = store.createBudget(task.runId, taskBudgetLimits);
  if (canonical(existingBudget.limits) !== canonical(taskBudgetLimits)) {
    throw new Error("Existing budget ledger does not match the locked TaskSpec ceilings.");
  }
  const pending = store.pendingEffects(task.runId).filter((entry) => {
    const intent = entry.intent as EffectExecution["intent"];
    return intent.kind === "worker" &&
      intent.inputSha256 === task.taskSpecSha256 &&
      intent.providerId === agentRuntime.providerId &&
      intent.model === agentRuntime.model &&
      intent.sourceSha === task.source.sourceSha &&
      intent.policySha256 === task.bindings.policySha256 &&
      intent.epoch === task.fencingEpoch &&
      intent.deadline === task.deadline;
  });
  if (pending.length === 0) {
    const abandoned = store.listEffects(task.runId, ["claimed"]);
    if (abandoned.length === 1) {
      const effect = abandoned[0];
      const budget = store.readBudget(task.runId);
      const recovered = store.markEffectUnknown(
        task.runId,
        effect.intent.effectId,
        effect.revision,
        task.fencingEpoch,
        budget.revision,
        effect.reservationId,
        new Date().toISOString(),
      );
      console.log(JSON.stringify({
        schemaVersion: "1.0",
        status: "BLOCKED_SAFE",
        releaseEligible: false,
        runId: task.runId,
        effectId: effect.intent.effectId,
        effectStatus: recovered.effect.status,
        budgetStatus: recovered.budget.reservations.find((reservation) => reservation.reservationId === effect.reservationId)?.status,
        blocker: {
          code: "ABANDONED_PROVIDER_OUTCOME_UNKNOWN",
          message: "A previous executor stopped after dispatch; the effect was fenced without redispatch.",
        },
      }, null, 2));
      process.exitCode = 2;
    } else {
      throw new Error(`Expected one current worker effect, found 0 pending and ${abandoned.length} claimed.`);
    }
  } else if (pending.length !== 1) {
    throw new Error(`Expected one current worker effect, found ${pending.length}.`);
  }
  if (process.exitCode) {
    // Recovery has emitted a terminal safe result; skip dispatch.
  } else {
  const effect = pending[0].intent as EffectExecution["intent"];
  const worktreeRoot = process.env.WATAI_WORKTREE_ROOT?.trim() || resolve(root, "..", "watai-harness-worktrees");
  const prepared = await prepareLocalExecution({
    repositoryRoot: root,
    worktreeRoot,
    store,
    task,
    runtime,
    isolation,
    brokerAttestation,
    workerAuthorities: authority.authorities,
  });
  const signer = new CommandArtifactSigner({
    executable: required("WATAI_EVIDENCE_SIGNER_EXECUTABLE"),
    args: args(process.env.WATAI_EVIDENCE_SIGNER_ARGS_JSON),
    cwd: process.env.WATAI_EVIDENCE_SIGNER_CWD?.trim() || root,
    timeoutMs: 30_000,
  });
  const now = Date.now();
  const leaseDurationMs = authority.policy.limits.workerLeaseSeconds * 1_000;
  const leaseUntil = Math.min(Date.parse(effect.deadline), now + leaseDurationMs);
  const result = await executeDurableCopilotEffect({
    store,
    task,
    manifest: prepared.manifest,
    effectId: effect.effectId,
    idempotency: "queryable",
    reservation: {
      reservationId: `${task.runId}:${effect.effectId}:budget`,
      runId: task.runId,
      effectId: effect.effectId,
      fencingEpoch: task.fencingEpoch,
      worstCase: {
        usd: task.budgets.maxUsd,
        inputTokens: task.budgets.maxInputTokens,
        outputTokens: task.budgets.maxOutputTokens,
        requests: task.budgets.maxRequests,
      },
      status: "reserved",
    },
    claim: {
      workerId: `local-executor:${process.pid}`,
      fencingEpoch: task.fencingEpoch,
      now: new Date(now).toISOString(),
      leaseUntil: new Date(leaseUntil).toISOString(),
      minimumLeaseMs: authority.policy.limits.minimumEffectLeaseSeconds * 1_000,
      maxAttempts: task.budgets.maxAttempts,
    },
    credentialBroker: { gitHubTokenProvider: createLocalGhTokenProvider() },
    gateway: prepared.gateway,
    usageReceiptIssuer: signer,
    verifyProviderUsage: (receipt) => authority.authorities.verifyProviderUsage(receipt),
    now: () => Date.now(),
    leaseDurationMs,
  });
  console.log(JSON.stringify({
    schemaVersion: "1.0",
    status: result.outcome === "completed" ? "IMPLEMENTATION_ATTEMPT_COMPLETED" : "BLOCKED_SAFE",
    releaseEligible: false,
    runId: task.runId,
    effectId: effect.effectId,
    worktreePath: prepared.worktree.path,
    effectStatus: result.effect.status,
    budgetStatus: result.budget.reservations.find((reservation) => reservation.effectId === effect.effectId)?.status,
    submissionReceiptId: result.attempt?.submission.receiptId ?? null,
    usageReceiptId: result.usageReceipt?.receiptId ?? null,
    blocker: result.blocker ?? null,
  }, null, 2));
  if (result.outcome !== "completed") process.exitCode = 2;
  }
} finally {
  store.close();
}
