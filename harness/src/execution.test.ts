// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  claimEffect,
  completeEffect,
  ExecutionError,
  expireClaim,
  reserveBudget,
  updateReservation,
  type BudgetReservation,
  type BudgetState,
  type EffectExecution,
} from "./execution";

const reservation = (): BudgetReservation => ({
  reservationId: "reservation-001",
  runId: "run-001",
  effectId: "effect-001",
  fencingEpoch: 3,
  worstCase: { usd: 0, inputTokens: 1_000, outputTokens: 200, requests: 2 },
  status: "reserved",
});

const budget = (): BudgetState => ({
  revision: 0,
  limits: { usd: 0, inputTokens: 2_000, outputTokens: 400, requests: 4 },
  reservations: [],
});

const effect = (idempotency: EffectExecution["idempotency"] = "queryable"): EffectExecution => ({
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
  idempotency,
});

const claim = (value = effect(), budgetReservation = reservation()) => claimEffect(value, {
  expectedRevision: value.revision,
  workerId: "worker-001",
  fencingEpoch: 3,
  now: "2026-09-10T11:00:00.000Z",
  leaseUntil: "2026-09-10T11:02:00.000Z",
  minimumLeaseMs: 30_000,
  maxAttempts: 3,
  reservation: budgetReservation,
});

describe("budget reservation", () => {
  it("reserves worst case before dispatch and settles within it", () => {
    const reserved = reserveBudget(budget(), 0, reservation());
    const dispatched = updateReservation(reserved, 1, "reservation-001", "dispatched");
    const settled = updateReservation(
      dispatched,
      2,
      "reservation-001",
      "settled",
      { usd: 0, inputTokens: 800, outputTokens: 100, requests: 1 },
    );
    expect(settled.reservations[0]).toMatchObject({ status: "settled", actual: { inputTokens: 800 } });
  });

  it("rejects over-reservation and compare-and-swap races", () => {
    const state = reserveBudget(budget(), 0, reservation());
    expect(() => reserveBudget(state, 0, { ...reservation(), reservationId: "other", effectId: "other" }))
      .toThrowError(ExecutionError);
    expect(() => reserveBudget(state, 1, {
      ...reservation(),
      reservationId: "other",
      effectId: "other",
      worstCase: { usd: 0, inputTokens: 2_000, outputTokens: 400, requests: 4 },
    })).toThrowError(ExecutionError);
  });

  it("retains worst-case charge for unknown dispatched outcome", () => {
    const state = reserveBudget(budget(), 0, reservation());
    const dispatched = updateReservation(state, 1, "reservation-001", "dispatched");
    const unknown = updateReservation(dispatched, 2, "reservation-001", "outcome-unknown");
    expect(unknown.reservations[0]).toMatchObject({ status: "outcome-unknown", actual: undefined });
    expect(() => updateReservation(unknown, 3, "reservation-001", "settled", {
      usd: 0,
      inputTokens: 1,
      outputTokens: 1,
      requests: 1,
    })).toThrowError(ExecutionError);
  });
});

describe("fenced effect execution", () => {
  it("requires reservation, current epoch, and sufficient lease", () => {
    const claimed = claim();
    expect(claimed).toMatchObject({ status: "claimed", attempts: 1, revision: 1 });
    expect(() => claimEffect(effect(), {
      expectedRevision: 0,
      workerId: "worker-stale",
      fencingEpoch: 2,
      now: "2026-09-10T11:00:00.000Z",
      leaseUntil: "2026-09-10T11:02:00.000Z",
      minimumLeaseMs: 30_000,
      maxAttempts: 3,
      reservation: reservation(),
    })).toThrowError(ExecutionError);
  });

  it("accepts one current completion and rejects stale completion", () => {
    const claimed = claim();
    const receipt = {
      receiptId: "receipt-001",
      outputSha256: "d".repeat(64),
      completedAt: "2026-09-10T11:01:00.000Z",
    };
    const completed = completeEffect(claimed, 1, 3, receipt);
    expect(completed.status).toBe("completed");
    expect(completeEffect(completed, 2, 3, receipt)).toBe(completed);
    expect(() => completeEffect(claimed, 1, 2, { ...receipt, receiptId: "other" }))
      .toThrowError(ExecutionError);
  });

  it("reconciles queryable effects but terminally retains ambiguous unqueryable outcomes", () => {
    const queryable = expireClaim(claim(effect("queryable")), 1, "2026-09-10T11:03:00.000Z");
    const unqueryable = expireClaim(claim(effect("none")), 1, "2026-09-10T11:03:00.000Z");
    expect(queryable.status).toBe("reconciling");
    expect(unqueryable.status).toBe("outcome-unknown");
  });
});