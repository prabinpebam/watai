// @vitest-environment node
import { describe, expect, it } from "vitest";

import {
  admitLiveModelEvaluation,
  modelUsageEvidenceSha256,
  runLiveModelEvaluation,
  validateLiveModelEvaluationManifest,
  type LiveModelEvaluationContract,
  type LiveModelRunObservation,
} from "./modelEvaluation";
import { canonical, sha256 } from "./trust";

const contract = (): LiveModelEvaluationContract => ({
  id: "implementation-agent-smoke",
  purpose: "implementation-agent",
  applicableGates: ["G00", "G08"],
  providerId: "github-copilot",
  requestedModel: "gpt-5.4",
  resolvedVersionPolicy: "observed",
  expectedResolvedVersion: null,
  caseIds: ["bounded-read", "bounded-edit"],
  repetitions: 3,
  thresholds: { minimumSemanticPassRate: 1, maximumErrorRate: 0, maximumP95LatencyMs: 30_000 },
  budget: { usd: 2, inputTokens: 30_000, outputTokens: 6_000, requests: 6, aiCredits: 6 },
  staging: {
    canaryCaseId: "bounded-read",
    canaryRepetitions: 1,
    maximumWallClockMs: 240_000,
    budget: { usd: 0, inputTokens: 5_000, outputTokens: 1_000, requests: 1, aiCredits: 1 },
    qualificationReason: "Prove one complete path before the repeated denominator.",
    stopCondition: "Stop on any canary failure.",
  },
  requiresUsageReceipts: true,
  requiresPortableJsonl: true,
});
const observations = (): LiveModelRunObservation[] => contract().caseIds.flatMap((caseId) =>
  [1, 2, 3].map((repetition) => {
    const usage = { usd: 0.1, inputTokens: 1_000, outputTokens: 100, requests: 1, aiCredits: 1 };
    const responseSha256 = "b".repeat(64);
    const completedAt = "2026-09-10T11:00:00.000Z";
    return {
    evaluationId: contract().id,
    runId: `${caseId}-${repetition}`,
    caseId,
    repetition,
    providerId: contract().providerId,
    requestedModel: contract().requestedModel,
    resolvedModelVersion: "observed:gpt-5.4",
    status: "completed" as const,
    semanticPass: true,
    latencyMs: 1_000 + repetition,
    usage,
    usageReceiptSha256: modelUsageEvidenceSha256({
      evaluationId: contract().id,
      caseId,
      repetition,
      providerId: contract().providerId,
      requestedModel: contract().requestedModel,
      resolvedModelVersion: "observed:gpt-5.4",
      usage,
      responseSha256,
      completedAt,
    }),
    responseSha256,
    caseDefinitionSha256: "c".repeat(64),
    graderSha256: "d".repeat(64),
    gradedArtifactSha256: "e".repeat(64),
    gradeOutputSha256: sha256(canonical({ semanticPass: true })),
    errorCode: null,
    completedAt,
    producerIdentity: "independent-model-evaluator",
    issuedAt: "2026-09-10T11:00:00.000Z",
    expiresAt: "2026-09-10T11:15:00.000Z",
    signature: `trusted:${caseId}:${repetition}`,
    };
  }),
);
const authorities = {
  verifyObservation: (value: LiveModelRunObservation) => value.signature === `trusted:${value.caseId}:${value.repetition}`,
};

describe("live-model evaluation", () => {
  it("accepts exact repeated denominators with trusted usage and model identity", () => {
    expect(validateLiveModelEvaluationManifest({
      schemaVersion: "1.0",
      status: "CANDIDATE_FROZEN",
      releaseEligible: false,
      evaluations: [contract()],
    })).toEqual([]);
    const result = admitLiveModelEvaluation(contract(), observations(), authorities);
    expect(result).toMatchObject({ outcome: "PASSED", expectedRuns: 6, attemptedRuns: 6, semanticPassRate: 1, errorRate: 0 });
  });

  it("rejects a live-evaluation manifest that drops a mandatory gate", () => {
    const weakened = contract();
    weakened.applicableGates = ["G00"];
    expect(validateLiveModelEvaluationManifest({
      schemaVersion: "1.0",
      status: "CANDIDATE_FROZEN",
      releaseEligible: false,
      evaluations: [weakened],
    }).map((blocker) => blocker.code)).toContain("MODEL_EVALUATION_GATES_WEAKENED");
  });

  it("counts timeouts and missing repetitions as failures instead of dropping them", () => {
    const runs = observations().slice(0, -1);
    runs[0] = {
      ...runs[0],
      status: "timed-out",
      semanticPass: false,
      errorCode: "PROVIDER_TIMEOUT",
      resolvedModelVersion: null,
      issuedAt: "2026-09-10T11:00:01.000Z",
      gradeOutputSha256: sha256(canonical({ semanticPass: false })),
      usageReceiptSha256: modelUsageEvidenceSha256({
        evaluationId: runs[0].evaluationId,
        caseId: runs[0].caseId,
        repetition: runs[0].repetition,
        providerId: runs[0].providerId,
        requestedModel: runs[0].requestedModel,
        resolvedModelVersion: null,
        usage: runs[0].usage,
        responseSha256: runs[0].responseSha256,
        completedAt: runs[0].completedAt,
      }),
    };
    const result = admitLiveModelEvaluation(contract(), runs, authorities);
    expect(result.outcome).toBe("FAILED");
    expect(result.blockers.map((blocker) => blocker.code)).not.toContain("MODEL_RUN_INVALID");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "MODEL_RUN_MISSING",
      "MODEL_DENOMINATOR_INCOMPLETE",
      "MODEL_SEMANTIC_THRESHOLD_FAILED",
      "MODEL_ERROR_THRESHOLD_FAILED",
    ]));
  });

  it("executes every frozen case and repetition through the real-provider adapter port", async () => {
    const runs = observations();
    let index = 0;
    const result = await runLiveModelEvaluation(
      contract(),
      { run: async () => runs[index++] },
      authorities,
    );
    expect(index).toBe(6);
    expect(result.admission.outcome).toBe("PASSED");
  });

  it("fails closed when the provider adapter exits without recording an attempt", async () => {
    const result = await runLiveModelEvaluation(
      contract(),
      { run: async () => { throw new Error("provider unavailable"); } },
      authorities,
    );
    expect(result.admission.outcome).toBe("FAILED");
    expect(result.admission.blockers.map((blocker) => blocker.code)).toContain("MODEL_RUNNER_ABORTED");
  });

  it("requires complete unique underlying quality denominators", () => {
    const qualityContract: LiveModelEvaluationContract = {
      ...contract(),
      purpose: "memory-quality",
      qualityDenominator: {
        minimumAttemptedEpisodes: 6,
        minimumIndependentNegativeTimelines: 6,
        requiredArms: ["A", "B", "C", "D"],
      },
    };
    const runs = observations().map((observation, index) => ({
      ...observation,
      qualityDenominator: {
        attemptedEpisodes: 1,
        independentNegativeTimelines: 1,
        arms: index === 0 ? ["A", "B", "C", "D"] : [],
        reportSha256: index.toString(16).padStart(64, "0"),
      },
    }));
    expect(admitLiveModelEvaluation(qualityContract, runs, authorities).outcome).toBe("PASSED");
    runs[1].qualityDenominator.reportSha256 = runs[0].qualityDenominator.reportSha256;
    const reused = admitLiveModelEvaluation(qualityContract, runs, authorities);
    expect(reused.blockers.map((blocker) => blocker.code)).toContain("MODEL_QUALITY_REPORT_REUSED");
  });
});