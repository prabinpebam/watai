// @vitest-environment node
import { describe, expect, it } from "vitest";

import backlogJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/backlog.json";
import policyJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json";
import {
  lockTaskSpec,
  prepareTaskSpec,
  TaskSpecError,
  type AuthorityBindings,
  type BacklogContract,
  type DependencyReceipt,
  type ExecutionPolicy,
  type ImpactAssessment,
  type PrepareTaskInput,
  type TaskSpecAuthorities,
} from "./taskSpec";

const backlog = backlogJson as BacklogContract;
const policy = policyJson as ExecutionPolicy;
const now = Date.parse("2026-09-10T11:00:00.000Z");
const digest = (character: string) => character.repeat(64);
const sourceSha = "a".repeat(40);
const policySha256 = digest("b");

const bindings: AuthorityBindings = {
  backlogSha256: digest("a"),
  policySha256,
  workflowSha256: digest("c"),
  planSchemaSha256: digest("0"),
  controllerSha256: digest("9"),
  evaluatorPackSha256: digest("d"),
  testInventorySha256: digest("e"),
  fixtureManifestSha256: digest("f"),
  toolchainSha256: digest("1"),
  dependencyLockSha256: digest("2"),
  impactMapSha256: digest("3"),
  negativeControlIds: ["NC-forged-proof", "NC-path-escape"],
};

const authorities: TaskSpecAuthorities = {
  now: () => now,
  verifyAuthorization: () => false,
  verifyCapability: (attestation) => attestation.signature === `trusted:${attestation.capability}`,
  verifyDependencyReceipt: (receipt) => receipt.signature === `trusted:${receipt.sliceId}`,
  verifyImpactAssessment: (assessment) => assessment.signature === `trusted:${assessment.assessmentId}`,
  verifyTaskSpecLock: (proof) => proof.signature === `trusted:${proof.lockId}`,
};

const impact = (sliceId: string, plannedPaths: string[] = []): ImpactAssessment => ({
  assessmentId: `impact-${sliceId}`,
  sliceId,
  executionDomain: sliceId === "H01"
    ? "read-only"
    : sliceId === "H02"
      ? "policy"
      : sliceId === "H03"
        ? "controller"
        : sliceId === "H04" || sliceId === "E01"
          ? "evaluator"
          : sliceId === "H05"
            ? "release-plane"
            : sliceId === "H06"
              ? "release"
              : "product",
  sourceSha,
  policySha256,
  impactMapSha256: bindings.impactMapSha256,
  authorizedRoots: plannedPaths,
  plannedPaths,
  gateIds: [],
  issuer: "trusted-impact-map",
  issuedAt: "2026-09-10T10:55:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:impact-${sliceId}`,
});

const input = (overrides: Partial<PrepareTaskInput> = {}): PrepareTaskInput => ({
  mode: "rehearsal",
  sliceId: "H01",
  runId: "run-001",
  fencingEpoch: 1,
  source: {
    repositoryId: "prabinpebam/watai",
    branch: "candidate/H01/run-001",
    baseSha: sourceSha,
    sourceSha,
    treeSha256: digest("4"),
    diffSha256: digest("5"),
    clean: true,
  },
  bindings,
  capabilityAttestations: [],
  dependencyReceipts: [],
  impactAssessment: impact("H01"),
  exactAllowedPaths: [],
  nonGoals: ["No cloud mutation", "No release"],
  allowedTools: ["git-read", "filesystem-read"],
  modelNetworkHosts: [],
  toolNetworkHosts: [],
  preparedAt: "2026-09-10T11:00:00.000Z",
  ...overrides,
});

const receipt = (sliceId: string): DependencyReceipt => ({
  receiptId: `receipt-${sliceId}`,
  sliceId,
  status: "SHIPPED",
  receiptSha256: digest(sliceId === "H01" ? "6" : "7"),
  policySha256,
  compatibleWithSourceSha: sourceSha,
  issuer: "trusted-release-verifier",
  issuedAt: "2026-09-10T10:55:00.000Z",
  expiresAt: "2026-09-10T11:05:00.000Z",
  signature: `trusted:${sliceId}`,
});

