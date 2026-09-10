// @vitest-environment node
import { describe, expect, it } from "vitest";

import inventoryJson from "../evaluator/inventory.json";
import impactMapJson from "../evaluator/impact-map.json";
import negativeControlsJson from "../evaluator/negative-controls.json";
import modelEvaluationsJson from "../evaluator/model-evaluations.json";
import { validateLiveModelEvaluationManifest, type LiveModelEvaluationManifest } from "./modelEvaluation";
import {
  validateEvaluatorInventory,
  validateImpactMap,
  validateNegativeControls,
  type EvaluatorInventory,
  type ImpactMap,
  type NegativeControlRegistry,
} from "./evaluatorInventory";

const inventory = inventoryJson as EvaluatorInventory;
const impactMap = impactMapJson as ImpactMap;
const negativeControls = negativeControlsJson as NegativeControlRegistry;

describe("evaluator inventory", () => {
  it("pins every local and isolated-stage command with zero-skip properties", () => {
    const result = validateEvaluatorInventory(inventory);
    expect(result.valid).toBe(true);
    expect(result.blockers).toEqual([]);
    expect(result.sha256).toMatch(/^[a-f0-9]{64}$/);
  });

  it("pins repeated live-model contracts without treating them as local tests", () => {
    expect(validateLiveModelEvaluationManifest(modelEvaluationsJson as LiveModelEvaluationManifest)).toEqual([]);
    expect(inventory.liveModelEvaluation).toMatchObject({
      execution: "separate-paid-gate",
      minimumRepetitions: 3,
      usageReceiptsRequired: true,
    });
  });

  it.each([
    ["drops integration", (value: EvaluatorInventory) => {
      value.commands = value.commands.filter((command) => command.id !== "api-isolated-integration");
    }, "COMMAND_REQUIRED"],
    ["reduces browser repetitions", (value: EvaluatorInventory) => {
      value.commands.find((command) => command.id === "browser-complete")!.repetitions = 1;
    }, "BROWSER_INVENTORY_INVALID"],
    ["permits skips", (value: EvaluatorInventory) => {
      value.requiredProperties.zeroSkipped = false;
    }, "EVALUATOR_PROPERTIES_WEAKENED"],
    ["removes live usage receipts", (value: EvaluatorInventory) => {
      value.liveModelEvaluation.usageReceiptsRequired = false as true;
    }, "LIVE_MODEL_INVENTORY_INVALID"],
  ])("rejects when it %s", (_label, mutate, code) => {
    const value = structuredClone(inventory);
    mutate(value);
    expect(validateEvaluatorInventory(value).blockers.map((blocker) => blocker.code)).toContain(code);
  });
});

describe("impact map", () => {
  it("pins every execution domain and policy evolution gate", () => {
    expect(validateImpactMap(impactMap)).toMatchObject({ valid: true, blockers: [] });
  });

  it("rejects a control-plane domain that drops G12", () => {
    const value = structuredClone(impactMap);
    value.domains.find((domain) => domain.id === "controller")!.requiredGates = ["G01"];
    expect(validateImpactMap(value).blockers.map((blocker) => blocker.code))
      .toContain("IMPACT_POLICY_GATE_MISSING");
  });
});

describe("negative controls", () => {
  it("pins the fail-closed control registry", () => {
    expect(validateNegativeControls(negativeControls)).toMatchObject({ valid: true, blockers: [] });
  });
});