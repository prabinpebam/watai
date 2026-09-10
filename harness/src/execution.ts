import type { EffectIntent } from "./controller.js";

export interface BudgetAmount {
  usd: number;
  inputTokens: number;
  outputTokens: number;
  requests: number;
}

export type ReservationStatus =
  | "reserved"
  | "dispatched"
  | "settled"
  | "cancelled-before-dispatch"
  | "outcome-unknown";

export interface BudgetReservation {
  reservationId: string;
  runId: string;
  effectId: string;
  fencingEpoch: number;
  worstCase: BudgetAmount;
  actual?: BudgetAmount;
  status: ReservationStatus;
}

export interface BudgetState {
  revision: number;
  limits: BudgetAmount;
  reservations: BudgetReservation[];
}

export class ExecutionError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExecutionError";
  }
}

function validAmount(amount: BudgetAmount): boolean {
  return (
    Number.isFinite(amount.usd) &&
    amount.usd >= 0 &&
    Number.isSafeInteger(amount.inputTokens) &&
    amount.inputTokens >= 0 &&
    Number.isSafeInteger(amount.outputTokens) &&
    amount.outputTokens >= 0 &&
    Number.isSafeInteger(amount.requests) &&
    amount.requests >= 0
  );
}

function add(left: BudgetAmount, right: BudgetAmount): BudgetAmount {
  return {
    usd: left.usd + right.usd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    requests: left.requests + right.requests,
  };
}

function charge(reservation: BudgetReservation): BudgetAmount {
  if (reservation.status === "cancelled-before-dispatch") {
    return { usd: 0, inputTokens: 0, outputTokens: 0, requests: 0 };
  }
  if (reservation.status === "settled" && reservation.actual) return reservation.actual;
  return reservation.worstCase;
}

function used(state: BudgetState): BudgetAmount {
  return state.reservations.reduce(
    (total, reservation) => add(total, charge(reservation)),
    { usd: 0, inputTokens: 0, outputTokens: 0, requests: 0 },
  );
}

function exceeds(value: BudgetAmount, limits: BudgetAmount): boolean {
  return (
    value.usd > limits.usd ||
    value.inputTokens > limits.inputTokens ||
    value.outputTokens > limits.outputTokens ||
    value.requests > limits.requests
  );
}

function assertRevision(state: BudgetState, expectedRevision: number): void {
  if (state.revision !== expectedRevision) {
    throw new ExecutionError(
      "BUDGET_REVISION_MISMATCH",
      `Expected budget revision ${expectedRevision}, current ${state.revision}.`,
    );
  }
}

export function reserveBudget(
  state: BudgetState,
  expectedRevision: number,
  reservation: BudgetReservation,
): BudgetState {
  assertRevision(state, expectedRevision);
  if (!validAmount(state.limits) || !validAmount(reservation.worstCase)) {
    throw new ExecutionError("BUDGET_INVALID", "Budget limits and reservations must be finite and nonnegative.");
  }
  const existing = state.reservations.find((item) => item.reservationId === reservation.reservationId);
  if (existing) {
    if (JSON.stringify(existing) === JSON.stringify(reservation)) return state;
    throw new ExecutionError("RESERVATION_ID_CONFLICT", "Reservation ID was reused with different content.");
  }
  if (state.reservations.some((item) => item.effectId === reservation.effectId)) {
    throw new ExecutionError("EFFECT_ALREADY_RESERVED", "Effect already has a budget reservation.");
  }
  if (reservation.status !== "reserved" || reservation.actual) {
    throw new ExecutionError("RESERVATION_INVALID", "New reservations must begin reserved without actual usage.");
  }
  if (exceeds(add(used(state), reservation.worstCase), state.limits)) {
    throw new ExecutionError("BUDGET_EXHAUSTED", "Worst-case reservation exceeds the authorized budget.");
  }
  return {
    ...state,
    revision: state.revision + 1,
    reservations: [...state.reservations, structuredClone(reservation)],
  };
}

export function updateReservation(
  state: BudgetState,
  expectedRevision: number,
  reservationId: string,
  nextStatus: Exclude<ReservationStatus, "reserved">,
  actual?: BudgetAmount,
): BudgetState {
  assertRevision(state, expectedRevision);
  const index = state.reservations.findIndex((item) => item.reservationId === reservationId);
  if (index < 0) throw new ExecutionError("RESERVATION_UNKNOWN", `Unknown reservation ${reservationId}.`);
  const current = state.reservations[index];
  const transitions: Record<ReservationStatus, ReservationStatus[]> = {
    reserved: ["dispatched", "cancelled-before-dispatch"],
    dispatched: ["settled", "outcome-unknown"],
    settled: [],
    "cancelled-before-dispatch": [],
    "outcome-unknown": [],
  };
  if (!transitions[current.status].includes(nextStatus)) {
    throw new ExecutionError("RESERVATION_TRANSITION_INVALID", `${current.status} cannot become ${nextStatus}.`);
  }
  if (nextStatus === "settled") {
    if (!actual || !validAmount(actual) || exceeds(actual, current.worstCase)) {
      throw new ExecutionError("ACTUAL_USAGE_INVALID", "Actual usage must be present and within reservation.");
    }
  } else if (actual) {
    throw new ExecutionError("ACTUAL_USAGE_INVALID", "Only settled reservations may record actual usage.");
  }
  const reservations = [...state.reservations];
  reservations[index] = { ...current, status: nextStatus, actual };
  return { ...state, revision: state.revision + 1, reservations };
}

