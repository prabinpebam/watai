// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { AgentAttemptInput, AgentAttemptResult } from "./agentRunner";
import { executeDurableCopilotEffect, type DurableExecutionStore } from "./durableExecutor";
import type { ProviderUsageReceipt } from "./executionCoordinator";
import type { BudgetReservation, BudgetState, EffectExecution } from "./execution";
import type { GatewayService } from "./gatewayService";
import type { LockedTaskSpec } from "./taskSpec";
import type { WorkerLaunchManifest } from "./worker";

const effect = (revision = 1): EffectExecution => ({
  revision,
  intent: {
    effectId: "effect-1", runId: "run-1", epoch: 1, kind: "worker",
    inputSha256: "a".repeat(64), sourceSha: "b".repeat(40), policySha256: "c".repeat(64),
    eventId: "event-1", deadline: "2026-09-10T12:00:00.000Z", status: "pending",
  },
  status: revision > 2 ? "completed" : "claimed",
  attempts: 1,
  reservationId: "reservation-1",
  idempotency: "queryable",
  claim: {
    workerId: "worker-1", fencingEpoch: 1, claimedAt: "2026-09-10T11:00:00.000Z",
    leaseUntil: "2026-09-10T11:02:00.000Z",
  },
});
const budget = (revision = 2): BudgetState => ({
  revision,
  limits: { usd: 1, inputTokens: 2_000, outputTokens: 500, requests: 3 },
  reservations: [{
    reservationId: "reservation-1", runId: "run-1", effectId: "effect-1", fencingEpoch: 1,
    worstCase: { usd: 1, inputTokens: 2_000, outputTokens: 500, requests: 3 }, status: "dispatched",
  }],
});
const reservation = budget().reservations[0] as BudgetReservation;
const task = {
  runId: "run-1", fencingEpoch: 1, deadline: "2026-09-10T12:00:00.000Z",
} as LockedTaskSpec;
const manifest = { runtime: { providerId: "github-copilot", model: "gpt-5.4" } } as WorkerLaunchManifest;
const attempt: AgentAttemptResult = {
  status: "completed",
  sessionId: "session-1",
  assistantContent: "done",
  submission: {
    receiptId: "submission-1", runId: "run-1", diffSha256: "d".repeat(64), changedPaths: ["src/value.ts"],
    validationCommandIds: ["fixed"], summary: "done", completedAt: "2026-09-10T11:00:30.000Z",
  },
  usage: {
    inputTokens: 1_000, outputTokens: 100, requests: 1, premiumRequestCost: 1,
    aiCredits: 1,
    apiDurationMs: 500, currentModel: "gpt-5.4-2026-03-05", modelIds: ["gpt-5.4-2026-03-05"],
  },
  cleanupErrors: [],
};

function storeFixture() {
  let revision = 1;
  const events: string[] = [];
  const store: DurableExecutionStore = {
    beginEffectDispatch: vi.fn(() => {
      events.push("begin");
      return { effect: effect(revision), budget: budget() };
    }),
    bindEffectSession: vi.fn(() => events.push("session")),
    renewEffect: vi.fn(() => {
      events.push("renew");
      revision += 1;
      return effect(revision);
    }),
    markEffectUnknown: vi.fn(() => ({ effect: { ...effect(revision + 1), status: "outcome-unknown" as const }, budget: budget(3) })),
    completeEffect: vi.fn((_runId, _effectId, expectedRevision) => {
      events.push(`complete:${expectedRevision}`);
      return { effect: { ...effect(expectedRevision + 1), status: "completed" as const }, budget: budget(3) };
    }),
  };
  return { store, events };
}

const usageReceipt = (): ProviderUsageReceipt => ({
  receiptId: "usage-1", runId: "run-1", effectId: "effect-1", reservationId: "reservation-1",
  providerId: "github-copilot", model: "gpt-5.4", resolvedModelVersion: "gpt-5.4-2026-03-05",
  premiumRequestCost: 1, usage: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 1 },
  aiCredits: 1,
  outputSha256: "06271baf49532c8797b3f12394c047e29c2f1dad9e8e1496c1a8ff5d8f5a1f28",
  completedAt: "2026-09-10T11:01:00.000Z", issuer: "usage-verifier",
  issuedAt: "2026-09-10T11:01:00.000Z", expiresAt: "2026-09-10T11:06:00.000Z",
  signature: "trusted:usage-1",
});

describe("durable Copilot executor", () => {
  it("persists dispatch and session, renews the lease, then atomically settles", async () => {
    const { store, events } = storeFixture();
    const runAttempt = vi.fn(async (input: AgentAttemptInput) => {
      events.push("run");
      await input.onSessionStarted?.("session-1");
      await input.renewLease?.();
      return attempt;
    });
    const result = await executeDurableCopilotEffect({
      store,
      task,
      manifest,
      effectId: "effect-1",
      idempotency: "queryable",
      reservation,
      claim: {
        workerId: "worker-1", fencingEpoch: 1, now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 3,
      },
      credentialBroker: { gitHubTokenProvider: vi.fn() },
      gateway: {} as GatewayService,
      usageReceiptIssuer: { issue: async (input) => ({ ...usageReceipt(), outputSha256: input.outputSha256 }) },
      verifyProviderUsage: (receipt) => receipt.signature === `trusted:${receipt.receiptId}`,
      now: () => Date.parse("2026-09-10T11:01:00.000Z"),
      leaseDurationMs: 120_000,
      runAttempt,
    });

    expect(result.outcome).toBe("completed");
    expect(events).toEqual(["begin", "run", "session", "renew", "complete:2"]);
    expect(store.completeEffect).toHaveBeenCalledOnce();
    expect(store.markEffectUnknown).not.toHaveBeenCalled();
  });
});
