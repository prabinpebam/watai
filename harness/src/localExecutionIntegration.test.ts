// @vitest-environment node
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";

import workflowJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json";
import { compileWorkflow, type EventCommand, type HarnessAuthorities, type WorkflowDefinition } from "./controller";
import { executeDurableCopilotEffect, prepareLocalExecution } from "./durableExecutor";
import type { ProviderUsageReceipt } from "./executionCoordinator";
import { SqliteHarnessStore } from "./sqliteStore";
import type { LockedTaskSpec } from "./taskSpec";
import type { GatewayRequest, WorkerRuntimePlan } from "./worker";

const workflow = compileWorkflow(workflowJson as WorkflowDefinition);
const directories: string[] = [];
const policySha256 = "b".repeat(64);
const now = Date.parse("2026-09-10T11:00:00.000Z");
const authorities: HarnessAuthorities = {
  now: () => now,
  limits: {
    maxClockSkewMs: 5_000,
    maxGuardProofLifetimeMs: 15 * 60_000,
    maxPermitLifetimeMs: 15 * 60_000,
    maxEffectLifetimeMs: 20 * 60_000,
  },
  verifyActor: (proof) => proof.signature === `trusted:${proof.role}`,
  verifyGuard: (proof) => proof.signature === `trusted:${proof.guard}`,
  verifyPermit: () => false,
};

function event(
  runId: string,
  sourceSha: string,
  revision: number,
  eventType: string,
  actor: string,
  guards: string[],
): EventCommand {
  const eventId = `${eventType}-${revision}`;
  return {
    envelope: {
      schemaVersion: "1.0", runId, eventId, expectedRevision: revision, fencingEpoch: 1,
      sourceSha, policySha256, eventType, payloadSha256: createHash("sha256").update(eventId).digest("hex"),
    },
    actor,
    actorProof: {
      role: actor, identity: `trusted-${actor}`, runId, eventId, fencingEpoch: 1, sourceSha, policySha256,
      issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: `trusted:${actor}`,
    },
    guardEvidence: Object.fromEntries(guards.map((guard) => [guard, {
      guard, runId, eventId, fencingEpoch: 1, sourceSha, policySha256,
      evidenceSha256: createHash("sha256").update(guard).digest("hex"), issuer: "trusted-evaluator",
      issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: `trusted:${guard}`,
    }])),
    effectDeadline: "2026-09-10T11:10:00.000Z",
    effectProvider: eventType === "start_build"
      ? { providerId: "github-copilot", model: "gpt-5.4" }
      : undefined,
  };
}