describe("TaskSpec preparation", () => {
  it("prepares a deterministic read-only H01 rehearsal", () => {
    const first = prepareTaskSpec(backlog, policy, input(), authorities);
    const second = prepareTaskSpec(backlog, policy, input(), authorities);

    expect(first.outcome).toBe("READY_FOR_REHEARSAL");
    expect(first.blockers).toEqual([]);
    expect(first.draft.taskSpecSha256).toBe(second.draft.taskSpecSha256);
    expect(first.draft.mutationClass).toBe("read-only");
    expect(first.draft.requiredGates).toEqual(
      expect.arrayContaining(["G00", "G01", "G02", "G08", "G09"]),
    );
    expect(first.draft.budgets.maxUsd).toBe(0);
  });

  it("blocks H03 until its complete dependency closure is shipped", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      sliceId: "H03",
      source: { ...input().source, branch: "candidate/H03/run-001" },
      impactAssessment: impact("H03", ["harness/src"]),
      exactAllowedPaths: ["harness/src"],
    }), authorities);

    expect(result.draft.dependencyClosure).toEqual(["H01", "H02"]);
    expect(result.blockers.filter((blocker) => blocker.code === "DEPENDENCY_NOT_SHIPPED"))
      .toHaveLength(2);
  });

  it("unions sticky product gates with slice and impact gates", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      sliceId: "S36",
      source: { ...input().source, branch: "candidate/S36/run-001" },
      dependencyReceipts: [receipt("H01"), receipt("H02"), receipt("H03"), receipt("H04")],
      impactAssessment: { ...impact("S36", ["src/features/voice"]), gateIds: ["G10"] },
      exactAllowedPaths: ["src/features/voice"],
    }), authorities);

    expect(result.draft.requiredGates).toEqual(
      expect.arrayContaining(["G00", "G01", "G02", "G03", "G04", "G05", "G07", "G08", "G09", "G10"]),
    );
  });

  it("blocks candidate writes that overlap protected authority paths", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      sliceId: "S36",
      source: { ...input().source, branch: "candidate/S36/run-001" },
      dependencyReceipts: [receipt("H01"), receipt("H02"), receipt("H03"), receipt("H04")],
      impactAssessment: impact("S36", ["harness/policy"]),
      exactAllowedPaths: ["harness"],
    }), authorities);

    expect(result.blockers.map((blocker) => blocker.code)).toContain("PROTECTED_PATH_OVERLAP");
  });

  it("confines policy-maintainer writes to protected roots", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      sliceId: "H02",
      source: { ...input().source, branch: "candidate/H02/run-001" },
      dependencyReceipts: [receipt("H01")],
      impactAssessment: impact("H02", ["src/features/chat"]),
      exactAllowedPaths: ["src/features/chat"],
    }), authorities);

    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "POLICY_PATH_OUTSIDE_PROTECTED",
    );
  });

  it("confines controller work to protected roots", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      sliceId: "H03",
      source: { ...input().source, branch: "candidate/H03/run-001" },
      dependencyReceipts: [receipt("H01"), receipt("H02")],
      impactAssessment: impact("H03", ["src/features/chat"]),
      exactAllowedPaths: ["src/features/chat"],
    }), authorities);

    expect(result.blockers.map((blocker) => blocker.code)).toContain(
      "CONTROL_PATH_OUTSIDE_PROTECTED",
    );
  });

  it("allows controller and release-plane work in their protected roots", () => {
    const controller = prepareTaskSpec(backlog, policy, input({
      sliceId: "H03",
      source: { ...input().source, branch: "candidate/H03/run-001" },
      dependencyReceipts: [receipt("H01"), receipt("H02")],
      impactAssessment: impact("H03", ["harness/src"]),
      exactAllowedPaths: ["harness/src"],
    }), authorities);
    const releasePlane = prepareTaskSpec(backlog, policy, input({
      sliceId: "H05",
      source: { ...input().source, branch: "candidate/H05/run-001" },
      dependencyReceipts: [receipt("H01"), receipt("H02"), receipt("H03"), receipt("H04")],
      impactAssessment: impact("H05", ["infra"]),
      exactAllowedPaths: ["infra"],
    }), authorities);

    expect(controller.blockers.map((blocker) => blocker.code)).not.toContain(
      "CONTROL_PATH_OUTSIDE_PROTECTED",
    );
    expect(releasePlane.blockers.map((blocker) => blocker.code)).not.toContain(
      "CONTROL_PATH_OUTSIDE_PROTECTED",
    );
  });

  it("keeps implementation blocked under the checked-in zero-authority policy", () => {
    const result = prepareTaskSpec(backlog, policy, input({ mode: "implementation" }), authorities);

    expect(result.outcome).toBe("BLOCKED_SAFE");
    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining([
        "AUTHORIZATION_NOT_GRANTED",
        "CAPABILITY_MISSING:budget-reservation",
      ]),
    );
  });

  it("locks only an unblocked draft with an independent bounded proof", () => {
    const preparation = prepareTaskSpec(backlog, policy, input(), authorities);
    const proof = {
      lockId: "lock-001",
      taskSpecSha256: preparation.draft.taskSpecSha256,
      runId: "run-001",
      sliceId: "H01",
      sourceSha,
      policySha256,
      issuer: "trusted-spec-locker",
      issuedAt: "2026-09-10T10:59:00.000Z",
      expiresAt: "2026-09-10T11:05:00.000Z",
      signature: "trusted:lock-001",
    };

    const locked = lockTaskSpec(preparation, proof, policy, authorities);
    expect(locked.status).toBe("SPEC_LOCKED");
    expect(locked.dispatchAuthorized).toBe(false);

    expect(() => lockTaskSpec(
      preparation,
      { ...proof, taskSpecSha256: digest("9") },
      policy,
      authorities,
    )).toThrowError(TaskSpecError);
  });

  it("rejects path traversal and wildcard tool authority", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      exactAllowedPaths: ["../outside"],
      allowedTools: ["*"],
    }), authorities);

    expect(result.blockers.map((blocker) => blocker.code)).toEqual(
      expect.arrayContaining(["ALLOWED_PATH_INVALID", "TOOL_ALLOWLIST_INVALID"]),
    );
  });

  it("rejects preparation outside trusted clock skew", () => {
    const result = prepareTaskSpec(backlog, policy, input({
      preparedAt: "2026-09-10T12:00:00.000Z",
    }), authorities);
    expect(result.blockers.map((blocker) => blocker.code)).toContain("PREPARED_AT_INVALID");
  });
});