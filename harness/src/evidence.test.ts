// @vitest-environment node
import { describe, expect, it } from "vitest";

import policyJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json";
import type { ExecutionPolicy, LockedTaskSpec } from "./taskSpec";
import {
  admitCandidateEvidence,
  type CandidateEvidencePacket,
  type EvidenceSubject,
} from "./evidence";

const digest = (character: string) => character.repeat(64);
const now = Date.parse("2026-09-10T11:00:00.000Z");
const sourceSha = "a".repeat(40);
const task = (): LockedTaskSpec => ({
  schemaVersion: "1.0",
  status: "SPEC_LOCKED",
  releaseEligible: false,
  dispatchAuthorized: true,
  mode: "implementation",
  runId: "run-evidence",
  sliceId: "S99",
  title: "Fixture slice",
  milestone: "M0",
  risk: "high",
  ownerRole: "builder",
  executionDomain: "product",
  mutationClass: "candidate",
  fencingEpoch: 1,
  source: {
    repositoryId: "prabinpebam/watai",
    branch: "candidate/S99/run-evidence",
    baseSha: sourceSha,
    sourceSha,
    treeSha256: digest("1"),
    diffSha256: digest("2"),
    clean: true,
  },
  bindings: {
    backlogSha256: digest("3"),
    policySha256: digest("4"),
    workflowSha256: digest("5"),
    planSchemaSha256: digest("0"),
    controllerSha256: digest("d"),
    evaluatorPackSha256: digest("6"),
    testInventorySha256: digest("7"),
    fixtureManifestSha256: digest("8"),
    toolchainSha256: digest("9"),
    dependencyLockSha256: digest("a"),
    impactMapSha256: digest("b"),
    negativeControlIds: ["NC-forged-proof"],
  },
  dependencyClosure: [],
  dependencyReceipts: [],
  allowedPaths: ["src/fixture"],
  nonGoals: ["No release"],
  allowedTools: ["watai_read_file"],
  agentRuntime: { providerId: "copilot", model: "gpt-5" },
  validationCommands: [{
    id: "fixture-tests", executable: "npm", args: ["test"], cwd: "src/fixture",
    timeoutMs: 60_000, maxOutputBytes: 1024 * 1024,
  }],
  modelNetworkHosts: ["api.githubcopilot.com"],
  toolNetworkHosts: [],
  deniedAuthorities: ["production-network"],
  requiredGates: ["G02", "G05"],
  requiredAcceptanceIds: ["S99-A", "S99-B"],
  requiredAcceptance: [
    { id: "S99-A", gate: "G02", check: "Regression passes." },
    { id: "S99-B", gate: "G05", check: "Recovery passes." },
  ],
  requiredEvidenceKinds: ["adversarial", "regression"],
  requiredModelEvaluationIds: [],
  negativeControlIds: ["NC-forged-proof"],
  visibleOutcome: "Fixture",
  rolloutProfile: "control-plane",
  rolloutSteps: ["Stage"],
  rollback: "Revert",
  budgets: {
    maxAttempts: 3,
    maxActiveMinutes: 360,
    maxAttemptMinutes: 45,
    maxUsd: 0,
    maxInputTokens: 100,
    maxOutputTokens: 20,
    maxRequests: 2,
    maxAiCredits: 2,
  },
  preparedAt: "2026-09-10T10:00:00.000Z",
  deadline: "2026-09-10T16:00:00.000Z",
  taskSpecSha256: digest("c"),
  lock: {
    lockId: "lock-evidence",
    taskSpecSha256: digest("c"),
    runId: "run-evidence",
    sliceId: "S99",
    sourceSha,
    policySha256: digest("4"),
    issuer: "spec-locker",
    issuedAt: "2026-09-10T10:00:00.000Z",
    expiresAt: "2026-09-10T10:15:00.000Z",
    signature: "signed",
  },
});

function subject(id: string, kind: string, character: string, parents: EvidenceSubject["parents"] = []): EvidenceSubject {
  const sha = digest(character);
  return {
    subjectId: id,
    kind,
    sha256: sha,
    uri: `runs/run-evidence/${sourceSha}/${kind}/${sha}`,
    parents,
  };
}

