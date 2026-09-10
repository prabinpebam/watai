// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  executeAgentEffect,
  type ProviderUsageReceipt,
} from "./executionCoordinator";
import type { BudgetReservation, BudgetState, EffectExecution } from "./execution";

const reservation: BudgetReservation = {
  reservationId: "reservation-001",
  runId: "run-001",
  effectId: "effect-001",
  fencingEpoch: 3,
  worstCase: { usd: 2, inputTokens: 1_000, outputTokens: 200, requests: 2 },
  status: "reserved",
};
const budget: BudgetState = {
  revision: 0,
  limits: { usd: 3, inputTokens: 2_000, outputTokens: 400, requests: 4 },
  reservations: [],
};
const effect: EffectExecution = {
  revision: 0,
  intent: {
    effectId: "effect-001",
    runId: "run-001",
    epoch: 3,
    kind: "worker",
    inputSha256: "a".repeat(64),
    sourceSha: "b".repeat(40),
    policySha256: "c".repeat(64),
    eventId: "event-001",
    deadline: "2026-09-10T11:20:00.000Z",
    status: "pending",
  },
  status: "pending",
  attempts: 0,
  reservationId: "reservation-001",
  idempotency: "queryable",
};
const receipt = (): ProviderUsageReceipt => ({
  receiptId: "provider-receipt-001",
  runId: "run-001",
  effectId: "effect-001",
  reservationId: "reservation-001",
  providerId: "github-copilot",
  model: "gpt-5.4",
  resolvedModelVersion: "gpt-5.4-2026-03-05",
  premiumRequestCost: 1,
  aiCredits: 1,
  usage: { usd: 0.8, inputTokens: 800, outputTokens: 120, requests: 1 },
  outputSha256: "d".repeat(64),
  completedAt: "2026-09-10T11:01:00.000Z",
  issuer: "provider-usage-verifier",
  issuedAt: "2026-09-10T11:01:00.000Z",
  expiresAt: "2026-09-10T11:06:00.000Z",
  signature: "trusted:provider-receipt-001",
});
const baseInput = () => ({
  budget,
  effect,
  reservation,
  claim: {
    workerId: "worker-001",
    fencingEpoch: 3,
    now: "2026-09-10T11:00:00.000Z",
    leaseUntil: "2026-09-10T11:02:00.000Z",
    minimumLeaseMs: 30_000,
    maxAttempts: 3,
  },
  providerId: "github-copilot",
  model: "gpt-5.4",
  authorities: {
    verifyProviderUsage: (value: ProviderUsageReceipt) => value.signature === `trusted:${value.receiptId}`,
  },
});

describe("agent effect execution composition", () => {
  it("reserves before dispatch and settles only trusted observed usage", async () => {
    const result = await executeAgentEffect({
      ...baseInput(),
      execute: async () => ({ status: "completed", usageReceipt: receipt() }),
    });

    expect(result.outcome).toBe("completed");
    expect(result.effect.status).toBe("completed");
    expect(result.budget.reservations[0]).toMatchObject({
      status: "settled",
      actual: { usd: 0.8, inputTokens: 800, outputTokens: 120, requests: 1 },
    });
  });

  it("retains the worst-case charge when provider usage is untrusted", async () => {
    const result = await executeAgentEffect({
      ...baseInput(),
      execute: async () => ({
        status: "completed",
        usageReceipt: { ...receipt(), signature: "self-asserted" },
      }),
    });

    expect(result.outcome).toBe("outcome-unknown");
    expect(result.blocker?.code).toBe("PROVIDER_USAGE_RECEIPT_INVALID");
    expect(result.budget.reservations[0]).toMatchObject({ status: "outcome-unknown", actual: undefined });
    expect(result.effect.status).toBe("claimed");
  });
});