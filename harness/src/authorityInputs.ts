import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { relative, resolve } from "node:path";
import { validateImpactMap, type ImpactMap } from "./evaluatorInventory.js";

export async function aggregateFilesSha256(root: string, paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(resolve(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function compiledRuntimeFiles(root: string, directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await compiledRuntimeFiles(root, path));
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return result;
}

export async function compiledRuntimeSha256(root: string): Promise<string> {
  const paths = await compiledRuntimeFiles(root, resolve(root, ".harness-dist"));
  return aggregateFilesSha256(root, paths);
}

export interface AuthorityContractDigests {
  backlogSha256: string;
  policySha256: string;
  workflowSha256: string;
  planSchemaSha256: string;
  controllerSha256: string;
  evaluatorPackSha256: string;
  testInventorySha256: string;
  fixtureManifestSha256: string;
  toolchainSha256: string;
  dependencyLockSha256: string;
  impactMapSha256: string;
  negativeControlIds: string[];
}

async function fileSha256(root: string, path: string): Promise<string> {
  return createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");
}

export async function collectAuthorityContractDigests(root: string): Promise<AuthorityContractDigests> {
  const negativeControls = JSON.parse(
    await readFile(resolve(root, "harness/evaluator/negative-controls.json"), "utf8"),
  ) as { ids: string[] };
  const impactMap = JSON.parse(
    await readFile(resolve(root, "harness/evaluator/impact-map.json"), "utf8"),
  ) as ImpactMap;
  const impactValidation = validateImpactMap(impactMap);
  if (!impactValidation.valid) throw new Error(`Impact map is invalid: ${JSON.stringify(impactValidation.blockers)}`);
  return {
    backlogSha256: await fileSha256(root, "documentation/implementation/2026-09-10-autonomous-delivery/contracts/backlog.json"),
    policySha256: await fileSha256(root, "documentation/implementation/2026-09-10-autonomous-delivery/contracts/policy.json"),
    workflowSha256: await fileSha256(root, "documentation/implementation/2026-09-10-autonomous-delivery/contracts/workflow.json"),
    planSchemaSha256: await fileSha256(root, "documentation/implementation/2026-09-10-autonomous-delivery/contracts/plan.schema.json"),
    controllerSha256: await compiledRuntimeSha256(root),
    evaluatorPackSha256: await aggregateFilesSha256(root, [
      "api/scripts/live-model-adapter.ts",
      "harness/evaluator/impact-map.json",
      "harness/evaluator/inventory.json",
      "harness/evaluator/model-cases.json",
      "harness/evaluator/model-evaluations.json",
      "harness/evaluator/negative-controls.json",
      "harness/src/evidence.ts",
      "harness/src/evaluatorInventory.ts",
      "harness/src/modelCases.ts",
      "harness/src/modelEvaluation.ts",
    ]),
    testInventorySha256: await fileSha256(root, "harness/evaluator/inventory.json"),
    fixtureManifestSha256: await fileSha256(root, "documentation/implementation/2026-09-10-autonomous-delivery/contracts/examples.json"),
    toolchainSha256: await aggregateFilesSha256(root, [
      ".npmrc",
      "api/.npmrc",
      "api/package.json",
      "api/tsconfig.json",
      "api/vitest.config.ts",
      "api/vitest.integration.config.ts",
      ".github/copilot-instructions.md",
      ".github/agents/cost-challenger.agent.md",
      ".github/hooks/cost-gate.json",
      "harness/Dockerfile.smoke-worker",
      "harness/Dockerfile.worker",
      "package.json",
      "playwright.config.ts",
      "tsconfig.harness.build.json",
      "tsconfig.harness.json",
      "vitest.config.ts",
      "scripts/cost-gate.mjs",
    ]),
    dependencyLockSha256: await aggregateFilesSha256(root, ["api/package-lock.json", "package-lock.json"]),
    impactMapSha256: impactValidation.sha256,
    negativeControlIds: negativeControls.ids,
  };
}