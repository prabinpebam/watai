import { runAgentAttempt, type AgentAttemptInput, type AgentAttemptResult } from "./agentRunner.js";
import {
  executeAgentEffect,
  ExecutionAttemptError,
  type ExecuteAgentEffectInput,
  type ExecuteAgentEffectResult,
  type ProviderUsageReceipt,
} from "./executionCoordinator.js";
import { sha256 } from "./trust.js";

export interface ProviderUsageReceiptIssuer {
  issue(input: {
    runId: string;
    effectId: string;
    reservationId: string;
    providerId: string;
    requestedModel: string;
    observedModel: string | null;
    outputSha256: string;
    measuredUsage: AgentAttemptResult["usage"];
  }): Promise<ProviderUsageReceipt>;
}

export interface ExecuteCopilotAgentEffectInput extends Omit<
  ExecuteAgentEffectInput,
  "providerId" | "model" | "execute"
> {
  agent: AgentAttemptInput;
  usageReceiptIssuer: ProviderUsageReceiptIssuer;
  runAttempt?: typeof runAgentAttempt;
}

export async function issueMeasuredUsageReceipt(input: {
  attempt: AgentAttemptResult;
  runId: string;
  effectId: string;
  reservationId: string;
  providerId: string;
  model: string;
  issuer: ProviderUsageReceiptIssuer;
}): Promise<ProviderUsageReceipt> {
  if (input.attempt.status !== "completed" || input.attempt.assistantContent === null) {
    throw new ExecutionAttemptError("AGENT_RESULT_MISSING", "Agent attempt completed without a final assistant result.");
  }
  const outputSha256 = sha256(input.attempt.assistantContent);
  let usageReceipt: ProviderUsageReceipt;
  try {
    usageReceipt = await input.issuer.issue({
      runId: input.runId,
      effectId: input.effectId,
      reservationId: input.reservationId,
      providerId: input.providerId,
      requestedModel: input.model,
      observedModel: input.attempt.usage.currentModel,
      outputSha256,
      measuredUsage: input.attempt.usage,
    });
  } catch (error) {
    throw new ExecutionAttemptError(
      "PROVIDER_USAGE_RECEIPT_ISSUANCE_FAILED",
      error instanceof Error ? error.message : "Provider usage receipt issuance failed.",
    );
  }
  const measuredUsageMatches =
    usageReceipt.usage.inputTokens === input.attempt.usage.inputTokens &&
    usageReceipt.usage.outputTokens === input.attempt.usage.outputTokens &&
    usageReceipt.usage.requests === input.attempt.usage.requests &&
    usageReceipt.premiumRequestCost === input.attempt.usage.premiumRequestCost &&
    usageReceipt.aiCredits === input.attempt.usage.aiCredits &&
    usageReceipt.outputSha256 === outputSha256 &&
    usageReceipt.resolvedModelVersion === input.attempt.usage.currentModel;
  if (!measuredUsageMatches) {
    throw new ExecutionAttemptError(
      "PROVIDER_USAGE_RECEIPT_MISMATCH",
      "Issued provider receipt does not match measured session usage.",
    );
  }
  return usageReceipt;
}

export async function executeCopilotAgentEffect(
  input: ExecuteCopilotAgentEffectInput,
): Promise<ExecuteAgentEffectResult> {
  const providerId = input.agent.manifest.runtime.providerId;
  const model = input.agent.manifest.runtime.model;
  return executeAgentEffect({
    budget: input.budget,
    effect: input.effect,
    reservation: input.reservation,
    claim: input.claim,
    providerId,
    model,
    authorities: input.authorities,
    execute: async () => {
      const attempt = await (input.runAttempt ?? runAgentAttempt)(input.agent);
      const usageReceipt = await issueMeasuredUsageReceipt({
        attempt,
        runId: input.effect.intent.runId,
        effectId: input.effect.intent.effectId,
        reservationId: input.reservation.reservationId,
        providerId,
        model,
        issuer: input.usageReceiptIssuer,
      });
      return { status: "completed", usageReceipt };
    },
  });
}