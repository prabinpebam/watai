import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { buildEvaluationCanaryReport } from "./evaluationCostGate.js";
import { CommandLiveModelProviderAdapter } from "./liveModelExecutor.js";
import { SqliteLiveModelBudget } from "./liveModelBudget.js";
import type { LiveModelEvaluationManifest } from "./modelEvaluation.js";
import type { ModelCaseManifest } from "./modelCases.js";
import { loadImplementationAgentEvaluationAuthority } from "./operationalAuthority.js";
import { SqliteHarnessStore } from "./sqliteStore.js";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const imageSha256 = process.env.WATAI_WORKER_IMAGE_SHA256?.trim() ?? "";
if (!/^[a-f0-9]{64}$/.test(imageSha256)) throw new Error("WATAI_WORKER_IMAGE_SHA256 is required.");
const [manifest, caseManifest] = await Promise.all([
  readFile(resolve(root, "harness/evaluator/model-evaluations.json"), "utf8")
    .then((text) => JSON.parse(text) as LiveModelEvaluationManifest),
  readFile(resolve(root, "harness/evaluator/model-cases.json"), "utf8")
    .then((text) => JSON.parse(text) as ModelCaseManifest),
]);
const contract = manifest.evaluations.find((evaluation) => evaluation.id === "implementation-agent-smoke");
if (!contract?.staging) throw new Error("Frozen implementation-agent canary contract is missing.");
const definition = caseManifest.evaluations
  .find((evaluation) => evaluation.evaluationId === contract.id)?.cases
  .find((candidate) => candidate.id === contract.staging!.canaryCaseId);
if (!definition) throw new Error("Frozen implementation-agent canary case is missing.");
const authority = await loadImplementationAgentEvaluationAuthority(root, imageSha256);
const canaryBudget = contract.staging.budget;
if (
  canaryBudget.usd > authority.grant.billing.maxUsd ||
  canaryBudget.inputTokens > authority.grant.billing.maxInputTokens ||
  canaryBudget.outputTokens > authority.grant.billing.maxOutputTokens ||
  canaryBudget.requests > authority.grant.billing.maxRequests ||
  canaryBudget.aiCredits > authority.grant.billing.maxAiCredits
) {
  throw new Error("Canary exceeds the signed evaluation grant.");
}
const adapter = new CommandLiveModelProviderAdapter(contract.providerId, {
  executable: process.execPath,
  args: [resolve(root, ".harness-dist/copilotSmokeAdapterCli.js")],
  cwd: root,
  timeoutMs: contract.staging.maximumWallClockMs + 15_000,
  environment: { WATAI_WORKER_IMAGE_SHA256: imageSha256 },
});
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const canaryRunId = `canary-${randomUUID()}`;
const store = new SqliteHarnessStore(resolve(root, ".harness-state/live-model/evaluation-budget.sqlite"));
try {
  const budget = new SqliteLiveModelBudget(
    store,
    `canary-grant:${authority.grant.grantId}`,
    canaryRunId,
    canaryBudget,
  );
  const reservation = await budget.reserve({
    evaluationId: `${contract.id}-canary`,
    worstCase: canaryBudget,
    expectedRuns: 1,
  });
  const startedAt = new Date().toISOString();
  const result = await adapter.run({ contract, definition, repetition: 1 });
  const completedAt = new Date().toISOString();
  const report = buildEvaluationCanaryReport({
    sourceSha,
    runtimeImageSha256: imageSha256,
    contract,
    definition,
    startedAt,
    completedAt,
    result,
  });
  if (report.status === "CANARY_PASSED") {
    await budget.settle(reservation.reservationId, result.usage);
  } else {
    await budget.markOutcomeUnknown(reservation.reservationId, report.blockers.map((blocker) => blocker.code).join(","));
  }
  const evidenceRoot = process.env.WATAI_MODEL_EVIDENCE_ROOT?.trim()
    ? resolve(process.env.WATAI_MODEL_EVIDENCE_ROOT.trim())
    : resolve(root, "..", "watai-harness-evidence");
  await mkdir(evidenceRoot, { recursive: true, mode: 0o700 });
  const outputPath = resolve(evidenceRoot, `${canaryRunId}.json`);
  await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, {
    encoding: "utf8", flag: "wx", mode: 0o600,
  });
  console.log(JSON.stringify({ ...report, outputPath }, null, 2));
  if (report.status !== "CANARY_PASSED") process.exitCode = 2;
} finally {
  store.close();
}
