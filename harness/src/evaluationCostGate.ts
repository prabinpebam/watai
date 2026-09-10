import type { LiveModelAdapterResult } from "./liveModelExecutor.js";
import type { LiveModelEvaluationContract } from "./modelEvaluation.js";
import type { ModelCaseDefinition } from "./modelCases.js";
import { gradeModelCase, modelCaseDefinitionSha256 } from "./modelCases.js";
import { canonical, sha256 } from "./trust.js";

export interface EvaluationCanaryReport {
  schemaVersion: "1.0";
  status: "CANARY_PASSED" | "CANARY_FAILED";
  releaseEligible: false;
  sourceSha: string;
  runtimeImageSha256: string;
  evaluationId: string;
  contractSha256: string;
  caseId: string;
  caseDefinitionSha256: string;
  startedAt: string;
  completedAt: string;
  result: LiveModelAdapterResult;
  decision: {
    purpose: string;
    canaryMaximumMinutes: number;
    canaryMaximumAiCredits: number;
    fullQualificationMaximumMinutes: number;
    fullQualificationMaximumAiCredits: number;
    continuationCriterion: string;
    stopCondition: string;
  };
  blockers: Array<{ code: string; message: string }>;
}

function exceeds(
  value: LiveModelAdapterResult["usage"],
  limit: LiveModelAdapterResult["usage"],
): boolean {
  return value.usd > limit.usd ||
    value.inputTokens > limit.inputTokens ||
    value.outputTokens > limit.outputTokens ||
    value.requests > limit.requests ||
    value.aiCredits > limit.aiCredits;
}

export function buildEvaluationCanaryReport(input: {
  sourceSha: string;
  runtimeImageSha256: string;
  contract: LiveModelEvaluationContract;
  definition: ModelCaseDefinition;
  startedAt: string;
  completedAt: string;
  result: LiveModelAdapterResult;
}): EvaluationCanaryReport {
  if (!input.contract.staging) throw new Error("Evaluation contract has no staged cost gate.");
  const blockers: EvaluationCanaryReport["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (input.definition.id !== input.contract.staging.canaryCaseId) {
    block("CANARY_CASE_MISMATCH", "Canary case does not match the frozen staged contract.");
  }
  if (input.result.status !== "completed") {
    block("CANARY_PROVIDER_FAILED", `Canary provider outcome was ${input.result.status}.`);
  }
  if (!gradeModelCase(input.definition, input.result.artifact)) {
    block("CANARY_ORACLE_FAILED", "Canary did not satisfy its exact semantic oracle.");
  }
  if (
    input.result.latencyMs > input.contract.staging.maximumWallClockMs ||
    Date.parse(input.completedAt) - Date.parse(input.startedAt) > input.contract.staging.maximumWallClockMs
  ) {
    block("CANARY_TIME_EXCEEDED", "Canary exceeded its frozen wall-clock ceiling.");
  }
  if (exceeds(input.result.usage, input.contract.staging.budget)) {
    block("CANARY_BUDGET_EXCEEDED", "Canary exceeded a frozen budget dimension.");
  }
  if (
    input.result.usage.requests < 1 ||
    input.result.resolvedModelVersion === null ||
    input.result.responseSha256 === null
  ) {
    block("CANARY_USAGE_UNPROVEN", "Canary lacks completed provider identity, response or usage evidence.");
  }
  return {
    schemaVersion: "1.0",
    status: blockers.length === 0 ? "CANARY_PASSED" : "CANARY_FAILED",
    releaseEligible: false,
    sourceSha: input.sourceSha,
    runtimeImageSha256: input.runtimeImageSha256,
    evaluationId: input.contract.id,
    contractSha256: sha256(canonical(input.contract)),
    caseId: input.definition.id,
    caseDefinitionSha256: modelCaseDefinitionSha256(input.definition),
    startedAt: input.startedAt,
    completedAt: input.completedAt,
    result: input.result,
    decision: {
      purpose: input.contract.staging.qualificationReason,
      canaryMaximumMinutes: input.contract.staging.maximumWallClockMs / 60_000,
      canaryMaximumAiCredits: input.contract.staging.budget.aiCredits,
      fullQualificationMaximumMinutes:
        input.contract.caseIds.length * input.contract.repetitions * input.contract.staging.maximumWallClockMs / 60_000,
      fullQualificationMaximumAiCredits: input.contract.budget.aiCredits,
      continuationCriterion: "Proceed only when status is CANARY_PASSED and every binding below matches current source.",
      stopCondition: input.contract.staging.stopCondition,
    },
    blockers,
  };
}

export function verifyEvaluationCanaryReport(input: {
  report: EvaluationCanaryReport;
  sourceSha: string;
  runtimeImageSha256: string;
  contract: LiveModelEvaluationContract;
  definition: ModelCaseDefinition;
  now: number;
  maximumAgeMs?: number;
}): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  const expected = buildEvaluationCanaryReport({
    sourceSha: input.report.sourceSha,
    runtimeImageSha256: input.report.runtimeImageSha256,
    contract: input.contract,
    definition: input.definition,
    startedAt: input.report.startedAt,
    completedAt: input.report.completedAt,
    result: input.report.result,
  });
  if (input.report.status !== "CANARY_PASSED" || expected.status !== "CANARY_PASSED") {
    block("CANARY_NOT_PASSED", "Full qualification requires a passing canary.");
  }
  if (
    input.report.sourceSha !== input.sourceSha ||
    input.report.runtimeImageSha256 !== input.runtimeImageSha256 ||
    input.report.evaluationId !== input.contract.id ||
    input.report.contractSha256 !== sha256(canonical(input.contract)) ||
    input.report.caseId !== input.definition.id ||
    input.report.caseDefinitionSha256 !== modelCaseDefinitionSha256(input.definition)
  ) {
    block("CANARY_BINDING_MISMATCH", "Canary is not bound to the current source, image, contract and case.");
  }
  const completedAt = Date.parse(input.report.completedAt);
  const maximumAgeMs = input.maximumAgeMs ?? 2 * 60 * 60_000;
  if (!Number.isFinite(completedAt) || completedAt > input.now || input.now - completedAt > maximumAgeMs) {
    block("CANARY_STALE", "Canary is outside the permitted qualification window.");
  }
  return blockers;
}