function gatewayRequest(manifestSha256: string, taskSpecSha256: string, tool: GatewayRequest["tool"], requestId: string, args: unknown): GatewayRequest {
  return {
    schemaVersion: "1.0", requestId, runId: "run-vertical", taskSpecSha256,
    manifestSha256, fencingEpoch: 1, tool, arguments: args,
  };
}

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe("local execution vertical path", () => {
  it("persists workflow dispatch through validated submission and atomic usage settlement", async () => {
    const repositoryRoot = await mkdtemp(join(tmpdir(), "watai-vertical-repo-"));
    const worktreeRoot = await mkdtemp(join(tmpdir(), "watai-vertical-worktrees-"));
    const brokerRoot = await mkdtemp(join(tmpdir(), "watai-vertical-broker-"));
    directories.push(repositoryRoot, worktreeRoot, brokerRoot);
    await mkdir(join(repositoryRoot, "src"));
    await writeFile(join(repositoryRoot, "src", "value.ts"), "export const value = 1;\n", "utf8");
    execFileSync("git", ["init", "-q"], { cwd: repositoryRoot });
    execFileSync("git", ["config", "core.autocrlf", "false"], { cwd: repositoryRoot });
    execFileSync("git", ["add", "."], { cwd: repositoryRoot });
    execFileSync("git", ["-c", "user.name=test", "-c", "user.email=test@example.com", "commit", "-qm", "fixture"], { cwd: repositoryRoot });
    const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repositoryRoot, encoding: "utf8" }).trim();
    const store = new SqliteHarnessStore(join(brokerRoot, "harness.sqlite"));
    const taskSpecSha256 = "c".repeat(64);
    store.createCandidate(workflow, { runId: "run-vertical", fencingEpoch: 1, sourceSha, policySha256 });
    store.apply(workflow, event("run-vertical", sourceSha, 0, "dispatch", "controller", [
      "valid-envelope", "current-lease", "current-source", "budget-reserved",
    ]), authorities);
    store.apply(workflow, event("run-vertical", sourceSha, 1, "preflight_passed", "release-verifier", [
      "valid-envelope", "current-lease", "current-source", "capabilities-proven", "spec-pinned",
    ]), authorities);
    const buildEvent = event("run-vertical", sourceSha, 2, "start_build", "controller", [
      "valid-envelope", "current-lease", "current-source", "budget-reserved", "attempts-remaining",
    ]);
    buildEvent.envelope.payloadSha256 = taskSpecSha256;
    store.apply(workflow, buildEvent, authorities);
    const validationCommands = [{
      id: "fixed", executable: "node", args: ["-e", "process.exit(0)"], cwd: "src",
      timeoutMs: 30_000, maxOutputBytes: 64 * 1024,
    }];
    const task = {
      status: "SPEC_LOCKED", dispatchAuthorized: true, mode: "implementation", runId: "run-vertical", sliceId: "S36",
      taskSpecSha256, fencingEpoch: 1, mutationClass: "candidate",
      source: { sourceSha, clean: true }, bindings: { policySha256 }, allowedPaths: ["src"],
      allowedTools: ["watai_read_file", "watai_git_diff", "watai_apply_patch", "watai_run_validation", "watai_submit_result"],
      agentRuntime: { providerId: "github-copilot", model: "gpt-5.4" }, validationCommands,
      modelNetworkHosts: ["api.githubcopilot.com"], toolNetworkHosts: [],
      budgets: {
        maxAttempts: 1, maxActiveMinutes: 5, maxAttemptMinutes: 4, maxUsd: 0,
        maxInputTokens: 2_000, maxOutputTokens: 500, maxRequests: 3, maxAiCredits: 3,
      },
      deadline: "2026-09-10T11:10:00.000Z",
    } as unknown as LockedTaskSpec;
    const runtime: WorkerRuntimePlan = {
      sdkVersion: "1.0.13", bundledCliVersion: "1.0.83", runtimeImageSha256: "d".repeat(64),
      containerDependencyDirectory: "/opt/watai/node_modules",
      model: "gpt-5.4", providerId: "github-copilot", maxAiCredits: 3,
      brokerScratchDirectory: join(brokerRoot, "scratch"), brokerHomeDirectory: join(brokerRoot, "home"),
      brokerEnvironment: { PATH: process.env.PATH ?? "" }, credentialReference: "fixture",
      gatewayTools: task.allowedTools as WorkerRuntimePlan["gatewayTools"], validationCommands,
      memoryMb: 1024, cpuCount: 1, pidsLimit: 64,
    };
    const prepared = await prepareLocalExecution({
      repositoryRoot, worktreeRoot, store, task, runtime,
      isolation: {
        attestationId: "isolation", taskSpecSha256, policySha256, runtimeImageSha256: runtime.runtimeImageSha256,
        engine: "docker-linux", networkMode: "none", rootFilesystemReadOnly: true, sourceMountReadOnly: true,
        writesThroughGateway: true, nonRootUser: true, noNewPrivileges: true, droppedCapabilities: ["ALL"],
        dockerSocketMounted: false, hostHomeMounted: false, credentialEnvironmentEmpty: true,
        issuer: "isolation-verifier", issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "trusted:isolation",
      },
      brokerAttestation: {
        attestationId: "broker", taskSpecSha256, policySha256, providerId: "github-copilot",
        providerHosts: ["api.githubcopilot.com"], noWorkspaceMount: true, tokenStorage: "memory-only",
        ambientLoginDisabled: true, toolProcessReceivesCredentials: false, issuer: "broker-verifier",
        issuedAt: "2026-09-10T10:59:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "trusted:broker",
      },
      workerAuthorities: {
        now: () => now,
        verifyWorkerIsolation: (value) => value.signature === `trusted:${value.attestationId}`,
        verifyCredentialBroker: (value) => value.signature === `trusted:${value.attestationId}`,
      },
      validationRunner: { run: () => ({ exitCode: 0, signal: null, stdout: "pass", stderr: "", passed: true }) },
    });
    store.createBudget(task.runId, { usd: 0, inputTokens: 2_000, outputTokens: 500, requests: 3 });
    const workerEffect = store.pendingEffects(task.runId).find((entry) => (entry.intent as { kind: string }).kind === "worker")!;
    const runAttempt = vi.fn(async (input) => {
      await input.onSessionStarted?.("session-vertical");
      await input.renewLease?.();
      const patch = "diff --git a/src/value.ts b/src/value.ts\n--- a/src/value.ts\n+++ b/src/value.ts\n@@ -1 +1 @@\n-export const value = 1;\n+export const value = 2;\n";
      const diff = await prepared.gateway.invoke(gatewayRequest(
        prepared.manifest.manifestSha256, taskSpecSha256, "watai_git_diff", "diff-before-patch", {},
      ));
      const patched = await prepared.gateway.invoke(gatewayRequest(prepared.manifest.manifestSha256, taskSpecSha256, "watai_apply_patch", "patch", {
        patch,
        patchSha256: createHash("sha256").update(patch).digest("hex"),
        expectedDiffSha256: (diff.result as { diffSha256: string }).diffSha256,
      }));
      if (patched.status !== "success") throw new Error(`Patch failed: ${JSON.stringify(patched.result)}`);
      const validated = await prepared.gateway.invoke(gatewayRequest(prepared.manifest.manifestSha256, taskSpecSha256, "watai_run_validation", "validate", { commandId: "fixed" }));
      if (validated.status !== "success") throw new Error(`Validation failed: ${JSON.stringify(validated.result)}`);
      const submitted = await prepared.gateway.invoke(gatewayRequest(prepared.manifest.manifestSha256, taskSpecSha256, "watai_submit_result", "submit", {
        summary: "updated fixture", changedPaths: ["src/value.ts"], validationCommandIds: ["fixed"],
      }));
      if (submitted.status !== "success") throw new Error(`Submission failed: ${JSON.stringify(submitted.result)}`);
      return {
        status: "completed" as const,
        sessionId: "session-vertical",
        assistantContent: "done",
        submission: (await prepared.gateway.getSubmission(task.runId))!,
        usage: {
          inputTokens: 1_000, outputTokens: 100, requests: 1, premiumRequestCost: 1, aiCredits: 1,
          apiDurationMs: 500, currentModel: "gpt-5.4-test", modelIds: ["gpt-5.4-test"],
        },
        cleanupErrors: [],
      };
    });
    const result = await executeDurableCopilotEffect({
      store, task, manifest: prepared.manifest, effectId: workerEffect.effectId, idempotency: "queryable",
      reservation: {
        reservationId: "reservation-vertical", runId: task.runId, effectId: workerEffect.effectId, fencingEpoch: 1,
        worstCase: { usd: 0, inputTokens: 2_000, outputTokens: 500, requests: 3 }, status: "reserved",
      },
      claim: {
        workerId: "worker-vertical", fencingEpoch: 1, now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 1,
      },
      credentialBroker: { gitHubTokenProvider: vi.fn() }, gateway: prepared.gateway,
      usageReceiptIssuer: { issue: async (input) => ({
        receiptId: "usage-vertical", runId: input.runId, effectId: input.effectId, reservationId: input.reservationId,
        providerId: input.providerId, model: input.requestedModel, resolvedModelVersion: input.observedModel,
        premiumRequestCost: input.measuredUsage.premiumRequestCost, aiCredits: input.measuredUsage.aiCredits,
        usage: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 1 }, outputSha256: input.outputSha256,
        completedAt: "2026-09-10T11:01:00.000Z", issuer: "usage-verifier",
        issuedAt: "2026-09-10T11:01:00.000Z", expiresAt: "2026-09-10T11:05:00.000Z", signature: "trusted:usage-vertical",
      }) },
      verifyProviderUsage: (receipt) => receipt.signature === `trusted:${receipt.receiptId}`,
      now: () => Date.parse("2026-09-10T11:01:00.000Z"), leaseDurationMs: 120_000, runAttempt,
    });
    const effectStatus = store.readEffect(workerEffect.effectId).status;
    const budgetStatus = store.readBudget(task.runId).reservations[0].status;
    store.close();
    expect(result.outcome).toBe("completed");
    expect(result.blocker).toBeUndefined();
    expect(effectStatus).toBe("completed");
    expect(budgetStatus).toBe("settled");
    expect(await readFile(join(prepared.worktree.path, "src", "value.ts"), "utf8")).toContain("value = 2");
  });
});
