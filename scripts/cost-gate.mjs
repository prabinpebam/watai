import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const decisionPath = resolve(process.env.WATAI_WORK_DECISION_PATH || ".harness-state/work-decision.json");
const historyDirectory = resolve(process.env.WATAI_WORK_DECISION_HISTORY || ".harness-state/work-decisions");

const hash = (value) => createHash("sha256").update(value).digest("hex");
const normalizedCommand = (value) => value.trim().replace(/\s+/g, " ");

function extractTool(input) {
  const toolName = input.tool_name ?? input.toolName ?? input.tool?.name ?? input.name ?? "";
  const toolInput = input.tool_input ?? input.toolInput ?? input.tool?.input ?? input.arguments ?? input.input ?? {};
  const command = typeof toolInput?.command === "string"
    ? toolInput.command
    : typeof input.command === "string"
      ? input.command
      : "";
  return { toolName: String(toolName), command };
}

export function expensiveReasons(toolName, command) {
  const reasons = [];
  const value = normalizedCommand(command).toLowerCase();
  if (/harness:evaluate-(?:live|canary)|live-mode[l-]|copilotsmoke/i.test(value)) reasons.push("live-model-or-ai-credit");
  if (/\b(?:docker|podman)\s+(?:build|pull)\b/i.test(value)) reasons.push("container-build-or-pull");
  if (/\bplaywright\s+test\b|test:integration|harness:test-integration-stage/i.test(value)) reasons.push("browser-or-integration-matrix");
  if (/\b(?:az\s+(?:deployment|functionapp|webapp|resource|group)|terraform\s+apply|bicep\s+deploy)\b/i.test(value)) reasons.push("cloud-mutation");
  if (/\b(?:git\s+push|gh\s+(?:workflow\s+run|run\s+rerun|release\s+create|repo\s+create))\b/i.test(value)) reasons.push("remote-mutation");
  if (/\b(?:npm|pnpm|yarn|pip|uv)\s+(?:install|add|update|audit)\b/i.test(value)) reasons.push("dependency-or-audit-operation");
  if (/full[- ]?(?:matrix|denominator|qualification)|three\s+(?:complete\s+)?runs/i.test(value)) reasons.push("full-evidence-denominator");
  if (/run_in_terminal/i.test(toolName) && /timeout\s*[=:]\s*(?:[2-9]\d{5,}|\d{7,})/i.test(value)) reasons.push("long-running-command");
  return [...new Set(reasons)];
}

function validNumber(value) {
  return Number.isFinite(value) && value >= 0;
}

export async function approveDecision(requestPath, command) {
  const request = JSON.parse(await readFile(resolve(requestPath), "utf8"));
  const requiredText = [
    "expectedValue", "necessaryNowReason", "cheapestStage", "continueIf", "stopIf", "rollback",
  ];
  if (
    request.schemaVersion !== "1.0" ||
    request.challengerVerdict !== "APPROVE" ||
    request.necessaryNow !== true ||
    requiredText.some((key) => typeof request[key] !== "string" || !request[key].trim()) ||
    !Array.isArray(request.alternativesConsidered) || request.alternativesConsidered.length === 0 ||
    !Array.isArray(request.evidenceReuse) ||
    !validNumber(request.estimatedMinutes) || request.estimatedMinutes <= 0 ||
    !request.ceilings ||
    !validNumber(request.ceilings.wallClockMinutes) || request.ceilings.wallClockMinutes <= 0 ||
    !validNumber(request.ceilings.requests) ||
    !validNumber(request.ceilings.aiCredits) ||
    !validNumber(request.ceilings.usd) ||
    request.estimatedMinutes > request.ceilings.wallClockMinutes
  ) {
    throw new Error("Work decision request is incomplete, unbounded, or not approved by the Cost Challenger.");
  }
  if (request.fullDenominator === true) {
    if (typeof request.canaryReportPath !== "string" || !request.canaryReportPath.trim()) {
      throw new Error("Full-denominator work requires a canary report path.");
    }
    const canary = JSON.parse(await readFile(resolve(request.canaryReportPath), "utf8"));
    if (canary.status !== "CANARY_PASSED") throw new Error("Full-denominator work requires a passing canary.");
  }
  const now = Date.now();
  const decision = {
    schemaVersion: "1.0",
    status: "APPROVED",
    decisionId: randomUUID(),
    commandSha256: hash(normalizedCommand(command)),
    requestSha256: hash(JSON.stringify(request)),
    approvedAt: new Date(now).toISOString(),
    expiresAt: new Date(now + 15 * 60_000).toISOString(),
    oneShot: true,
    expectedValue: request.expectedValue,
    necessaryNowReason: request.necessaryNowReason,
    cheapestStage: request.cheapestStage,
    ceilings: request.ceilings,
    evidenceReuse: request.evidenceReuse,
    continueIf: request.continueIf,
    stopIf: request.stopIf,
    rollback: request.rollback,
  };
  await mkdir(dirname(decisionPath), { recursive: true });
  await writeFile(decisionPath, `${JSON.stringify(decision, null, 2)}\n`, { encoding: "utf8", flag: "wx", mode: 0o600 });
  return decision;
}

async function hookMain() {
  let text = "";
  process.stdin.setEncoding("utf8");
  for await (const chunk of process.stdin) text += chunk;
  const input = text.trim() ? JSON.parse(text) : {};
  const { toolName, command } = extractTool(input);
  const reasons = expensiveReasons(toolName, command);
  if (reasons.length === 0) {
    process.stdout.write(JSON.stringify({ hookSpecificOutput: { hookEventName: "PreToolUse", permissionDecision: "allow" } }));
    return;
  }
  try {
    const decision = JSON.parse(await readFile(decisionPath, "utf8"));
    const valid = decision.schemaVersion === "1.0" && decision.status === "APPROVED" && decision.oneShot === true &&
      decision.commandSha256 === hash(normalizedCommand(command)) &&
      Number.isFinite(Date.parse(decision.approvedAt)) && Number.isFinite(Date.parse(decision.expiresAt)) &&
      Date.parse(decision.approvedAt) <= Date.now() && Date.now() < Date.parse(decision.expiresAt);
    if (!valid) throw new Error("missing, stale, reused, or command-mismatched decision");
    await mkdir(historyDirectory, { recursive: true });
    await rename(decisionPath, resolve(historyDirectory, `${decision.approvedAt.replace(/[:.]/g, "-")}-${decision.decisionId}.json`));
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "allow",
        permissionDecisionReason: `One-shot cost decision ${decision.decisionId} approved: ${reasons.join(", ")}`,
      },
    }));
  } catch (error) {
    process.stdout.write(JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: "deny",
        permissionDecisionReason: `Expensive action blocked (${reasons.join(", ")}): ${error instanceof Error ? error.message : "work decision unavailable"}. Run Cost Challenger, then npm run harness:work-decision.`,
      },
    }));
  }
}

if (process.argv[2] === "approve") {
  const requestPath = process.argv[3] || process.env.WATAI_WORK_DECISION_REQUEST;
  const command = process.env.WATAI_EXPENSIVE_COMMAND;
  if (!requestPath || !command) throw new Error("Usage: set WATAI_EXPENSIVE_COMMAND and run cost-gate.mjs approve <request.json>.");
  console.log(JSON.stringify(await approveDecision(requestPath, command), null, 2));
} else if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  await hookMain();
}
