// @vitest-environment node
import { describe, expect, it } from "vitest";

import { buildEvaluationCanaryReport, verifyEvaluationCanaryReport } from "./evaluationCostGate";
import type { LiveModelEvaluationContract } from "./modelEvaluation";
import type { ModelCaseDefinition } from "./modelCases";

const contract: LiveModelEvaluationContract = {
  id: "implementation-agent-smoke",
  purpose: "implementation-agent",
  applicableGates: ["G00", "G08"],
  providerId: "github-copilot",
  requestedModel: "gpt-5.4",
  resolvedVersionPolicy: "observed",
  expectedResolvedVersion: null,
  caseIds: ["bounded-read", "bounded-edit", "validation-and-submit"],
  repetitions: 3,
  thresholds: { minimumSemanticPassRate: 1, maximumErrorRate: 0, maximumP95LatencyMs: 180_000 },
  budget: { usd: 0, inputTokens: 270_000, outputTokens: 27_000, requests: 36, aiCredits: 270 },
  staging: {
    canaryCaseId: "bounded-read",
    canaryRepetitions: 1,
    maximumWallClockMs: 240_000,
    budget: { usd: 0, inputTokens: 30_000, outputTokens: 3_000, requests: 4, aiCredits: 30 },
    qualificationReason: "Prove the complete path before qualification.",
    stopCondition: "Stop on any canary failure.",
  },
  requiresUsageReceipts: true,
  requiresPortableJsonl: true,
};
const definition: ModelCaseDefinition = {
  id: "bounded-read",
  input: "Read, validate, and submit without editing.",
  oracle: {
    kind: "gateway-contract",
    requiredTools: ["watai_read_file", "watai_run_validation", "watai_submit_result"],
    requireSubmission: true,
    expectedChangedPaths: [],
  },
};
const result = {
  status: "completed" as const,
  artifact: {
    kind: "gateway-contract" as const,
    toolIds: ["watai_read_file", "watai_run_validation", "watai_submit_result"],
    submitted: true,
    changedPaths: [],
  },
  latencyMs: 30_000,
  usage: { usd: 0, inputTokens: 1_000, outputTokens: 100, requests: 1, aiCredits: 1 },
  responseSha256: "a".repeat(64),
  resolvedModelVersion: "gpt-5.4-test",
  errorCode: null,
  completedAt: "2026-09-10T11:00:30.000Z",
};

describe("evaluation cost gate", () => {
  it("permits qualification only after a bound passing canary", () => {
    const report = buildEvaluationCanaryReport({
      sourceSha: "b".repeat(40),
      runtimeImageSha256: "c".repeat(64),
      contract,
      definition,
      startedAt: "2026-09-10T11:00:00.000Z",
      completedAt: "2026-09-10T11:00:30.000Z",
      result,
    });
    expect(report).toMatchObject({
      status: "CANARY_PASSED",
      decision: { canaryMaximumMinutes: 4, canaryMaximumAiCredits: 30, fullQualificationMaximumAiCredits: 270 },
    });
    expect(verifyEvaluationCanaryReport({
      report,
      sourceSha: "b".repeat(40),
      runtimeImageSha256: "c".repeat(64),
      contract,
      definition,
      now: Date.parse("2026-09-10T11:01:00.000Z"),
    })).toEqual([]);
  });

  it("stops qualification for failed, over-budget, stale or misbound canaries", () => {
    const report = buildEvaluationCanaryReport({
      sourceSha: "b".repeat(40),
      runtimeImageSha256: "c".repeat(64),
      contract,
      definition,
      startedAt: "2026-09-10T11:00:00.000Z",
      completedAt: "2026-09-10T11:05:00.000Z",
      result: { ...result, status: "failed", usage: { ...result.usage, aiCredits: 31 } },
    });
    expect(report.blockers.map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "CANARY_PROVIDER_FAILED", "CANARY_TIME_EXCEEDED", "CANARY_BUDGET_EXCEEDED",
    ]));
    expect(verifyEvaluationCanaryReport({
      report,
      sourceSha: "d".repeat(40),
      runtimeImageSha256: "c".repeat(64),
      contract,
      definition,
      now: Date.parse("2026-09-10T14:00:00.000Z"),
    }).map((blocker) => blocker.code)).toEqual(expect.arrayContaining([
      "CANARY_NOT_PASSED", "CANARY_BINDING_MISMATCH", "CANARY_STALE",
    ]));
  });
});
