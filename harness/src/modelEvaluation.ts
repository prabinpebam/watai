import type { BudgetAmount } from "./execution.js";
import { canonical, sha256 } from "./trust.js";

export type LiveModelBudgetAmount = BudgetAmount & { aiCredits: number };

export interface LiveModelEvaluationContract {
  id: string;
  purpose: "implementation-agent" | "product-behavior" | "memory-quality";
  applicableGates: string[];
  providerId: string;
  requestedModel: string;
  resolvedVersionPolicy: "exact" | "observed";
  expectedResolvedVersion: string | null;
  caseIds: string[];
  repetitions: number;
  thresholds: {
    minimumSemanticPassRate: number;
    maximumErrorRate: number;
    maximumP95LatencyMs: number;
  };
  budget: LiveModelBudgetAmount;
  staging?: {
    canaryCaseId: string;
    canaryRepetitions: 1;
    maximumWallClockMs: number;
    budget: LiveModelBudgetAmount;
    qualificationReason: string;
    stopCondition: string;
  };
  qualityDenominator?: {
    minimumAttemptedEpisodes: number;
    minimumIndependentNegativeTimelines: number;
    requiredArms: string[];
  };
  requiresUsageReceipts: true;
  requiresPortableJsonl: true;
}

export interface LiveModelEvaluationManifest {
  schemaVersion: "1.0";
  status: "CANDIDATE_FROZEN";
  releaseEligible: false;
  evaluations: LiveModelEvaluationContract[];
}

export interface LiveModelRunObservation {
  evaluationId: string;
  runId: string;
  caseId: string;
  repetition: number;
  providerId: string;
  requestedModel: string;
  resolvedModelVersion: string | null;
  status: "completed" | "failed" | "timed-out";
  semanticPass: boolean;
  latencyMs: number;
  usage: LiveModelBudgetAmount;
  usageReceiptSha256: string;
  responseSha256: string | null;
  caseDefinitionSha256: string;
  graderSha256: string;
  gradedArtifactSha256: string;
  gradeOutputSha256: string;
  errorCode: string | null;
  qualityDenominator?: {
    attemptedEpisodes: number;
    independentNegativeTimelines: number;
    arms: string[];
    reportSha256: string;
  };
  completedAt: string;
  producerIdentity: string;
  issuedAt: string;
  expiresAt: string;
  signature: string;
}

export interface LiveModelEvaluationAuthorities {
  verifyObservation(observation: LiveModelRunObservation): boolean;
}

export interface LiveModelEvaluationAdmission {
  outcome: "PASSED" | "FAILED";
  blockers: Array<{ code: string; message: string }>;
  expectedRuns: number;
  attemptedRuns: number;
  semanticPassRate: number;
  errorRate: number;
  p95LatencyMs: number;
  totalUsage: LiveModelBudgetAmount;
}

const digestPattern = /^[a-f0-9]{64}$/;
const minimumEvaluationGates: Record<string, string[]> = {
  "implementation-agent-smoke": ["G00", "G08"],
  "semantic-routing-live": ["G02", "G07", "G08"],
  "responses-streaming-tools-live": ["G02", "G05", "G07", "G08"],
  "memory-quality-live": ["G04", "G06", "G08"],
};

export function modelUsageEvidenceSha256(input: {
  evaluationId: string;
  caseId: string;
  repetition: number;
  providerId: string;
  requestedModel: string;
  resolvedModelVersion: string | null;
  usage: LiveModelBudgetAmount;
  responseSha256: string | null;
  completedAt: string;
}): string {
  return sha256(canonical(input));
}

function validAmount(amount: LiveModelBudgetAmount): boolean {
  return Number.isFinite(amount.usd) && amount.usd >= 0 &&
    Number.isSafeInteger(amount.inputTokens) && amount.inputTokens >= 0 &&
    Number.isSafeInteger(amount.outputTokens) && amount.outputTokens >= 0 &&
    Number.isSafeInteger(amount.requests) && amount.requests >= 0 &&
    Number.isFinite(amount.aiCredits) && amount.aiCredits >= 0;
}

  function add(left: LiveModelBudgetAmount, right: LiveModelBudgetAmount): LiveModelBudgetAmount {
  return {
    usd: left.usd + right.usd,
    inputTokens: left.inputTokens + right.inputTokens,
    outputTokens: left.outputTokens + right.outputTokens,
    requests: left.requests + right.requests,
    aiCredits: left.aiCredits + right.aiCredits,
  };
}

