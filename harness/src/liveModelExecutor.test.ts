// @vitest-environment node
import { describe, expect, it, vi } from "vitest";

import { executeLiveModelEvaluation } from "./liveModelExecutor";
import type { LiveModelEvaluationContract, LiveModelRunObservation } from "./modelEvaluation";
import type { ModelCaseDefinition } from "./modelCases";

const contract: LiveModelEvaluationContract = {
  id: "implementation-agent-smoke",
  purpose: "implementation-agent",
  applicableGates: ["G00", "G08"],
  providerId: "github-copilot",
  requestedModel: "gpt-5.4",
  resolvedVersionPolicy: "observed",
  expectedResolvedVersion: null,
  caseIds: ["bounded-read"],
  repetitions: 3,
  thresholds: { minimumSemanticPassRate: 1, maximumErrorRate: 0, maximumP95LatencyMs: 30_000 },
  budget: { usd: 1, inputTokens: 6_000, outputTokens: 600, requests: 3 },
  requiresUsageReceipts: true,
  requiresPortableJsonl: true,
};
const definition: ModelCaseDefinition = {
  id: "bounded-read",
  input: "Read the fixture, validate, and submit.",
  oracle: {
    kind: "gateway-contract",
    requiredTools: ["watai_read_file", "watai_run_validation", "watai_submit_result"],
    requireSubmission: true,
  },
};

function signed(
  observation: Omit<LiveModelRunObservation, "producerIdentity" | "issuedAt" | "expiresAt" | "signature">,
): LiveModelRunObservation {
  return {
    ...observation,
    producerIdentity: "independent-live-evaluator",
    issuedAt: observation.completedAt,
    expiresAt: "2026-09-10T12:00:00.000Z",
    signature: `trusted:${observation.runId}`,
  };
}

describe("live-model executor", () => {
  it("reserves before calls, grades each repetition, signs observations and settles actual usage", async () => {
    const order: string[] = [];
    const reserve = vi.fn(async () => { order.push("reserve"); return { reservationId: "eval-reservation" }; });
    const settle = vi.fn(async () => { order.push("settle"); });
    const adapter = {
      providerId: "github-copilot",
      run: vi.fn(async () => {
        order.push("call");
        return {
          status: "completed" as const,
          artifact: {
            kind: "gateway-contract" as const,
            toolIds: ["watai_read_file", "watai_run_validation", "watai_submit_result"],
            submitted: true,
            changedPaths: [],
          },
          latencyMs: 1_000,
          usage: { usd: 0.1, inputTokens: 1_000, outputTokens: 100, requests: 1 },
          responseSha256: "b".repeat(64),
          resolvedModelVersion: "gpt-5.4-2026-03-05",
          errorCode: null,
          completedAt: "2026-09-10T11:00:00.000Z",
        };
      }),
    };
    const result = await executeLiveModelEvaluation({
      contract,
      cases: [definition],
      adapter,
      signer: { sign: async (observation) => signed(observation) },
      budget: { reserve, settle, markOutcomeUnknown: vi.fn() },
      authorities: { verifyObservation: (observation) => observation.signature === `trusted:${observation.runId}` },
      graderSha256: "c".repeat(64),
      createRunId: (caseId, repetition) => `${caseId}-${repetition}`,
    });

    expect(result.admission.outcome).toBe("PASSED");
    expect(result.observations).toHaveLength(3);
    expect(order).toEqual(["reserve", "call", "call", "call", "settle"]);
    expect(settle).toHaveBeenCalledWith("eval-reservation", {
      usd: 0.30000000000000004,
      inputTokens: 3_000,
      outputTokens: 300,
      requests: 3,
    });
  });

  it("marks the reservation unknown if the provider adapter escapes without an observation", async () => {
    const markOutcomeUnknown = vi.fn();
    await expect(executeLiveModelEvaluation({
      contract,
      cases: [definition],
      adapter: { providerId: "github-copilot", run: async () => { throw new Error("connection lost"); } },
      signer: { sign: async (observation) => signed(observation) },
      budget: {
        reserve: async () => ({ reservationId: "eval-reservation" }),
        settle: vi.fn(),
        markOutcomeUnknown,
      },
      authorities: { verifyObservation: () => false },
      graderSha256: "c".repeat(64),
      createRunId: (caseId, repetition) => `${caseId}-${repetition}`,
    })).rejects.toThrow("connection lost");
    expect(markOutcomeUnknown).toHaveBeenCalledWith("eval-reservation", "connection lost");
  });
});