const packet = (): CandidateEvidencePacket => {
  const current = task();
  return {
    schemaVersion: "1.0",
    status: "EVALUATED",
    releaseEligible: false,
    packetId: "packet-001",
    runId: current.runId,
    sliceId: current.sliceId,
    taskSpecSha256: current.taskSpecSha256,
    source: current.source,
    bindings: current.bindings,
    subjects: [
      subject("regression-result", "regression", "d"),
      subject("adversarial-result", "adversarial", "e", [
        { relation: "derivedFrom", subjectId: "regression-result" },
      ]),
    ],
    checks: [
      {
        checkId: "check-regression",
        acceptanceId: "S99-A",
        gate: "G02",
        resultSubjectId: "regression-result",
        producerRole: "evaluator",
        producerIdentity: "trusted-evaluator",
        issuedAt: "2026-09-10T10:59:00.000Z",
        expiresAt: "2026-09-10T11:05:00.000Z",
        signature: "trusted:check-regression",
        expected: 2,
        attempted: 2,
        passed: 2,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        supervisorObserved: true,
        processTerminated: true,
        reportSha256: digest("f"),
      },
      {
        checkId: "check-recovery",
        acceptanceId: "S99-B",
        gate: "G05",
        resultSubjectId: "adversarial-result",
        producerRole: "evaluator",
        producerIdentity: "trusted-evaluator",
        issuedAt: "2026-09-10T10:59:00.000Z",
        expiresAt: "2026-09-10T11:05:00.000Z",
        signature: "trusted:check-recovery",
        expected: 3,
        attempted: 3,
        passed: 3,
        failed: 0,
        skipped: 0,
        timedOut: 0,
        supervisorObserved: true,
        processTerminated: true,
        reportSha256: digest("1"),
      },
    ],
    negativeControls: [{
      id: "NC-forged-proof",
      expected: "REJECT",
      observed: "REJECT",
      resultSubjectId: "adversarial-result",
    }],
    issuer: "trusted-evaluator",
    issuedAt: "2026-09-10T10:59:00.000Z",
    expiresAt: "2026-09-10T11:05:00.000Z",
    signature: "trusted:packet-001",
  };
};

const authorities = {
  now: () => now,
  verifyEvidencePacket: (value: CandidateEvidencePacket) => value.signature === `trusted:${value.packetId}`,
  verifyEvidenceCheck: (check: CandidateEvidencePacket["checks"][number]) =>
    check.signature === `trusted:${check.checkId}` &&
    (check.producerRole !== "release-verifier" || check.producerIdentity === "trusted-release-verifier"),
};
const policy = policyJson as ExecutionPolicy;

describe("candidate evidence admission", () => {
  it("requires the exact live-model evaluation selected by the TaskSpec", () => {
    const value = task();
    value.requiredEvidenceKinds.push("model-eval");
    value.requiredModelEvaluationIds = ["responses-streaming-tools-live"];
    const valuePacket = packet();
    valuePacket.subjects.push({
      subjectId: "model-result",
      kind: "model-eval",
      evaluationId: "semantic-routing-live",
      sha256: digest("e"),
      uri: `runs/${value.runId}/${value.source.sourceSha}/model-eval/${digest("e")}`,
      parents: [],
    });

    const result = admitCandidateEvidence(value, policy, valuePacket, authorities);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("MODEL_EVALUATION_MISSING");
  });

  it("accepts only complete trusted evidence for every acceptance and gate", () => {
    const result = admitCandidateEvidence(task(), policy, packet(), authorities);
    expect(result.outcome).toBe("CANDIDATE_VALID");
    expect(result.blockers).toEqual([]);
    expect(result.passedGates).toEqual(["G02", "G05"]);
  });

  it.each([
    ["skipped denominator", (value: CandidateEvidencePacket) => { value.checks[0].passed = 1; value.checks[0].skipped = 1; }, "CHECK_FAILED", "FAILED"],
    ["builder producer", (value: CandidateEvidencePacket) => { value.checks[0].producerRole = "builder"; }, "CHECK_FAILED", "FAILED"],
    ["missing negative control", (value: CandidateEvidencePacket) => { value.negativeControls = []; }, "NEGATIVE_CONTROL_FAILED", "FAILED"],
    ["changed source", (value: CandidateEvidencePacket) => { value.source.sourceSha = "b".repeat(40); }, "PACKET_BINDING_MISMATCH", "QUARANTINED"],
    ["missing DAG parent", (value: CandidateEvidencePacket) => { value.subjects[1].parents[0].subjectId = "missing"; }, "SUBJECT_PARENT_MISSING", "QUARANTINED"],
    ["forged gate producer", (value: CandidateEvidencePacket) => {
      value.checks[0].gate = "G01";
      value.checks[0].producerRole = "release-verifier";
      value.checks[0].producerIdentity = "trusted-evaluator";
      value.checks[0].acceptanceId = null;
      value.checks[0].signature = "trusted:check-regression";
    }, "CHECK_FAILED", "FAILED"],
  ])("rejects %s", (_label, mutate, code, outcome) => {
    const value = packet();
    mutate(value);
    const result = admitCandidateEvidence(task(), policy, value, authorities);
    expect(result.outcome).toBe(outcome);
    expect(result.blockers.map((blocker) => blocker.code)).toContain(code);
  });
});