export type EffectStatus =
  | "pending"
  | "claimed"
  | "reconciling"
  | "completed"
  | "failed"
  | "cancelled"
  | "outcome-unknown";

export interface EffectExecution {
  revision: number;
  intent: EffectIntent;
  status: EffectStatus;
  attempts: number;
  reservationId: string;
  idempotency: "queryable" | "none";
  claim?: {
    workerId: string;
    fencingEpoch: number;
    claimedAt: string;
    leaseUntil: string;
  };
  receipt?: {
    receiptId: string;
    outputSha256: string;
    completedAt: string;
  };
}

export interface ClaimEffectCommand {
  expectedRevision: number;
  workerId: string;
  fencingEpoch: number;
  now: string;
  leaseUntil: string;
  minimumLeaseMs: number;
  maxAttempts: number;
  reservation: BudgetReservation;
}

export function claimEffect(effect: EffectExecution, command: ClaimEffectCommand): EffectExecution {
  if (effect.revision !== command.expectedRevision) {
    throw new ExecutionError("EFFECT_REVISION_MISMATCH", "Effect claim lost compare-and-swap.");
  }
  if (effect.intent.epoch !== command.fencingEpoch) {
    throw new ExecutionError("EFFECT_EPOCH_STALE", "Worker fencing epoch is stale.");
  }
  if (
    command.reservation.reservationId !== effect.reservationId ||
    command.reservation.effectId !== effect.intent.effectId ||
    command.reservation.fencingEpoch !== effect.intent.epoch ||
    command.reservation.status !== "reserved"
  ) {
    throw new ExecutionError("BUDGET_RESERVATION_INVALID", "Effect lacks its current worst-case reservation.");
  }
  const now = Date.parse(command.now);
  const leaseUntil = Date.parse(command.leaseUntil);
  const deadline = Date.parse(effect.intent.deadline);
  if (
    !Number.isFinite(now) ||
    !Number.isFinite(leaseUntil) ||
    !Number.isFinite(deadline) ||
    leaseUntil - now < command.minimumLeaseMs ||
    deadline <= now
  ) {
    throw new ExecutionError("EFFECT_LEASE_INVALID", "Effect has insufficient lease or an expired deadline.");
  }
  if (!["pending", "failed"].includes(effect.status) || effect.attempts >= command.maxAttempts) {
    throw new ExecutionError("EFFECT_NOT_CLAIMABLE", "Effect is not eligible for another bounded attempt.");
  }
  return {
    ...effect,
    revision: effect.revision + 1,
    status: "claimed",
    attempts: effect.attempts + 1,
    claim: {
      workerId: command.workerId,
      fencingEpoch: command.fencingEpoch,
      claimedAt: command.now,
      leaseUntil: command.leaseUntil,
    },
  };
}

export function expireClaim(
  effect: EffectExecution,
  expectedRevision: number,
  now: string,
): EffectExecution {
  if (effect.revision !== expectedRevision) {
    throw new ExecutionError("EFFECT_REVISION_MISMATCH", "Effect expiry lost compare-and-swap.");
  }
  if (effect.status !== "claimed" || !effect.claim || Date.parse(effect.claim.leaseUntil) > Date.parse(now)) {
    throw new ExecutionError("EFFECT_CLAIM_CURRENT", "Effect claim has not expired.");
  }
  return {
    ...effect,
    revision: effect.revision + 1,
    status: effect.idempotency === "queryable" ? "reconciling" : "outcome-unknown",
  };
}

export function completeEffect(
  effect: EffectExecution,
  expectedRevision: number,
  fencingEpoch: number,
  receipt: NonNullable<EffectExecution["receipt"]>,
): EffectExecution {
  if (effect.receipt?.receiptId === receipt.receiptId && effect.status === "completed") return effect;
  if (effect.revision !== expectedRevision) {
    throw new ExecutionError("EFFECT_REVISION_MISMATCH", "Effect completion lost compare-and-swap.");
  }
  if (
    effect.status !== "claimed" ||
    !effect.claim ||
    effect.claim.fencingEpoch !== fencingEpoch ||
    effect.intent.epoch !== fencingEpoch
  ) {
    throw new ExecutionError("EFFECT_COMPLETION_STALE", "Completion came from a stale or inactive worker.");
  }
  if (!receipt.receiptId.trim() || !/^[a-f0-9]{64}$/.test(receipt.outputSha256) || !Number.isFinite(Date.parse(receipt.completedAt))) {
    throw new ExecutionError("EFFECT_RECEIPT_INVALID", "Effect receipt is malformed.");
  }
  return {
    ...effect,
    revision: effect.revision + 1,
    status: "completed",
    receipt,
  };
}