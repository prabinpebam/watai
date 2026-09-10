import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { CommandArtifactSigner } from "./externalSigner.js";
import {
  CommandLiveModelProviderAdapter,
  executeLiveModelEvaluation,
} from "./liveModelExecutor.js";
import { SqliteLiveModelBudget } from "./liveModelBudget.js";
import {
  validateLiveModelEvaluationManifest,
  type LiveModelEvaluationManifest,
} from "./modelEvaluation.js";
import {
  validateModelCaseManifest,
  type ModelCaseManifest,
} from "./modelCases.js";
import { writeModelObservationClaims, writePortableModelObservations } from "./modelObservationWriter.js";
import { canonical, sha256 } from "./trust.js";
import {
  loadImplementationAgentEvaluationAuthority,
  loadOperationalAuthority,
} from "./operationalAuthority.js";
import { SqliteHarnessStore } from "./sqliteStore.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const evaluationId = process.argv[2]?.trim();
if (!evaluationId || !/^[a-z][a-z0-9-]+$/.test(evaluationId)) {
  throw new Error("Usage: npm run harness:evaluate-live -- <evaluation-id>");
}

function stringArray(value: string | undefined, label: string): string[] {
  if (!value?.trim()) return [];
  try {
    const parsed = JSON.parse(value) as unknown;
    if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) throw new Error();
    return parsed;
  } catch {
    throw new Error(`${label} must be a JSON string array.`);
  }
}

function selectedEnvironment(names: string[]): Record<string, string> {
  return Object.fromEntries(names.map((name) => {
    const value = process.env[name];
    if (value === undefined) throw new Error(`Required adapter environment ${name} is missing.`);
    return [name, value];
  }));
}

const [manifestText, caseText, graderBytes] = await Promise.all([
  readFile(resolve(root, "harness", "evaluator", "model-evaluations.json"), "utf8"),
  readFile(resolve(root, "harness", "evaluator", "model-cases.json"), "utf8"),
  readFile(resolve(root, ".harness-dist", "modelCases.js")),
]);
const manifest = JSON.parse(manifestText) as LiveModelEvaluationManifest;
const caseManifest = JSON.parse(caseText) as ModelCaseManifest;
const manifestBlockers = validateLiveModelEvaluationManifest(manifest);
const caseBlockers = validateModelCaseManifest(caseManifest, manifest);
if (manifestBlockers.length > 0 || caseBlockers.length > 0) {
  throw new Error(`Live-model contracts are invalid: ${JSON.stringify([...manifestBlockers, ...caseBlockers])}`);
}
const contract = manifest.evaluations.find((candidate) => candidate.id === evaluationId);
const caseSet = caseManifest.evaluations.find((candidate) => candidate.evaluationId === evaluationId);
if (!contract || !caseSet) throw new Error(`Unknown live-model evaluation ${evaluationId}.`);

const smokeWorkerImageSha256 = process.env.WATAI_WORKER_IMAGE_SHA256?.trim() ?? "";
const authority = contract.purpose === "implementation-agent"
  ? await loadImplementationAgentEvaluationAuthority(root, smokeWorkerImageSha256)
  : await loadOperationalAuthority(root, "evaluation");
if (
  contract.budget.usd > authority.policy.limits.evaluationRunUsd ||
  contract.budget.usd > authority.grant.billing.maxUsd ||
  contract.budget.inputTokens > authority.grant.billing.maxInputTokens ||
  contract.budget.outputTokens > authority.grant.billing.maxOutputTokens ||
  contract.budget.requests > authority.grant.billing.maxRequests ||
  contract.budget.aiCredits > authority.grant.billing.maxAiCredits
) {
  throw new Error("Live-model contract exceeds the current signed evaluation grant or policy ceiling.");
}

const signerExecutable = process.env.WATAI_EVIDENCE_SIGNER_EXECUTABLE?.trim();
if (!signerExecutable) throw new Error("WATAI_EVIDENCE_SIGNER_EXECUTABLE is required.");
const signer = new CommandArtifactSigner({
  executable: signerExecutable,
  args: stringArray(process.env.WATAI_EVIDENCE_SIGNER_ARGS_JSON, "WATAI_EVIDENCE_SIGNER_ARGS_JSON"),
  cwd: process.env.WATAI_EVIDENCE_SIGNER_CWD?.trim() || root,
  timeoutMs: 30_000,
});

