// @vitest-environment node
import { describe, expect, it } from "vitest";

import casesJson from "../evaluator/model-cases.json";
import evaluationsJson from "../evaluator/model-evaluations.json";
import {
  gradeModelCase,
  modelCaseManifestSha256,
  validateModelCaseManifest,
  type ModelCaseManifest,
} from "./modelCases";
import type { LiveModelEvaluationManifest } from "./modelEvaluation";

const cases = casesJson as ModelCaseManifest;
const evaluations = evaluationsJson as LiveModelEvaluationManifest;

describe("live-model case manifest", () => {
  it("binds every declared evaluation case to a concrete input and oracle", () => {
    expect(validateModelCaseManifest(cases, evaluations)).toEqual([]);
    expect(modelCaseManifestSha256(cases)).toMatch(/^[a-f0-9]{64}$/);
  });

  it("grades implementation tools and submission deterministically", () => {
    const definition = cases.evaluations
      .find((entry) => entry.evaluationId === "implementation-agent-smoke")!
      .cases.find((item) => item.id === "bounded-edit")!;
    expect(gradeModelCase(definition, {
      kind: "gateway-contract",
      toolIds: ["watai_read_file", "watai_git_diff", "watai_apply_patch", "watai_run_validation", "watai_submit_result"],
      submitted: true,
      changedPaths: ["src/value.ts"],
    })).toBe(true);
    expect(gradeModelCase(definition, {
      kind: "gateway-contract",
      toolIds: ["watai_read_file", "watai_apply_patch", "watai_submit_result"],
      submitted: true,
      changedPaths: ["src/value.ts"],
    })).toBe(false);
  });

  it("rejects a manifest that omits a frozen case", () => {
    const value = structuredClone(cases);
    value.evaluations[0].cases.pop();
    expect(validateModelCaseManifest(value, evaluations).map((blocker) => blocker.code))
      .toContain("MODEL_CASE_COVERAGE_MISMATCH");
  });
});
