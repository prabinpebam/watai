import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readFile, readdir } from "node:fs/promises";
import { dirname, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const contracts = resolve(root, "documentation", "implementation", "2026-09-10-autonomous-delivery", "contracts");

const fileDigest = async (path: string) =>
  createHash("sha256").update(await readFile(resolve(root, path))).digest("hex");

async function aggregateDigest(paths: string[]): Promise<string> {
  const hash = createHash("sha256");
  for (const path of [...paths].sort()) {
    hash.update(path.replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(await readFile(resolve(root, path)));
    hash.update("\0");
  }
  return hash.digest("hex");
}

async function compiledRuntimeFiles(directory: string): Promise<string[]> {
  const result: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const path = resolve(directory, entry.name);
    if (entry.isDirectory()) result.push(...await compiledRuntimeFiles(path));
    else if (entry.isFile() && entry.name.endsWith(".js")) {
      result.push(relative(root, path).replaceAll("\\", "/"));
    }
  }
  return result;
}

const status = execFileSync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
  cwd: root,
  encoding: "utf8",
}).trim();
const sourceSha = execFileSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).trim();
const runtimeFiles = await compiledRuntimeFiles(resolve(root, ".harness-dist"));
const negativeControls = JSON.parse(
  await readFile(resolve(root, "harness", "evaluator", "negative-controls.json"), "utf8"),
) as { ids: string[] };

const rootInputs = {
  backlogSha256: await fileDigest(relative(root, resolve(contracts, "backlog.json"))),
  policySha256: await fileDigest(relative(root, resolve(contracts, "policy.json"))),
  workflowSha256: await fileDigest(relative(root, resolve(contracts, "workflow.json"))),
  planSchemaSha256: await fileDigest(relative(root, resolve(contracts, "plan.schema.json"))),
  controllerSha256: await aggregateDigest(runtimeFiles),
  evaluatorPackSha256: await aggregateDigest([
    "harness/evaluator/impact-map.json",
    "harness/evaluator/inventory.json",
    "harness/evaluator/negative-controls.json",
    "harness/src/evidence.ts",
    "harness/src/evaluatorInventory.ts",
  ]),
  testInventorySha256: await fileDigest("harness/evaluator/inventory.json"),
  fixtureManifestSha256: await fileDigest("documentation/implementation/2026-09-10-autonomous-delivery/contracts/examples.json"),
  toolchainSha256: await aggregateDigest([
    ".npmrc",
    "api/.npmrc",
    "api/package.json",
    "api/tsconfig.json",
    "api/vitest.config.ts",
    "api/vitest.integration.config.ts",
    "package.json",
    "playwright.config.ts",
    "tsconfig.harness.build.json",
    "tsconfig.harness.json",
    "vitest.config.ts",
  ]),
  dependencyLockSha256: await aggregateDigest(["api/package-lock.json", "package-lock.json"]),
  impactMapSha256: await fileDigest("harness/evaluator/impact-map.json"),
  negativeControlIds: negativeControls.ids,
};

console.log(JSON.stringify({
  schemaVersion: "1.0",
  status: status ? "SOURCE_DIRTY" : "READY_FOR_OWNER_CEREMONY",
  releaseEligible: false,
  repositoryId: "prabinpebam/watai",
  sourceSha,
  clean: !status,
  rootInputs,
  observedBaseline: {
    path: "documentation/implementation/2026-09-10-autonomous-delivery/evidence/h01-observed-baseline.json",
    sha256: await fileDigest("documentation/implementation/2026-09-10-autonomous-delivery/evidence/h01-observed-baseline.json"),
  },
  next: status
    ? "Commit and revalidate before the independent owner ceremony."
    : "An independent owner process supplies issuer public keys, creates the root, pins its digest separately, and signs only claims it can prove.",
}, null, 2));

if (status) process.exitCode = 2;