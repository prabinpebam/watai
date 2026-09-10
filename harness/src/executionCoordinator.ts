import { sha256 } from "./trust.js";
import {
  claimEffect,
  completeEffect,
  reserveBudget,
  updateReservation,
  type BudgetAmount,
  type BudgetReservation,
  type BudgetState,
  type ClaimEffectCommand,
  type EffectExecution,
} from "./execution.js";

export interface ProviderUsageReceipt {
  receiptId: string;
  runId: string;
  effectId: string;
  reservationId: string;
  providerId: string;
  model: string;
  resolvedModelVersion: string | null;
  premiumRequestCost: number;
  aiCredits: number;
  usage: BudgetAmount;
  outputSha256: string;
  completedAt: string;
  issuer: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface AgentExecutionResult {
  status: "completed";
  usageReceipt: ProviderUsageReceipt;
}

export interface ExecutionCoordinatorAuthorities {
  verifyProviderUsage(receipt: ProviderUsageReceipt): boolean;
}

export interface ExecuteAgentEffectInput {
  budget: BudgetState;
  effect: EffectExecution;
  reservation: BudgetReservation;
  claim: Omit<ClaimEffectCommand, "expectedRevision" | "reservation">;
  providerId: string;
  model: string;
  authorities: ExecutionCoordinatorAuthorities;
  execute(effect: EffectExecution): Promise<AgentExecutionResult>;
}

export interface ExecuteAgentEffectResult {
  outcome: "completed" | "outcome-unknown";
  budget: BudgetState;
  effect: EffectExecution;
  providerReceipt?: ProviderUsageReceipt;
  blocker?: { code: string; message: string };
}

export class ExecutionAttemptError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "ExecutionAttemptError";
  }
}

function validReceipt(
  input: ExecuteAgentEffectInput,
  receipt: ProviderUsageReceipt,
): boolean {
  return (
    receipt.runId === input.effect.intent.runId &&
    receipt.effectId === input.effect.intent.effectId &&
    receipt.reservationId === input.reservation.reservationId &&
    receipt.providerId === input.providerId &&
    receipt.model === input.model &&
    Number.isFinite(receipt.premiumRequestCost) && receipt.premiumRequestCost >= 0 &&
    Number.isFinite(receipt.aiCredits) && receipt.aiCredits >= 0 &&
    receipt.receiptId.trim().length > 0 &&
    receipt.issuer.trim().length > 0 &&
    Number.isFinite(Date.parse(receipt.issuedAt)) &&
    Number.isFinite(Date.parse(receipt.expiresAt)) &&
    Date.parse(receipt.issuedAt) <= Date.parse(receipt.completedAt) &&
    Date.parse(receipt.completedAt) < Date.parse(receipt.expiresAt) &&
    receipt.signature.trim().length > 0 &&
    /^[a-f0-9]{64}$/.test(receipt.outputSha256) &&
    Number.isFinite(Date.parse(receipt.completedAt)) &&
    input.authorities.verifyProviderUsage(receipt)
  );
}

export async function executeAgentEffect(
  input: ExecuteAgentEffectInput,
): Promise<ExecuteAgentEffectResult> {
  const reserved = reserveBudget(input.budget, input.budget.revision, input.reservation);
  const claimed = claimEffect(input.effect, {
    ...input.claim,
    expectedRevision: input.effect.revision,
    reservation: input.reservation,
  });
  const dispatched = updateReservation(
    reserved,
    reserved.revision,
    input.reservation.reservationId,
    "dispatched",
  );

  let result: AgentExecutionResult;
  try {
    result = await input.execute(claimed);
  } catch (error) {
    const code = error instanceof ExecutionAttemptError ? error.code : "PROVIDER_OUTCOME_UNKNOWN";
    return {
      outcome: "outcome-unknown",
      budget: updateReservation(
        dispatched,
        dispatched.revision,
        input.reservation.reservationId,
        "outcome-unknown",
      ),
      effect: claimed,
      blocker: {
        code,
        message: error instanceof Error ? error.message : "Provider execution outcome is unknown.",
      },
    };
  }

  if (!validReceipt(input, result.usageReceipt)) {
    return {
      outcome: "outcome-unknown",
      budget: updateReservation(
        dispatched,
        dispatched.revision,
        input.reservation.reservationId,
        "outcome-unknown",
      ),
      effect: claimed,
      blocker: {
        code: "PROVIDER_USAGE_RECEIPT_INVALID",
        message: "Provider completion lacks a trusted, exactly bound usage receipt.",
      },
    };
  }

  const settled = updateReservation(
    dispatched,
    dispatched.revision,
    input.reservation.reservationId,
    "settled",
    result.usageReceipt.usage,
  );
  const completed = completeEffect(claimed, claimed.revision, input.claim.fencingEpoch, {
    receiptId: result.usageReceipt.receiptId,
    outputSha256: result.usageReceipt.outputSha256,
    completedAt: result.usageReceipt.completedAt,
  });
  return {
    outcome: "completed",
    budget: settled,
    effect: completed,
    providerReceipt: result.usageReceipt,
  };
}

export function providerUsageReceiptSha256(receipt: ProviderUsageReceipt): string {
  return sha256(JSON.stringify(receipt));
}