let adapterExecutable = process.env.WATAI_LIVE_ADAPTER_EXECUTABLE?.trim();
let adapterArgs = stringArray(process.env.WATAI_LIVE_ADAPTER_ARGS_JSON, "WATAI_LIVE_ADAPTER_ARGS_JSON");
let adapterEnvironmentNames = stringArray(
  process.env.WATAI_LIVE_ADAPTER_ENV_NAMES_JSON,
  "WATAI_LIVE_ADAPTER_ENV_NAMES_JSON",
);
if (!adapterExecutable && contract.providerId === "azure-openai") {
  adapterExecutable = process.execPath;
  adapterArgs = [resolve(root, "api", "dist", "live-model-adapter.mjs")];
  adapterEnvironmentNames = [
    "WATAI_PROBE_BASEURL",
    "WATAI_PROBE_KEY",
    "WATAI_EVAL_INPUT_USD_PER_MILLION",
    "WATAI_EVAL_OUTPUT_USD_PER_MILLION",
  ];
}
if (!adapterExecutable && contract.providerId === "github-copilot") {
  adapterExecutable = process.execPath;
  adapterArgs = [resolve(root, ".harness-dist", "copilotSmokeAdapterCli.js")];
  adapterEnvironmentNames = ["WATAI_WORKER_IMAGE_SHA256"];
}
if (!adapterExecutable) {
  throw new Error(`No executable live-model adapter is configured for ${contract.providerId}.`);
}
const adapter = new CommandLiveModelProviderAdapter(contract.providerId, {
  executable: adapterExecutable,
  args: adapterArgs,
  cwd: process.env.WATAI_LIVE_ADAPTER_CWD?.trim() || root,
  timeoutMs: Math.max(contract.thresholds.maximumP95LatencyMs * 2, 30_000),
  environment: selectedEnvironment(adapterEnvironmentNames),
});

const runId = `model-${evaluationId}-${randomUUID()}`;
const evidenceRoot = process.env.WATAI_MODEL_EVIDENCE_ROOT?.trim()
  ? resolve(process.env.WATAI_MODEL_EVIDENCE_ROOT.trim())
  : resolve(root, "..", "watai-harness-evidence");
const stateDirectory = resolve(evidenceRoot, runId);
const store = new SqliteHarnessStore(resolve(root, ".harness-state", "live-model", "evaluation-budget.sqlite"));
try {
  const budget = new SqliteLiveModelBudget(store, `evaluation-grant:${authority.grant.grantId}`, runId, {
    usd: authority.grant.billing.maxUsd,
    inputTokens: authority.grant.billing.maxInputTokens,
    outputTokens: authority.grant.billing.maxOutputTokens,
    requests: authority.grant.billing.maxRequests,
    aiCredits: authority.grant.billing.maxAiCredits,
  });
  const result = await executeLiveModelEvaluation({
    contract,
    cases: caseSet.cases,
    adapter,
    signer,
    budget,
    authorities: authority.authorities,
    graderSha256: createHash("sha256").update(graderBytes).digest("hex"),
    createRunId: (caseId, repetition) => `${runId}:${caseId}:${repetition}`,
  });
  const output = await writePortableModelObservations(
    resolve(stateDirectory, "observations.jsonl"),
    result.observations,
  );
  const claims = await writeModelObservationClaims(resolve(stateDirectory, "claims"), result.observations);
  const observedModelVersions = [...new Set(result.observations
    .map((observation) => observation.resolvedModelVersion)
    .filter((version): version is string => Boolean(version)))].sort();
  const capabilityPayload = {
    evaluationId,
    manifestSha256: sha256(canonical(manifest)),
    outcome: result.admission.outcome,
    expectedRuns: result.admission.expectedRuns,
    attemptedRuns: result.admission.attemptedRuns,
    providerId: contract.providerId,
    requestedModel: contract.requestedModel,
    observedModelVersions,
    reportSha256: sha256(canonical(result.observations)),
    usage: result.admission.totalUsage,
  };
  await writeFile(
    resolve(stateDirectory, "agent-model-capability-payload.json"),
    `${JSON.stringify(capabilityPayload, null, 2)}\n`,
    { encoding: "utf8", flag: "wx", mode: 0o600 },
  );
  console.log(JSON.stringify({
    schemaVersion: "1.0",
    status: result.admission.outcome,
    releaseEligible: false,
    evaluationId,
    runId,
    observationCount: output.count,
    observationsSha256: output.sha256,
    claimDirectory: claims.directory,
    capabilityPayload,
    admission: result.admission,
  }, null, 2));
  if (result.admission.outcome !== "PASSED") process.exitCode = 1;
} finally {
  store.close();
}
