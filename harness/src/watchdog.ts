import type { EffectExecution } from "./execution.js";

export type ProviderEffectObservation =
  | { status: "completed"; receiptId: string; outputSha256: string; completedAt: string }
  | { status: "in-progress" }
  | { status: "not-found" }
  | { status: "unknown"; reason: string };

export interface EffectReceiptReader {
  query(effectId: string): Promise<ProviderEffectObservation>;
}

export interface ReconciliationResult {
  effect: EffectExecution;
  action: "none" | "retry-eligible" | "continue-observing" | "completed" | "blocked-unknown";
  reason: string;
}

export interface ControllerHealth {
  ownerId: string;
  fencingEpoch: number;
  leaseUntilMs: number;
  lastHeartbeatMs: number;
  consecutiveMisses: number;
}

export interface WatchdogDecision {
  action: "healthy" | "observe" | "fence-and-takeover";
  nextFencingEpoch: number;
  reason: string;
}

const digestPattern = /^[a-f0-9]{64}$/;

export function evaluateControllerHealth(
  health: ControllerHealth,
  nowMs: number,
  heartbeatIntervalMs: number,
  missedHeartbeatLimit: number,
): WatchdogDecision {
  if (
    !health.ownerId.trim() ||
    !Number.isSafeInteger(health.fencingEpoch) ||
    health.fencingEpoch < 1 ||
    !Number.isSafeInteger(nowMs) ||
    !Number.isSafeInteger(heartbeatIntervalMs) ||
    heartbeatIntervalMs < 1 ||
    !Number.isSafeInteger(missedHeartbeatLimit) ||
    missedHeartbeatLimit < 1
  ) {
    throw new Error("Invalid watchdog health input.");
  }
  const elapsedMisses = Math.floor(Math.max(0, nowMs - health.lastHeartbeatMs) / heartbeatIntervalMs);
  const misses = Math.max(health.consecutiveMisses, elapsedMisses);
  if (nowMs < health.leaseUntilMs && misses < missedHeartbeatLimit) {
    return { action: "healthy", nextFencingEpoch: health.fencingEpoch, reason: "Lease and heartbeat are current." };
  }
  if (nowMs < health.leaseUntilMs) {
    return { action: "observe", nextFencingEpoch: health.fencingEpoch, reason: "Heartbeat missed but lease has not expired." };
  }
  return {
    action: "fence-and-takeover",
    nextFencingEpoch: health.fencingEpoch + 1,
    reason: "Lease expired after the heartbeat miss threshold.",
  };
}

export async function reconcileExpiredEffect(
  effect: EffectExecution,
  expectedRevision: number,
  now: string,
  reader: EffectReceiptReader,
): Promise<ReconciliationResult> {
  if (effect.revision !== expectedRevision) throw new Error("Effect reconciliation lost compare-and-swap.");
  if (effect.status !== "claimed" || !effect.claim) {
    return { effect, action: "none", reason: "Effect has no active claim." };
  }
  if (Date.parse(effect.claim.leaseUntil) > Date.parse(now)) {
    return { effect, action: "none", reason: "Effect claim remains current." };
  }
  if (effect.idempotency === "none") {
    return {
      effect: { ...effect, revision: effect.revision + 1, status: "outcome-unknown" },
      action: "blocked-unknown",
      reason: "Unqueryable external effect expired after dispatch and cannot be repeated safely.",
    };
  }

  const reconciling: EffectExecution = {
    ...effect,
    revision: effect.revision + 1,
    status: "reconciling",
  };
  const observation = await reader.query(effect.intent.effectId);
  if (observation.status === "completed") {
    if (
      !observation.receiptId.trim() ||
      !digestPattern.test(observation.outputSha256) ||
      !Number.isFinite(Date.parse(observation.completedAt))
    ) {
      return {
        effect: { ...reconciling, revision: reconciling.revision + 1, status: "outcome-unknown" },
        action: "blocked-unknown",
        reason: "Provider completion receipt was malformed.",
      };
    }
    return {
      effect: {
        ...reconciling,
        revision: reconciling.revision + 1,
        status: "completed",
        receipt: observation,
      },
      action: "completed",
      reason: "Provider receipt confirmed the external effect.",
    };
  }
  if (observation.status === "not-found") {
    return {
      effect: { ...reconciling, revision: reconciling.revision + 1, status: "failed" },
      action: "retry-eligible",
      reason: "Provider proves no effect exists; bounded retry may proceed.",
    };
  }
  if (observation.status === "in-progress") {
    return { effect: reconciling, action: "continue-observing", reason: "Provider effect is still active." };
  }
  return {
    effect: { ...reconciling, revision: reconciling.revision + 1, status: "outcome-unknown" },
    action: "blocked-unknown",
    reason: observation.reason,
  };
}