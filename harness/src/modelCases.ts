import { createHash } from "node:crypto";

import type { LiveModelEvaluationManifest } from "./modelEvaluation.js";

export type ModelCaseOracle =
  | {
      kind: "gateway-contract";
      requiredTools: string[];
      requireSubmission: boolean;
      expectedChangedPaths?: string[];
    }
  | { kind: "semantic-action"; expectedAction: string }
  | {
      kind: "event-contract";
      requiredEvents: string[];
      forbiddenEvents: string[];
      minimumToolCalls?: number;
    }
  | { kind: "external-metric"; metric: string };

export interface ModelCaseDefinition {
  id: string;
  input: string;
  oracle: ModelCaseOracle;
}

export interface ModelCaseManifest {
  schemaVersion: "1.0";
  status: "CANDIDATE_FROZEN";
  evaluations: Array<{
    evaluationId: string;
    cases: ModelCaseDefinition[];
  }>;
}

export type ModelCaseArtifact =
  | { kind: "gateway-contract"; toolIds: string[]; submitted: boolean; changedPaths: string[] }
  | { kind: "semantic-action"; selectedAction: string }
  | { kind: "event-contract"; eventTypes: string[]; toolCallCount: number }
  | { kind: "external-metric"; metric: string; passed: boolean; reportSha256: string };

function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function modelCaseManifestSha256(manifest: ModelCaseManifest): string {
  return createHash("sha256").update(canonical(manifest)).digest("hex");
}

export function modelCaseDefinitionSha256(definition: ModelCaseDefinition): string {
  return createHash("sha256").update(canonical(definition)).digest("hex");
}

export function validateModelCaseManifest(
  manifest: ModelCaseManifest,
  evaluations: LiveModelEvaluationManifest,
): Array<{ code: string; message: string }> {
  const blockers: Array<{ code: string; message: string }> = [];
  if (manifest.schemaVersion !== "1.0" || manifest.status !== "CANDIDATE_FROZEN") {
    blockers.push({ code: "MODEL_CASE_MANIFEST_INVALID", message: "Model case manifest header is invalid." });
  }
  const byId = new Map(manifest.evaluations.map((entry) => [entry.evaluationId, entry]));
  if (byId.size !== manifest.evaluations.length) {
    blockers.push({ code: "MODEL_CASE_EVALUATION_DUPLICATE", message: "Model case evaluation IDs must be unique." });
  }
  for (const contract of evaluations.evaluations) {
    const entry = byId.get(contract.id);
    const ids = entry?.cases.map((item) => item.id) ?? [];
    if (canonical([...ids].sort()) !== canonical([...contract.caseIds].sort())) {
      blockers.push({ code: "MODEL_CASE_COVERAGE_MISMATCH", message: `${contract.id} cases do not match its frozen contract.` });
    }
    if (!entry || new Set(ids).size !== ids.length || entry.cases.some((item) => !item.input.trim())) {
      blockers.push({ code: "MODEL_CASE_INVALID", message: `${contract.id} contains missing, duplicate or empty cases.` });
    }
  }
  for (const entry of manifest.evaluations) {
    if (!evaluations.evaluations.some((contract) => contract.id === entry.evaluationId)) {
      blockers.push({ code: "MODEL_CASE_EVALUATION_UNKNOWN", message: `Unknown model evaluation ${entry.evaluationId}.` });
    }
  }
  return blockers;
}

function sameSet(left: string[], right: string[]): boolean {
  return canonical([...new Set(left)].sort()) === canonical([...new Set(right)].sort());
}

export function gradeModelCase(definition: ModelCaseDefinition, artifact: ModelCaseArtifact): boolean {
  if (definition.oracle.kind !== artifact.kind) return false;
  switch (definition.oracle.kind) {
    case "gateway-contract": {
      const value = artifact as Extract<ModelCaseArtifact, { kind: "gateway-contract" }>;
      return definition.oracle.requireSubmission === value.submitted &&
        definition.oracle.requiredTools.every((tool) => value.toolIds.includes(tool)) &&
        (definition.oracle.expectedChangedPaths === undefined ||
          sameSet(definition.oracle.expectedChangedPaths, value.changedPaths));
    }
    case "semantic-action":
      return (artifact as Extract<ModelCaseArtifact, { kind: "semantic-action" }>).selectedAction === definition.oracle.expectedAction;
    case "event-contract": {
      const value = artifact as Extract<ModelCaseArtifact, { kind: "event-contract" }>;
      return definition.oracle.requiredEvents.every((event) => value.eventTypes.includes(event)) &&
        definition.oracle.forbiddenEvents.every((event) => !value.eventTypes.includes(event)) &&
        value.toolCallCount >= (definition.oracle.minimumToolCalls ?? 0);
    }
    case "external-metric": {
      const value = artifact as Extract<ModelCaseArtifact, { kind: "external-metric" }>;
      return value.metric === definition.oracle.metric && value.passed && /^[a-f0-9]{64}$/.test(value.reportSha256);
    }
  }
}
