// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import type { EffectExecution } from "./execution";
import { evaluateControllerHealth, reconcileExpiredEffect } from "./watchdog";

const effect = (idempotency: EffectExecution["idempotency"]): EffectExecution => ({
  revision: 1,
  intent: {
    effectId: "effect-watchdog",
    runId: "run-watchdog",
    epoch: 4,
    kind: "worker",
    inputSha256: "a".repeat(64),
    sourceSha: "b".repeat(40),
    policySha256: "c".repeat(64),
    eventId: "event-watchdog",
    deadline: "2026-09-10T12:00:00.000Z",
    status: "pending",
  },
  status: "claimed",
  attempts: 1,
  reservationId: "reservation-watchdog",
  idempotency,
  claim: {
    workerId: "worker-old",
    fencingEpoch: 4,
    claimedAt: "2026-09-10T10:58:00.000Z",
    leaseUntil: "2026-09-10T10:59:00.000Z",
  },
});

describe("watchdog", () => {
  it("waits for lease expiry before fencing a missed controller", () => {
    const health = {
      ownerId: "controller-a",
      fencingEpoch: 4,
      leaseUntilMs: 10_000,
      lastHeartbeatMs: 7_000,
      consecutiveMisses: 3,
    };
    expect(evaluateControllerHealth(health, 9_000, 1_000, 3).action).toBe("observe");
    expect(evaluateControllerHealth(health, 10_001, 1_000, 3)).toMatchObject({
      action: "fence-and-takeover",
      nextFencingEpoch: 5,
    });
  });

  it("confirms a queryable provider receipt before completion", async () => {
    const reader = { query: vi.fn().mockResolvedValue({
      status: "completed",
      receiptId: "receipt-watchdog",
      outputSha256: "d".repeat(64),
      completedAt: "2026-09-10T11:01:00.000Z",
    }) };
    const result = await reconcileExpiredEffect(
      effect("queryable"),
      1,
      "2026-09-10T11:00:00.000Z",
      reader,
    );
    expect(result).toMatchObject({ action: "completed", effect: { status: "completed", revision: 3 } });
  });

  it("permits retry only when the provider proves no effect exists", async () => {
    const result = await reconcileExpiredEffect(
      effect("queryable"),
      1,
      "2026-09-10T11:00:00.000Z",
      { query: vi.fn().mockResolvedValue({ status: "not-found" }) },
    );
    expect(result).toMatchObject({ action: "retry-eligible", effect: { status: "failed" } });
  });

  it("blocks unqueryable and ambiguous effects without repeating them", async () => {
    const reader = { query: vi.fn().mockResolvedValue({ status: "unknown", reason: "provider unavailable" }) };
    const unqueryable = await reconcileExpiredEffect(effect("none"), 1, "2026-09-10T11:00:00.000Z", reader);
    const ambiguous = await reconcileExpiredEffect(effect("queryable"), 1, "2026-09-10T11:00:00.000Z", reader);
    expect(unqueryable).toMatchObject({ action: "blocked-unknown", effect: { status: "outcome-unknown" } });
    expect(ambiguous).toMatchObject({ action: "blocked-unknown", effect: { status: "outcome-unknown" } });
    expect(reader.query).toHaveBeenCalledOnce();
  });
});