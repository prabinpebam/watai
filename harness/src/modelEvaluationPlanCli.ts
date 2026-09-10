import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateLiveModelEvaluationManifest,
  type LiveModelEvaluationManifest,
} from "./modelEvaluation.js";
import {
  modelCaseManifestSha256,
  validateModelCaseManifest,
  type ModelCaseManifest,
} from "./modelCases.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = resolve(root, "harness", "evaluator", "model-evaluations.json");
const caseManifestPath = resolve(root, "harness", "evaluator", "model-cases.json");
const [manifest, cases] = await Promise.all([
  readFile(manifestPath, "utf8").then((value) => JSON.parse(value) as LiveModelEvaluationManifest),
  readFile(caseManifestPath, "utf8").then((value) => JSON.parse(value) as ModelCaseManifest),
]);
const blockers = validateLiveModelEvaluationManifest(manifest);
blockers.push(...validateModelCaseManifest(cases, manifest));
const totals = manifest.evaluations.reduce((sum, evaluation) => ({
  evaluations: sum.evaluations + 1,
  runs: sum.runs + evaluation.caseIds.length * evaluation.repetitions,
  usd: sum.usd + evaluation.budget.usd,
  inputTokens: sum.inputTokens + evaluation.budget.inputTokens,
  outputTokens: sum.outputTokens + evaluation.budget.outputTokens,
  requests: sum.requests + evaluation.budget.requests,
  aiCredits: sum.aiCredits + evaluation.budget.aiCredits,
}), { evaluations: 0, runs: 0, usd: 0, inputTokens: 0, outputTokens: 0, requests: 0, aiCredits: 0 });
const maximumSingleEvaluationUsd = Math.max(...manifest.evaluations.map((evaluation) => evaluation.budget.usd));

console.log(JSON.stringify({
  schemaVersion: "1.0",
  status: blockers.length === 0 ? "MANIFEST_VALID_NOT_AUTHORIZED" : "BLOCKED_SAFE",
  releaseEligible: false,
  manifestPath: "harness/evaluator/model-evaluations.json",
  caseManifestPath: "harness/evaluator/model-cases.json",
  caseManifestSha256: modelCaseManifestSha256(cases),
  catalogCeilingsNotRunAuthorization: totals,
  maximumSingleEvaluationUsd,
  evaluations: manifest.evaluations.map((evaluation) => ({
    id: evaluation.id,
    purpose: evaluation.purpose,
    expectedRuns: evaluation.caseIds.length * evaluation.repetitions,
    budget: evaluation.budget,
    staging: evaluation.staging ?? null,
    thresholds: evaluation.thresholds,
    qualityDenominator: evaluation.qualityDenominator ?? null,
  })),
  blockers,
  next: "Select only TaskSpec-required evaluations, reserve each separately within policy, then use a credential-isolated provider adapter and independent observation signer. This command makes no model call or spending grant.",
}, null, 2));
if (blockers.length > 0) process.exitCode = 2;