function exceeds(value: LiveModelBudgetAmount, limit: LiveModelBudgetAmount): boolean {
  return value.usd > limit.usd ||
    value.inputTokens > limit.inputTokens ||
    value.outputTokens > limit.outputTokens ||
    value.requests > limit.requests ||
    value.aiCredits > limit.aiCredits;
}

export function validateLiveModelEvaluationManifest(
  manifest: LiveModelEvaluationManifest,
): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (manifest.schemaVersion !== "1.0" || manifest.status !== "CANDIDATE_FROZEN" || manifest.releaseEligible !== false) {
    block("MODEL_MANIFEST_HEADER_INVALID", "Live-model manifest must be a frozen non-release version 1.0.");
  }
  if (manifest.evaluations.length === 0) block("MODEL_EVALUATIONS_MISSING", "At least one live-model evaluation is required.");
  const ids = new Set<string>();
  for (const contract of manifest.evaluations) {
    if (ids.has(contract.id)) block("MODEL_EVALUATION_DUPLICATE", `Duplicate evaluation ${contract.id}.`);
    ids.add(contract.id);
    const exactVersionValid = contract.resolvedVersionPolicy === "exact"
      ? Boolean(contract.expectedResolvedVersion?.trim())
      : contract.expectedResolvedVersion === null;
    const stagingValid = contract.purpose !== "implementation-agent" || Boolean(
      contract.staging &&
      contract.caseIds.includes(contract.staging.canaryCaseId) &&
      contract.staging.canaryRepetitions === 1 &&
      Number.isSafeInteger(contract.staging.maximumWallClockMs) &&
      contract.staging.maximumWallClockMs > 0 &&
      validAmount(contract.staging.budget) &&
      !exceeds(contract.staging.budget, contract.budget) &&
      contract.staging.qualificationReason.trim() &&
      contract.staging.stopCondition.trim()
    );
    const valid = /^[a-z][a-z0-9-]+$/.test(contract.id) &&
      contract.applicableGates.length > 0 &&
      contract.applicableGates.every((gate) => /^G\d{2}$/.test(gate)) &&
      Boolean(contract.providerId.trim()) &&
      Boolean(contract.requestedModel.trim()) &&
      exactVersionValid &&
      contract.caseIds.length > 0 &&
      new Set(contract.caseIds).size === contract.caseIds.length &&
      contract.caseIds.every((id) => /^[a-z][a-z0-9-]+$/.test(id)) &&
      Number.isSafeInteger(contract.repetitions) && contract.repetitions >= 3 && contract.repetitions <= 20 &&
      contract.thresholds.minimumSemanticPassRate > 0 && contract.thresholds.minimumSemanticPassRate <= 1 &&
      contract.thresholds.maximumErrorRate >= 0 && contract.thresholds.maximumErrorRate < 1 &&
      Number.isSafeInteger(contract.thresholds.maximumP95LatencyMs) && contract.thresholds.maximumP95LatencyMs > 0 &&
      validAmount(contract.budget) && contract.budget.requests >= contract.caseIds.length * contract.repetitions &&
      stagingValid &&
      (contract.qualityDenominator === undefined || (
        Number.isSafeInteger(contract.qualityDenominator.minimumAttemptedEpisodes) &&
        contract.qualityDenominator.minimumAttemptedEpisodes >= 1 &&
        Number.isSafeInteger(contract.qualityDenominator.minimumIndependentNegativeTimelines) &&
        contract.qualityDenominator.minimumIndependentNegativeTimelines >= 1 &&
        contract.qualityDenominator.requiredArms.length > 0 &&
        new Set(contract.qualityDenominator.requiredArms).size === contract.qualityDenominator.requiredArms.length
      )) &&
      contract.requiresUsageReceipts === true && contract.requiresPortableJsonl === true;
    if (!valid) block("MODEL_EVALUATION_INVALID", `Live-model evaluation ${contract.id || "<unnamed>"} is invalid.`);
    const minimumGates = minimumEvaluationGates[contract.id];
    if (!minimumGates || minimumGates.some((gate) => !contract.applicableGates.includes(gate))) {
      block("MODEL_EVALUATION_GATES_WEAKENED", `Live-model evaluation ${contract.id || "<unnamed>"} omits a mandatory gate.`);
    }
  }
  return blockers;
}

