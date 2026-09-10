// @vitest-environment node
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const script = resolve("scripts/cost-gate.mjs");
const directories: string[] = [];

afterEach(async () => {
  await Promise.all(directories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

function hook(directory: string, command: string) {
  const result = spawnSync(process.execPath, [script], {
    cwd: directory,
    input: JSON.stringify({ toolName: "run_in_terminal", toolInput: { command } }),
    encoding: "utf8",
    env: {
      ...process.env,
      WATAI_WORK_DECISION_PATH: join(directory, "decision.json"),
      WATAI_WORK_DECISION_HISTORY: join(directory, "history"),
    },
  });
  if (result.status !== 0) throw new Error(result.stderr || `Hook exited ${result.status}`);
  return JSON.parse(result.stdout) as {
    hookSpecificOutput: { permissionDecision: string; permissionDecisionReason?: string };
  };
}

describe("project cost gate", () => {
  it("allows cheap work and blocks expensive work without a decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-cost-gate-"));
    directories.push(directory);
    expect(hook(directory, "npm run typecheck:harness").hookSpecificOutput.permissionDecision).toBe("allow");
    const blocked = hook(directory, "docker build -t worker .");
    expect(blocked.hookSpecificOutput).toMatchObject({ permissionDecision: "deny" });
    expect(blocked.hookSpecificOutput.permissionDecisionReason).toContain("container-build-or-pull");
  });

  it("consumes one exact command-bound approved decision", async () => {
    const directory = await mkdtemp(join(tmpdir(), "watai-cost-gate-"));
    directories.push(directory);
    await mkdir(join(directory, ".harness-state"));
    const requestPath = join(directory, "request.json");
    const command = "npm run harness:evaluate-canary";
    await writeFile(requestPath, JSON.stringify({
      schemaVersion: "1.0",
      challengerVerdict: "APPROVE",
      expectedValue: "Prove the real agent path before qualification.",
      necessaryNow: true,
      necessaryNowReason: "Implementation readiness requires real agent evidence.",
      cheapestStage: "One bounded-read canary.",
      alternativesConsidered: ["Static checks cannot prove provider and tool behavior."],
      evidenceReuse: ["Reuse image isolation and local tests."],
      estimatedMinutes: 4,
      ceilings: { wallClockMinutes: 4, requests: 4, aiCredits: 30, usd: 0 },
      continueIf: "Exact canary oracle passes with usage.",
      stopIf: "Any provider, oracle, time or budget failure.",
      rollback: "Retain failed reservation and do not qualify.",
      fullDenominator: false,
    }));
    const decisionPath = join(directory, "decision.json");
    execFileSync(process.execPath, [script, "approve", requestPath], {
      cwd: directory,
      encoding: "utf8",
      env: {
        ...process.env,
        WATAI_EXPENSIVE_COMMAND: command,
        WATAI_WORK_DECISION_PATH: decisionPath,
        WATAI_WORK_DECISION_HISTORY: join(directory, "history"),
      },
    });
    expect(JSON.parse(await readFile(decisionPath, "utf8"))).toMatchObject({ status: "APPROVED", oneShot: true });
    expect(hook(directory, command).hookSpecificOutput.permissionDecision).toBe("allow");
    expect(hook(directory, command).hookSpecificOutput.permissionDecision).toBe("deny");
  });
});
