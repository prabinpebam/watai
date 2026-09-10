import { createHash, randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import {
  validateEvaluatorInventory,
  type EvaluatorCommand,
  type EvaluatorInventory,
} from "./evaluatorInventory.js";

interface CommandResult {
  commandId: string;
  repetition: number;
  exitCode: number | null;
  signal: string | null;
  durationMs: number;
  stdoutSha256: string;
  stderrSha256: string;
  observedTestFiles: number | null;
  observedTests: number | null;
  observedSkipped: number;
  passed: boolean;
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const inventoryPath = resolve(root, "harness", "evaluator", "inventory.json");
const inventory = JSON.parse(await readFile(inventoryPath, "utf8")) as EvaluatorInventory;
const validation = validateEvaluatorInventory(inventory);
if (!validation.valid) throw new Error(`Evaluator inventory is invalid: ${JSON.stringify(validation.blockers)}`);

const runId = `local-${new Date().toISOString().replace(/[:.]/g, "-")}-${randomUUID().slice(0, 8)}`;
const outputDirectory = resolve(root, ".harness-state", "evaluator", runId);
await mkdir(outputDirectory, { recursive: true });
const hash = (value: string) => createHash("sha256").update(value).digest("hex");

function parseCounts(command: EvaluatorCommand, output: string) {
  if (command.expectedTests === 0) return { testFiles: 0, tests: 0, skipped: 0 };
  const normalized = output.replace(/\x1B\[[0-?]*[ -/]*[@-~]/g, "");
  const vitestFiles = normalized.match(/Test Files\s+(\d+) passed(?:\s+\((\d+)\))?/);
  const vitestTests = normalized.match(/Tests\s+(\d+) passed(?:\s+\((\d+)\))?/);
  if (vitestFiles && vitestTests) {
    const skipped = [...normalized.matchAll(/(\d+) skipped/g)].reduce((sum, match) => sum + Number(match[1]), 0);
    return { testFiles: Number(vitestFiles[1]), tests: Number(vitestTests[1]), skipped };
  }
  const playwright = normalized.match(/(?:^|\n)\s*(\d+) passed \(/);
  const playwrightSkipped = normalized.match(/(?:^|\n)\s*(\d+) skipped/);
  if (playwright) {
    return {
      testFiles: command.expectedTestFiles,
      tests: Number(playwright[1]),
      skipped: playwrightSkipped ? Number(playwrightSkipped[1]) : 0,
    };
  }
  return { testFiles: null, tests: null, skipped: 0 };
}

const npmExecPath = process.env.npm_execpath;
if (!npmExecPath) throw new Error("npm_execpath is required for the fixed evaluator commands.");
const results: CommandResult[] = [];
for (const command of inventory.commands) {
  for (let repetition = 1; repetition <= command.repetitions; repetition += 1) {
    const started = Date.now();
    const args = command.args[0] === "exec"
      ? [npmExecPath, ...command.args]
      : [npmExecPath, ...command.args];
    const processResult = spawnSync(process.execPath, args, {
      cwd: resolve(root, command.cwd),
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
      timeout: command.id === "browser-complete" ? 5 * 60_000 : 10 * 60_000,
      windowsHide: true,
      shell: false,
      env: {
        ...process.env,
        npm_config_registry: "https://packagefeedproxy.microsoft.io/npm/",
      },
    });
    const stdout = processResult.stdout ?? "";
    const stderr = processResult.stderr ?? "";
    const combined = `${stdout}\n${stderr}`;
    const counts = parseCounts(command, combined);
    const passed =
      !processResult.error &&
      processResult.status === 0 &&
      counts.testFiles === command.expectedTestFiles &&
      counts.tests === command.expectedTests &&
      counts.skipped === 0;
    const prefix = `${command.id}-${repetition}`;
    await Promise.all([
      writeFile(resolve(outputDirectory, `${prefix}.stdout.txt`), stdout, "utf8"),
      writeFile(resolve(outputDirectory, `${prefix}.stderr.txt`), stderr, "utf8"),
    ]);
    results.push({
      commandId: command.id,
      repetition,
      exitCode: processResult.status,
      signal: processResult.signal,
      durationMs: Date.now() - started,
      stdoutSha256: hash(stdout),
      stderrSha256: hash(stderr),
      observedTestFiles: counts.testFiles,
      observedTests: counts.tests,
      observedSkipped: counts.skipped,
      passed,
    });
    if (!passed) break;
  }
  if (results.at(-1)?.passed !== true) break;
}

const report = {
  schemaVersion: "1.0",
  status: results.length === inventory.commands.reduce((sum, command) => sum + command.repetitions, 0) &&
    results.every((result) => result.passed) ? "LOCAL_BASELINE_PASSED" : "LOCAL_BASELINE_FAILED",
  releaseEligible: false,
  independentlyAttested: false,
  runId,
  inventorySha256: validation.sha256,
  sourceSha: spawnSync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }).stdout.trim(),
  dirty: Boolean(spawnSync("git", ["status", "--porcelain=v1"], { cwd: root, encoding: "utf8" }).stdout.trim()),
  results,
  note: "Local supervisor evidence is builder-visible and mutable; it cannot satisfy independent release gates.",
};
await writeFile(resolve(outputDirectory, "report.json"), `${JSON.stringify(report, null, 2)}\n`, "utf8");
console.log(JSON.stringify({ ...report, outputDirectory }, null, 2));
if (report.status !== "LOCAL_BASELINE_PASSED") process.exitCode = 1;