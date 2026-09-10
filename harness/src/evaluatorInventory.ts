import { createHash } from "node:crypto";

export interface EvaluatorCommand {
  id: string;
  cwd: string;
  executable: string;
  args: string[];
  expectedTestFiles: number;
  expectedTests: number;
  repetitions: number;
  requiresIsolatedStage: boolean;
}

export interface EvaluatorInventory {
  schemaVersion: string;
  status: string;
  releaseEligible: boolean;
  commands: EvaluatorCommand[];
  requiredProperties: {
    zeroFailures: boolean;
    zeroSkipped: boolean;
    zeroTimedOut: boolean;
    retries: number;
    candidateProcessUntrusted: boolean;
    supervisorCapturesReports: boolean;
    rawReportsImmutable: boolean;
  };
}

export interface InventoryValidation {
  valid: boolean;
  sha256: string;
  blockers: Array<{ code: string; message: string }>;
}

const requiredCommandIds = [
  "harness-complete",
  "root-unit",
  "root-build",
  "api-unit",
  "api-typecheck",
  "api-build",
  "browser-complete",
  "api-isolated-integration",
];

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) =>
      `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function validateEvaluatorInventory(inventory: EvaluatorInventory): InventoryValidation {
  const blockers: InventoryValidation["blockers"] = [];
  const block = (code: string, message: string) => blockers.push({ code, message });
  if (
    inventory.schemaVersion !== "1.0" ||
    inventory.status !== "CANDIDATE_FROZEN" ||
    inventory.releaseEligible !== false
  ) {
    block("INVENTORY_HEADER_INVALID", "Evaluator inventory must be a non-release candidate version 1.0.");
  }
  const ids = inventory.commands.map((command) => command.id);
  if (new Set(ids).size !== ids.length) block("COMMAND_ID_DUPLICATE", "Evaluator command IDs must be unique.");
  for (const id of requiredCommandIds) {
    if (!ids.includes(id)) block("COMMAND_REQUIRED", `Missing evaluator command ${id}.`);
  }
  for (const command of inventory.commands) {
    const valid =
      /^[a-z][a-z0-9-]+$/.test(command.id) &&
      (command.cwd === "." || command.cwd === "api") &&
      command.executable === "npm" &&
      command.args.length > 0 &&
      command.args.every((argument) => !/[\r\n\0;&|<>]/.test(argument)) &&
      Number.isSafeInteger(command.expectedTestFiles) && command.expectedTestFiles >= 0 &&
      Number.isSafeInteger(command.expectedTests) && command.expectedTests >= 0 &&
      Number.isSafeInteger(command.repetitions) && command.repetitions >= 1 && command.repetitions <= 3;
    if (!valid) block("COMMAND_INVALID", `Evaluator command ${command.id || "<unnamed>"} is invalid.`);
  }
  const browser = inventory.commands.find((command) => command.id === "browser-complete");
  if (!browser || browser.repetitions !== 3 || browser.expectedTests !== 44) {
    block("BROWSER_INVENTORY_INVALID", "Browser inventory must run all 44 applicable checks three times.");
  }
  const integration = inventory.commands.find((command) => command.id === "api-isolated-integration");
  if (!integration || !integration.requiresIsolatedStage || integration.expectedTests !== 11) {
    block("INTEGRATION_INVENTORY_INVALID", "All 11 API integrations require an isolated stage target.");
  }
  const properties = inventory.requiredProperties;
  if (
    !properties.zeroFailures ||
    !properties.zeroSkipped ||
    !properties.zeroTimedOut ||
    properties.retries !== 0 ||
    !properties.candidateProcessUntrusted ||
    !properties.supervisorCapturesReports ||
    !properties.rawReportsImmutable
  ) {
    block("EVALUATOR_PROPERTIES_WEAKENED", "Evaluator hard properties cannot be weakened.");
  }
  return {
    valid: blockers.length === 0,
    sha256: createHash("sha256").update(canonical(inventory)).digest("hex"),
    blockers,
  };
}

export interface ImpactMap {
  schemaVersion: string;
  status: string;
  domains: Array<{
    id: string;
    allowedRoots: string[];
    requiredGates: string[];
    mayMutate: boolean;
  }>;
}

export function validateImpactMap(map: ImpactMap): InventoryValidation {
  const blockers: InventoryValidation["blockers"] = [];
  const expectedDomains = ["read-only", "policy", "controller", "evaluator", "release-plane", "release", "product"];
  const ids = map.domains.map((domain) => domain.id);
  if (map.schemaVersion !== "1.0" || map.status !== "CANDIDATE_FROZEN") {
    blockers.push({ code: "IMPACT_MAP_HEADER_INVALID", message: "Impact map header is invalid." });
  }
  if (new Set(ids).size !== ids.length || expectedDomains.some((id) => !ids.includes(id))) {
    blockers.push({ code: "IMPACT_DOMAIN_MISSING", message: "Impact map domains are incomplete or duplicated." });
  }
  for (const domain of map.domains) {
    if (
      new Set(domain.allowedRoots).size !== domain.allowedRoots.length ||
      new Set(domain.requiredGates).size !== domain.requiredGates.length ||
      domain.requiredGates.some((gate) => !/^G\d{2}$/.test(gate)) ||
      domain.allowedRoots.some((root) => !root || root.startsWith("/") || root.includes(".."))
    ) {
      blockers.push({ code: "IMPACT_DOMAIN_INVALID", message: `Impact domain ${domain.id} is invalid.` });
    }
  }
  for (const id of ["policy", "controller", "evaluator", "release-plane"]) {
    const domain = map.domains.find((entry) => entry.id === id);
    if (!domain?.requiredGates.includes("G12")) {
      blockers.push({ code: "IMPACT_POLICY_GATE_MISSING", message: `${id} must require G12.` });
    }
  }
  return {
    valid: blockers.length === 0,
    sha256: createHash("sha256").update(canonical(map)).digest("hex"),
    blockers,
  };
}

export interface NegativeControlRegistry {
  schemaVersion: string;
  status: string;
  ids: string[];
}

export function validateNegativeControls(registry: NegativeControlRegistry): InventoryValidation {
  const blockers: InventoryValidation["blockers"] = [];
  if (registry.schemaVersion !== "1.0" || registry.status !== "CANDIDATE_FROZEN") {
    blockers.push({ code: "NEGATIVE_CONTROL_HEADER_INVALID", message: "Negative-control header is invalid." });
  }
  if (
    registry.ids.length < 10 ||
    new Set(registry.ids).size !== registry.ids.length ||
    registry.ids.some((id) => !/^NC-[a-z0-9-]+$/.test(id))
  ) {
    blockers.push({ code: "NEGATIVE_CONTROL_IDS_INVALID", message: "Negative-control IDs are incomplete or invalid." });
  }
  return {
    valid: blockers.length === 0,
    sha256: createHash("sha256").update(canonical(registry)).digest("hex"),
    blockers,
  };
}