export function admitLiveModelEvaluation(
  contract: LiveModelEvaluationContract,
  observations: LiveModelRunObservation[],
  authorities: LiveModelEvaluationAuthorities,
): LiveModelEvaluationAdmission {
  const blockers: LiveModelEvaluationAdmission["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  const expectedRuns = contract.caseIds.length * contract.repetitions;
  const seen = new Set<string>();
  const runIds = new Set<string>();
  let totalUsage: LiveModelBudgetAmount = { usd: 0, inputTokens: 0, outputTokens: 0, requests: 0, aiCredits: 0 };

  for (const observation of observations) {
    const identity = `${observation.caseId}:${observation.repetition}`;
    if (seen.has(identity)) block("MODEL_RUN_DUPLICATE", `Duplicate model run ${identity}.`);
    seen.add(identity);
    if (!observation.runId.trim() || runIds.has(observation.runId)) {
      block("MODEL_RUN_ID_INVALID", `Model run ${identity} has an empty or reused run ID.`);
    }
    runIds.add(observation.runId);
    const expectedIdentity = observation.evaluationId === contract.id &&
      contract.caseIds.includes(observation.caseId) &&
      Number.isSafeInteger(observation.repetition) &&
      observation.repetition >= 1 && observation.repetition <= contract.repetitions &&
      observation.providerId === contract.providerId &&
      observation.requestedModel === contract.requestedModel;
    const resolvedVersionValid = contract.resolvedVersionPolicy === "exact"
      ? observation.status !== "completed" || observation.resolvedModelVersion === contract.expectedResolvedVersion
      : observation.status !== "completed" || Boolean(observation.resolvedModelVersion?.trim());
    const outcomeValid = observation.status === "completed"
      ? observation.responseSha256 !== null && observation.errorCode === null
      : observation.semanticPass === false && Boolean(observation.errorCode?.trim());
    const evidenceValid = validAmount(observation.usage) &&
      observation.usage.requests >= (observation.status === "completed" ? 1 : 0) &&
      Number.isFinite(observation.latencyMs) && observation.latencyMs >= 0 &&
      digestPattern.test(observation.usageReceiptSha256) &&
      (observation.responseSha256 === null || digestPattern.test(observation.responseSha256)) &&
      digestPattern.test(observation.caseDefinitionSha256) &&
      digestPattern.test(observation.graderSha256) &&
      digestPattern.test(observation.gradedArtifactSha256) &&
      digestPattern.test(observation.gradeOutputSha256) &&
      Number.isFinite(Date.parse(observation.completedAt)) &&
      Number.isFinite(Date.parse(observation.issuedAt)) &&
      Number.isFinite(Date.parse(observation.expiresAt)) &&
      Date.parse(observation.completedAt) <= Date.parse(observation.issuedAt) &&
      Date.parse(observation.issuedAt) < Date.parse(observation.expiresAt) &&
      Boolean(observation.producerIdentity.trim()) &&
      Boolean(observation.signature.trim()) &&
      outcomeValid &&
      observation.usageReceiptSha256 === modelUsageEvidenceSha256({
        evaluationId: observation.evaluationId,
        caseId: observation.caseId,
        repetition: observation.repetition,
        providerId: observation.providerId,
        requestedModel: observation.requestedModel,
        resolvedModelVersion: observation.resolvedModelVersion,
        usage: observation.usage,
        responseSha256: observation.responseSha256,
        completedAt: observation.completedAt,
      }) &&
      observation.gradeOutputSha256 === sha256(canonical({ semanticPass: observation.semanticPass })) &&
      authorities.verifyObservation(observation);
    if (!expectedIdentity || !resolvedVersionValid || !evidenceValid) {
      block("MODEL_RUN_INVALID", `Model run ${identity} is untrusted or misbound.`);
    }
    totalUsage = add(totalUsage, observation.usage);
  }
  for (const caseId of contract.caseIds) {
    for (let repetition = 1; repetition <= contract.repetitions; repetition += 1) {
      if (!seen.has(`${caseId}:${repetition}`)) block("MODEL_RUN_MISSING", `Missing model run ${caseId}:${repetition}.`);
    }
  }
  if (observations.length !== expectedRuns) block("MODEL_DENOMINATOR_INCOMPLETE", "Every declared case and repetition must be attempted exactly once.");

  const semanticPasses = observations.filter((run) => run.status === "completed" && run.semanticPass).length;
  const errors = observations.filter((run) => run.status !== "completed").length;
  const semanticPassRate = expectedRuns === 0 ? 0 : semanticPasses / expectedRuns;
  const errorRate = expectedRuns === 0 ? 1 : errors / expectedRuns;
  const latencies = observations.map((run) => run.latencyMs).sort((left, right) => left - right);
  const p95LatencyMs = latencies.length === 0 ? Number.POSITIVE_INFINITY : latencies[Math.ceil(latencies.length * 0.95) - 1];
  if (semanticPassRate < contract.thresholds.minimumSemanticPassRate) block("MODEL_SEMANTIC_THRESHOLD_FAILED", "Semantic pass rate is below the frozen threshold.");
  if (errorRate > contract.thresholds.maximumErrorRate) block("MODEL_ERROR_THRESHOLD_FAILED", "Provider error rate exceeds the frozen threshold.");
  if (p95LatencyMs > contract.thresholds.maximumP95LatencyMs) block("MODEL_LATENCY_THRESHOLD_FAILED", "Provider p95 latency exceeds the frozen threshold.");
  if (exceeds(totalUsage, contract.budget)) block("MODEL_EVALUATION_BUDGET_EXCEEDED", "Observed model usage exceeds the reserved evaluation budget.");
  if (contract.qualityDenominator) {
    const reports = new Set<string>();
    let attemptedEpisodes = 0;
    let independentNegativeTimelines = 0;
    const arms = new Set<string>();
    for (const observation of observations) {
      const denominator = observation.qualityDenominator;
      if (!denominator || !digestPattern.test(denominator.reportSha256)) {
        block("MODEL_QUALITY_DENOMINATOR_MISSING", `Model run ${observation.caseId}:${observation.repetition} lacks a bound quality denominator.`);
        continue;
      }
      if (reports.has(denominator.reportSha256)) {
        block("MODEL_QUALITY_REPORT_REUSED", `Quality report ${denominator.reportSha256} was reused across observations.`);
        continue;
      }
      reports.add(denominator.reportSha256);
      attemptedEpisodes += denominator.attemptedEpisodes;
      independentNegativeTimelines += denominator.independentNegativeTimelines;
      denominator.arms.forEach((arm) => arms.add(arm));
    }
    if (attemptedEpisodes < contract.qualityDenominator.minimumAttemptedEpisodes) {
      block("MODEL_QUALITY_ATTEMPTS_INCOMPLETE", "Memory evaluation did not reach the frozen attempted-episode denominator.");
    }
    if (independentNegativeTimelines < contract.qualityDenominator.minimumIndependentNegativeTimelines) {
      block("MODEL_QUALITY_NEGATIVE_DENOMINATOR_INCOMPLETE", "Memory evaluation did not reach the independent negative-timeline denominator.");
    }
    if (contract.qualityDenominator.requiredArms.some((arm) => !arms.has(arm))) {
      block("MODEL_QUALITY_ARM_MISSING", "Memory evaluation did not cover every frozen comparison arm.");
    }
  }

  return {
    outcome: blockers.length === 0 ? "PASSED" : "FAILED",
    blockers,
    expectedRuns,
    attemptedRuns: observations.length,
    semanticPassRate,
    errorRate,
    p95LatencyMs,
    totalUsage,
  };
}

export interface LiveModelCaseRunner {
  run(input: {
    contract: LiveModelEvaluationContract;
    caseId: string;
    repetition: number;
  }): Promise<LiveModelRunObservation>;
}

export async function runLiveModelEvaluation(
  contract: LiveModelEvaluationContract,
  runner: LiveModelCaseRunner,
  authorities: LiveModelEvaluationAuthorities,
): Promise<{ observations: LiveModelRunObservation[]; admission: LiveModelEvaluationAdmission }> {
  const observations: LiveModelRunObservation[] = [];
  for (const caseId of contract.caseIds) {
    for (let repetition = 1; repetition <= contract.repetitions; repetition += 1) {
      try {
        observations.push(await runner.run({ contract, caseId, repetition }));
      } catch {
        const admission = admitLiveModelEvaluation(contract, observations, authorities);
        return {
          observations,
          admission: {
            ...admission,
            outcome: "FAILED",
            blockers: [
              ...admission.blockers,
              { code: "MODEL_RUNNER_ABORTED", message: `The evaluator failed before recording ${caseId}:${repetition}.` },
            ],
          },
        };
      }
    }
  }
  return { observations, admission: admitLiveModelEvaluation(contract, observations, authorities) };
}