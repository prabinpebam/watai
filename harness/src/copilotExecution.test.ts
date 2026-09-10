// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { AgentAttemptInput, AgentAttemptResult } from "./agentRunner";
import { executeCopilotAgentEffect } from "./copilotExecution";
import type { ProviderUsageReceipt } from "./executionCoordinator";
import type { BudgetReservation, BudgetState, EffectExecution } from "./execution";

const reservation: BudgetReservation = {
  reservationId: "reservation-001",
  runId: "run-001",
  effectId: "effect-001",
  fencingEpoch: 3,
  worstCase: { usd: 0, inputTokens: 2_000, outputTokens: 500, requests: 3 },
  status: "reserved",
};
const budget: BudgetState = {
  revision: 0,
  limits: { usd: 0, inputTokens: 2_000, outputTokens: 500, requests: 3 },
  reservations: [],
};
const effect: EffectExecution = {
  revision: 0,
  intent: {
    effectId: "effect-001", runId: "run-001", epoch: 3, kind: "worker",
    inputSha256: "a".repeat(64), sourceSha: "b".repeat(40), policySha256: "c".repeat(64),
    eventId: "event-001", deadline: "2026-09-10T11:20:00.000Z", status: "pending",
  },
  status: "pending",
  attempts: 0,
  reservationId: "reservation-001",
  idempotency: "queryable",
};
const attempt: AgentAttemptResult = {
  status: "completed",
  sessionId: "session-001",
  assistantContent: "implemented",
  submission: {
    receiptId: "submission-1",
    runId: "run-001",
    diffSha256: "e".repeat(64),
    changedPaths: ["src/value.ts"],
    validationCommandIds: ["fixed"],
    summary: "implemented",
    completedAt: "2026-09-10T11:00:30.000Z",
  },
  usage: {
    inputTokens: 1_200,
    outputTokens: 200,
    requests: 2,
    premiumRequestCost: 1,
    aiCredits: 1,
    apiDurationMs: 2_000,
    currentModel: "gpt-5.4-2026-03-05",
    modelIds: ["gpt-5.4-2026-03-05"],
  },
  cleanupErrors: [],
};

describe("Copilot execution composition", () => {
  it("settles exact SDK usage only after external receipt issuance", async () => {
    const issue = vi.fn(async (value): Promise<ProviderUsageReceipt> => ({
      receiptId: "usage-001",
      runId: value.runId,
      effectId: value.effectId,
      reservationId: value.reservationId,
      providerId: value.providerId,
      model: value.requestedModel,
      resolvedModelVersion: value.observedModel,
      premiumRequestCost: value.measuredUsage.premiumRequestCost,
      aiCredits: value.measuredUsage.aiCredits,
      usage: { usd: 0, inputTokens: 1_200, outputTokens: 200, requests: 2 },
      outputSha256: value.outputSha256,
      completedAt: "2026-09-10T11:01:00.000Z",
      issuer: "provider-usage-verifier",
      issuedAt: "2026-09-10T11:01:00.000Z",
      expiresAt: "2026-09-10T11:06:00.000Z",
      signature: "trusted:usage-001",
    }));
    const result = await executeCopilotAgentEffect({
      budget,
      effect,
      reservation,
      claim: {
        workerId: "worker-001", fencingEpoch: 3, now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 3,
      },
      authorities: { verifyProviderUsage: (value) => value.signature === `trusted:${value.receiptId}` },
      agent: { manifest: { runtime: { providerId: "github-copilot", model: "gpt-5.4" } } } as AgentAttemptInput,
      usageReceiptIssuer: { issue },
      runAttempt: async () => attempt,
    });

    expect(issue).toHaveBeenCalledOnce();
    expect(result).toMatchObject({
      outcome: "completed",
      effect: { status: "completed" },
      budget: { reservations: [{ status: "settled", actual: { inputTokens: 1_200, outputTokens: 200, requests: 2 } }] },
    });
  });

  it("keeps worst-case reservation when issued usage differs from SDK metrics", async () => {
    const result = await executeCopilotAgentEffect({
      budget,
      effect,
      reservation,
      claim: {
        workerId: "worker-001", fencingEpoch: 3, now: "2026-09-10T11:00:00.000Z",
        leaseUntil: "2026-09-10T11:02:00.000Z", minimumLeaseMs: 30_000, maxAttempts: 3,
      },
      authorities: { verifyProviderUsage: () => true },
      agent: { manifest: { runtime: { providerId: "github-copilot", model: "gpt-5.4" } } } as AgentAttemptInput,
      usageReceiptIssuer: {
        issue: async (value) => ({
          receiptId: "usage-001", runId: value.runId, effectId: value.effectId,
          reservationId: value.reservationId, providerId: value.providerId, model: value.requestedModel,
          resolvedModelVersion: value.observedModel, premiumRequestCost: 1,
          aiCredits: 1,
          usage: { usd: 0, inputTokens: 1, outputTokens: 1, requests: 1 },
          outputSha256: value.outputSha256, completedAt: "2026-09-10T11:01:00.000Z",
          issuer: "provider-usage-verifier", issuedAt: "2026-09-10T11:01:00.000Z",
          expiresAt: "2026-09-10T11:06:00.000Z", signature: "trusted:usage-001",
        }),
      },
      runAttempt: async () => attempt,
    });

    expect(result.outcome).toBe("outcome-unknown");
    expect(result.blocker?.code).toBe("PROVIDER_USAGE_RECEIPT_MISMATCH");
    expect(result.budget.reservations[0].status).toBe("outcome-unknown");
  });
});