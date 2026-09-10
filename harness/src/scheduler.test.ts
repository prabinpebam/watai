// @vitest-environment node
import { describe, expect, it } from "vitest";

import backlogJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/backlog.json";
import policyJson from "../../documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json";
import { selectNextSlice, type SliceCompletion, type ValueAssessment } from "./scheduler";
import type { BacklogContract, ExecutionPolicy } from "./taskSpec";

const backlog = backlogJson as BacklogContract;
const policy = policyJson as ExecutionPolicy;
const complete = (sliceId: string, verified = true): SliceCompletion => ({
  sliceId,
  status: "SHIPPED",
  receiptSha256: "a".repeat(64),
  verified,
});

describe("backlog scheduler", () => {
  it("starts with H01 and does not skip dependency bootstrap", () => {
    const decision = selectNextSlice(backlog, policy, [], []);
    expect(decision.selected?.id).toBe("H01");
    expect(decision.ready).toEqual(["H01"]);
  });

  it("selects H02 only after a verified H01 receipt", () => {
    expect(selectNextSlice(backlog, policy, [complete("H01", false)], []).selected?.id).toBe("H01");
    expect(selectNextSlice(backlog, policy, [complete("H01")], []).selected?.id).toBe("H02");
  });

  it("does not schedule H03 until H02 is also shipped", () => {
    const decision = selectNextSlice(backlog, policy, [complete("H01")], []);
    expect(decision.ready).not.toContain("H03");
    expect(decision.blocked.find((item) => item.sliceId === "H03")?.reasons)
      .toContain("dependency:H02");
  });

  it("stops at the configured product WIP ceiling", () => {
    const completed = backlog.slices
      .filter((slice) => slice.id.startsWith("H"))
      .map((slice) => complete(slice.id));
    const productOnly = {
      ...backlog,
      slices: backlog.slices.filter((slice) => ["S01", "S02"].includes(slice.id)),
    };
    const active = [
      { runId: "run-a", sliceId: "S90", state: "VALIDATING", ownerRole: "builder" },
      { runId: "run-b", sliceId: "S91", state: "BUILDING", ownerRole: "builder" },
    ];
    const decision = selectNextSlice(productOnly, policy, completed, active);
    expect(decision.selected).toBeNull();
    expect(decision.reason).toBe("WIP_OR_BUILDER_LIMIT_REACHED");
  });

  it("schedules ready control-plane work while builder capacity is full", () => {
    const decision = selectNextSlice(backlog, policy, [complete("H01")], [
      { runId: "run-builder", sliceId: "S01", state: "BUILDING", ownerRole: "builder" },
    ]);

    expect(decision.selected?.id).toBe("H02");
  });

  it("uses value per effort only among equally safe ready slices", () => {
    const equalSafety = {
      ...backlog,
      slices: backlog.slices
        .filter((slice) => ["S36", "S41"].includes(slice.id))
        .map((slice) => ({ ...slice, dependsOn: [] })),
    };
    const decision = selectNextSlice(equalSafety, policy, [], [], [
      assessment("S36", 5, 4, 4),
      assessment("S41", 4, 4, 1),
    ]);
    expect(decision.priorityMode).toBe("value-per-effort");
    expect(decision.selected?.id).toBe("S41");
  });

  it("never lets value scoring outrank a critical safety slice", () => {
    const mixedSafety = {
      ...backlog,
      slices: backlog.slices
        .filter((slice) => ["S02", "S36"].includes(slice.id))
        .map((slice) => ({ ...slice, dependsOn: [] })),
    };
    const decision = selectNextSlice(mixedSafety, policy, [], [], [
      assessment("S02", 1, 1, 5),
      assessment("S36", 5, 5, 1),
    ]);
    expect(decision.selected?.id).toBe("S02");
  });

  it("blocks conflicting signed priority assessments", () => {
    const result = selectNextSlice(backlog, policy, [], [], [
      assessment("H01", 5, 5, 1),
      assessment("H01", 4, 4, 2),
    ]);
    expect(result.selected).toBeNull();
    expect(result.reason).toBe("PRIORITY_ASSESSMENT_AMBIGUOUS");
  });
});

const assessment = (
  sliceId: string,
  userValue: number,
  riskReduction: number,
  effort: number,
): ValueAssessment => ({
  assessmentId: `value-${sliceId}`,
  sliceId,
  userValue,
  riskReduction,
  effort,
  confidence: 1,
  rationaleSha256: "b".repeat(64),
  policySha256: "c".repeat(64),
  issuer: "trusted-planner",
  issuedAt: "2026-09-10T10:00:00.000Z",
  expiresAt: "2026-09-11T10:00:00.000Z",
  signature: `signed-${sliceId}`,
});