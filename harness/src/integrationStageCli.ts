import { spawnSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

interface StageFixture {
  schemaVersion: string;
  status: string;
  releaseEligible: boolean;
  cosmosEndpoint: string;
  cosmosDatabase: string;
  storageAccount: string;
  mediaContainer: string;
  requiredContainers: Record<string, string>;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const fixture = JSON.parse(
  await readFile(resolve(root, "harness", "evaluator", "integration-stage.json"), "utf8"),
) as StageFixture;
if (
  fixture.schemaVersion !== "1.0" ||
  fixture.status !== "PROVISIONED" ||
  fixture.releaseEligible !== false ||
  !fixture.cosmosEndpoint.startsWith("https://") ||
  fixture.cosmosDatabase === "watai" ||
  fixture.mediaContainer === "media" ||
  !fixture.cosmosDatabase.startsWith("watai-harness-") ||
  !fixture.mediaContainer.startsWith("harness-") ||
  Object.keys(fixture.requiredContainers).length !== 4
) {
  throw new Error("Isolated integration-stage manifest is invalid or targets a default product store.");
}

const environment: NodeJS.ProcessEnv = {
  PATH: process.env.PATH,
  SystemRoot: process.env.SystemRoot,
  WINDIR: process.env.WINDIR,
  HOME: process.env.HOME,
  USERPROFILE: process.env.USERPROFILE,
  LOCALAPPDATA: process.env.LOCALAPPDATA,
  APPDATA: process.env.APPDATA,
  AZURE_CONFIG_DIR: process.env.AZURE_CONFIG_DIR,
  npm_config_registry: "https://packagefeedproxy.microsoft.io/npm/",
  WATAI_INTEGRATION_TARGET: "isolated-stage",
  COSMOS_ENDPOINT: fixture.cosmosEndpoint,
  COSMOS_DATABASE: fixture.cosmosDatabase,
  STORAGE_ACCOUNT: fixture.storageAccount,
  MEDIA_CONTAINER: fixture.mediaContainer,
};
const vitestPath = resolve(root, "api", "node_modules", "vitest", "vitest.mjs");
const result = spawnSync(process.execPath, [
  vitestPath,
  "run",
  "--config",
  "vitest.integration.config.ts",
], {
  cwd: resolve(root, "api"),
  env: environment,
  stdio: "inherit",
  shell: false,
  windowsHide: true,
  timeout: 5 * 60_000,
});
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;