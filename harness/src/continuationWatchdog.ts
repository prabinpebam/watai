import { execFile, spawn } from "node:child_process";
import { mkdir, open, readFile, readdir, rmdir, stat, unlink } from "node:fs/promises";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";

import { loadOperationalAuthority } from "./operationalAuthority.js";
import { reserveBudget, type BudgetState, type EffectExecution } from "./execution.js";
import { verifyLockedTaskSpec, type LockedTaskSpec } from "./taskSpec.js";
import { canonical } from "./trust.js";

export const continuationStaleMs = 20 * 60_000;

export interface ContinuationObservation {
  observedAtMs: number;
  lastActivityMs: number | null;
  paused: boolean;
  blockers: string[];
}

export interface ContinuationDecision {
  at: string;
  mode: "log-only" | "guarded-dispatch";
  action: "paused" | "blocked" | "observe" | "stale-log-only" | "dispatch-intent" | "completed";
  reasons: string[];
  dispatched: boolean;
  binding?: ContinuationBinding;
  lastActivityAt?: string | null;
  activityStale?: boolean | null;
}

export interface ContinuationBinding {
  runId: string;
  effectId: string;
  taskSpecSha256: string;
  deadline: string;
}

export interface ContinuationAdapter {
  observe(root: string): Promise<ContinuationObservation>;
  authorize(root: string): Promise<ContinuationBinding>;
  execute(root: string, binding: ContinuationBinding): Promise<void>;
}

export function evaluateContinuation(observation: ContinuationObservation, nowMs: number): ContinuationDecision {
  const activityKnown = observation.lastActivityMs !== null && Number.isFinite(observation.lastActivityMs) &&
    observation.lastActivityMs >= 0 && observation.lastActivityMs <= nowMs;
  const result: ContinuationDecision = {
    at: new Date(nowMs).toISOString(),
    mode: "log-only",
    action: "blocked",
    reasons: [...observation.blockers],
    dispatched: false,
    lastActivityAt: activityKnown ? new Date(observation.lastActivityMs!).toISOString() : null,
    activityStale: activityKnown ? nowMs - observation.lastActivityMs! >= continuationStaleMs : null,
  };
  if (observation.paused) return { ...result, action: "paused", reasons: ["USER_PAUSED"] };
  if (!Number.isFinite(observation.observedAtMs) || observation.observedAtMs > nowMs ||
      nowMs - observation.observedAtMs > 120_000) result.reasons.push("TELEMETRY_MISSING_OR_STALE");
  if (!activityKnown) result.reasons.push("ACTIVITY_UNKNOWN");
  if (result.reasons.length) return result;
  return {
    ...result,
    action: nowMs - observation.lastActivityMs! < continuationStaleMs ? "observe" : "stale-log-only",
    reasons: [nowMs - observation.lastActivityMs! < continuationStaleMs ? "RECENT_ACTIVITY" : "ZERO_MODEL_BUDGET_LOG_ONLY"],
  };
}

const statePaths = (root: string) => {
  const directory = resolve(root, ".harness-state");
  return {
    directory,
    lock: resolve(directory, "continuation-watchdog.lock"),
    pause: resolve(directory, "continuation-watchdog.paused"),
    log: resolve(directory, "continuation-watchdog-decisions.jsonl"),
    config: resolve(directory, "continuation-watchdog.json"),
    dispatch: resolve(directory, "continuation-watchdog-dispatch.json"),
  };
};

function hasCode(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

async function exists(path: string): Promise<boolean> {
  try { await stat(path); return true; } catch (error) {
    if (hasCode(error, "ENOENT")) return false;
    throw error;
  }
}

async function appendDecision(root: string, decision: ContinuationDecision): Promise<ContinuationDecision> {
  const handle = await open(statePaths(root).log, "a", 0o600);
  try {
    await handle.writeFile(`${JSON.stringify(decision)}\n`);
    await handle.sync();
  } finally { await handle.close(); }
  return decision;
}

export async function latestActivity(directory: string): Promise<number | null> {
  const entries = await readdir(directory, { withFileTypes: true });
  const files = entries.filter((entry) => entry.isFile() && entry.name.endsWith(".jsonl") && !entry.name.startsWith("continuation-watchdog"));
  if (files.length === 0) return null;
  const mtimes = await Promise.all(files.map(async (entry) => (await stat(resolve(directory, entry.name))).mtimeMs));
  return Math.max(...mtimes);
}

export async function inspectCostPermits(root: string, nowMs: number): Promise<string[]> {
  const directory = statePaths(root).directory;
  const names = await readdir(directory);
  const paths = names.filter((name) => /(?:work-)?decision\.json$/.test(name)).map((name) => resolve(directory, name));
  const history = resolve(directory, "work-decisions");
  if (await exists(history)) {
    paths.push(...(await readdir(history)).filter((name) => name.endsWith(".json")).map((name) => resolve(history, name)));
  }
  for (const path of paths) {
    const permit = JSON.parse(await readFile(path, "utf8")) as { status?: string; expiresAt?: string };
    if (permit.status !== "APPROVED" || !Number.isFinite(Date.parse(permit.expiresAt ?? ""))) return ["COST_PERMIT_STATE_UNKNOWN"];
    if (Date.parse(permit.expiresAt!) > nowMs) return ["ACTIVE_COST_PERMIT"];
  }
  return [];
}

export function inspectDurableState(path: string, nowMs: number): string[] {
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("BEGIN");
    const blockers: string[] = [];
    const schema = database.prepare("SELECT value FROM harness_meta WHERE key = 'schema_version'").get();
    if (schema?.value !== "1.0") return ["DURABLE_TELEMETRY_UNKNOWN"];
    const effects = database.prepare("SELECT status, intent_json FROM effect_outbox").all();
    if (effects.some((effect) => !["pending", "completed", "failed"].includes(String(effect.status)))) {
      blockers.push("EFFECT_CLAIMED_OR_UNKNOWN");
    }
    const executions = database.prepare("SELECT state_json FROM effect_executions").all();
    if (executions.some((entry) => !["pending", "completed", "failed"].includes(JSON.parse(String(entry.state_json)).status))) {
      blockers.push("EFFECT_EXECUTION_CLAIMED_OR_UNKNOWN");
    }
    if (!effects.some((effect) => effect.status === "pending" && JSON.parse(String(effect.intent_json)).kind === "worker")) {
      blockers.push("NO_PENDING_WORKER_EFFECT");
    }
    const leases = database.prepare("SELECT lease_until_ms FROM leases").all();
    if (leases.some((lease) => !Number.isFinite(Number(lease.lease_until_ms)) || Number(lease.lease_until_ms) > nowMs)) {
      blockers.push("ACTIVE_OR_UNKNOWN_LEASE");
    }
    const budgets = database.prepare("SELECT state_json FROM budget_ledgers").all();
    if (budgets.length === 0) blockers.push("BUDGET_STATE_MISSING");
    for (const entry of budgets) {
      const budget = JSON.parse(String(entry.state_json)) as { reservations?: { status: string }[] };
      if (!Array.isArray(budget.reservations) || budget.reservations.some((reservation) => !["settled", "cancelled-before-dispatch"].includes(reservation.status))) {
        blockers.push("BUDGET_RESERVED_OR_UNKNOWN");
        break;
      }
    }
    const receipts = database.prepare("SELECT status FROM gateway_receipts").all();
    if (receipts.some((receipt) => receipt.status !== "completed")) blockers.push("GATEWAY_OUTCOME_UNKNOWN");
    return blockers;
  } finally { database.close(); }
}

export function matchesContinuationTask(intent: EffectExecution["intent"], task: LockedTaskSpec): boolean {
  return intent.status === "pending" && intent.kind === "worker" && intent.runId === task.runId &&
    intent.inputSha256 === task.taskSpecSha256 && intent.providerId === task.agentRuntime?.providerId &&
    intent.model === task.agentRuntime?.model && intent.sourceSha === task.source.sourceSha &&
    intent.policySha256 === task.bindings.policySha256 && intent.epoch === task.fencingEpoch && intent.deadline === task.deadline;
}

const durablePath = (root: string) => process.env.WATAI_HARNESS_DB_PATH?.trim() || resolve(statePaths(root).directory, "harness.sqlite");

export function inspectContinuationTask(path: string, task: LockedTaskSpec, nowMs: number): ContinuationBinding {
  if (!Number.isFinite(Date.parse(task.deadline)) || Date.parse(task.deadline) <= nowMs) throw new Error("TASK_EXPIRED");
  if (inspectDurableState(path, nowMs).length) throw new Error("DURABLE_STATE_BLOCKED");
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const database = new DatabaseSync(path, { readOnly: true });
  try {
    database.exec("BEGIN");
    const candidate = database.prepare("SELECT source_sha, policy_sha256, fencing_epoch FROM candidates WHERE run_id = ?").get(task.runId);
    if (!candidate || candidate.source_sha !== task.source.sourceSha || candidate.policy_sha256 !== task.bindings.policySha256 || candidate.fencing_epoch !== task.fencingEpoch) throw new Error("CANDIDATE_BINDING_MISMATCH");
    const rows = database.prepare("SELECT effect_id, fencing_epoch, intent_json FROM effect_outbox WHERE run_id = ? AND status = 'pending'").all(task.runId);
    if (rows.length !== 1) throw new Error("PENDING_EFFECT_AMBIGUOUS");
    const intent = JSON.parse(String(rows[0].intent_json)) as EffectExecution["intent"];
    if (rows[0].effect_id !== intent.effectId || rows[0].fencing_epoch !== task.fencingEpoch || !matchesContinuationTask(intent, task)) throw new Error("PENDING_BINDING_MISMATCH");
    if (database.prepare("SELECT 1 FROM effect_executions WHERE effect_id = ?").get(intent.effectId)) throw new Error("EFFECT_ALREADY_DISPATCHED");
    const row = database.prepare("SELECT revision, state_json FROM budget_ledgers WHERE run_id = ?").get(task.runId);
    if (!row) throw new Error("TASK_BUDGET_MISSING");
    const budget = JSON.parse(String(row.state_json)) as BudgetState;
    const limits = { usd: task.budgets.maxUsd, inputTokens: task.budgets.maxInputTokens, outputTokens: task.budgets.maxOutputTokens, requests: task.budgets.maxRequests };
    if (row.revision !== budget.revision || canonical(budget.limits) !== canonical(limits) || limits.requests <= 0) throw new Error("TASK_BUDGET_MISMATCH");
    if (budget.reservations.some((reservation) => reservation.status === "settled" && !reservation.actual)) throw new Error("BUDGET_OUTCOME_UNKNOWN");
    reserveBudget(budget, budget.revision, {
      reservationId: `${task.runId}:${intent.effectId}:budget`, runId: task.runId, effectId: intent.effectId,
      fencingEpoch: task.fencingEpoch, worstCase: limits, status: "reserved",
    });
    return { runId: task.runId, effectId: intent.effectId, taskSpecSha256: task.taskSpecSha256, deadline: task.deadline };
  } finally { database.close(); }
}

export async function authorizeContinuation(root: string): Promise<ContinuationBinding> {
  const authority = await loadOperationalAuthority(root, "implementation");
  const path = process.env.WATAI_TASK_SPEC_PATH?.trim();
  if (!path) throw new Error("TASK_SPEC_MISSING");
  const task = JSON.parse(await readFile(resolve(path), "utf8")) as LockedTaskSpec;
  if (!verifyLockedTaskSpec(task, authority.policy, authority.authorities) ||
      canonical(task.bindings) !== canonical(authority.bundle.taskSpecBindings) ||
      task.mode !== "implementation" || !task.dispatchAuthorized || !task.agentRuntime) throw new Error("TASK_AUTHORITY_INVALID");
  return inspectContinuationTask(durablePath(root), task, Date.now());
}

export function continuationExecutorCommand(root: string, binding: ContinuationBinding): { executable: string; args: string[] } {
  return { executable: process.execPath, args: [resolve(root, ".harness-dist", "durableExecutorCli.js"), "--continuation-binding", JSON.stringify(binding)] };
}

async function executeContinuation(root: string, binding: ContinuationBinding): Promise<void> {
  const command = continuationExecutorCommand(root, binding);
  await new Promise<void>((resolveExit, rejectExit) => {
    const child = spawn(command.executable, command.args, { cwd: root, shell: false, detached: false, windowsHide: true, stdio: "inherit" });
    child.once("error", rejectExit);
    child.once("close", (code, signal) => code === 0 && signal === null ? resolveExit() : rejectExit(new Error("CHILD_OUTCOME_UNKNOWN")));
  });
  const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
  const database = new DatabaseSync(durablePath(root), { readOnly: true });
  try {
    database.exec("BEGIN");
    const row = database.prepare("SELECT state_json FROM effect_executions WHERE effect_id = ? AND run_id = ?").get(binding.effectId, binding.runId);
    const effect = row ? JSON.parse(String(row.state_json)) as EffectExecution : null;
    const budgetRow = database.prepare("SELECT state_json FROM budget_ledgers WHERE run_id = ?").get(binding.runId);
    const budget = budgetRow ? JSON.parse(String(budgetRow.state_json)) as BudgetState : null;
    const settled = budget?.reservations.find((reservation) => reservation.effectId === binding.effectId);
    if (effect?.status !== "completed" || effect.intent.inputSha256 !== binding.taskSpecSha256 || effect.intent.deadline !== binding.deadline || settled?.status !== "settled" || !settled.actual) throw new Error("DURABLE_OUTCOME_UNKNOWN");
  } finally { database.close(); }
}

async function processBlockers(): Promise<string[]> {
  if (process.platform !== "win32") return ["PROCESS_TELEMETRY_UNAVAILABLE"];
  const script = `$ErrorActionPreference='Stop'; $matches = @(Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne $PID -and $_.ProcessId -ne ${process.pid} -and ($_.Name -match '^(copilot|az|func)(\\.exe)?$' -or ($_.Name -match '^(node|pwsh|powershell|python)(\\.exe)?$' -and ([string]::IsNullOrWhiteSpace($_.CommandLine) -or $_.CommandLine -match 'durableExecutor|controllerApply|copilot|h05-|deploy|az[ .]')) ) }); [bool]($matches.Count -gt 0) | ConvertTo-Json -Compress`;
  try {
    const executable = resolve(process.env.SystemRoot || "C:\\Windows", "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
    const output = await promisify(execFile)(executable, ["-NoProfile", "-NonInteractive", "-Command", script], { timeout: 10_000, windowsHide: true, maxBuffer: 4096 });
    const active: unknown = JSON.parse(output.stdout.trim());
    return active === false ? [] : [active === true ? "ACTIVE_WORKER_OR_CLOUD_PROCESS" : "PROCESS_TELEMETRY_UNAVAILABLE"];
  } catch { return ["PROCESS_TELEMETRY_UNAVAILABLE"]; }
}

export async function observeContinuation(root: string): Promise<ContinuationObservation> {
  const blockers = ["CLOUD_OPERATION_TELEMETRY_UNAVAILABLE"];
  let lastActivityMs: number | null = null;
  try {
    const config = JSON.parse(await readFile(statePaths(root).config, "utf8")) as { mode?: string; activityDirectory?: string };
    if (config.mode !== "log-only") blockers.push("CONFIG_NOT_LOG_ONLY");
    if (config.activityDirectory) lastActivityMs = await latestActivity(config.activityDirectory);
  } catch { blockers.push("CONFIG_OR_ACTIVITY_UNAVAILABLE"); }
  const required = ["WATAI_HARNESS_AUTHORITY_DIR", "WATAI_HARNESS_ROOT_SHA256", "WATAI_TASK_SPEC_PATH", "WATAI_WORKER_RUNTIME_PATH", "WATAI_WORKER_ISOLATION_PATH", "WATAI_CREDENTIAL_BROKER_ATTESTATION_PATH", "WATAI_EVIDENCE_SIGNER_EXECUTABLE"];
  blockers.push(...required.filter((name) => !process.env[name]?.trim()).map((name) => `ENV_MISSING:${name}`));
  if (!process.env.WATAI_HARNESS_AUTHORITY_DIR?.trim() || !process.env.WATAI_HARNESS_ROOT_SHA256?.trim()) {
    blockers.push("EXTERNAL_AUTHORITY_ABSENT");
  } else {
    try { await loadOperationalAuthority(root, "implementation"); }
    catch { blockers.push("EXTERNAL_AUTHORITY_INVALID_OR_EXPIRED"); }
  }
  try { blockers.push(...await inspectCostPermits(root, Date.now())); }
  catch { blockers.push("COST_PERMIT_STATE_UNKNOWN"); }
  try {
    blockers.push(...inspectDurableState(process.env.WATAI_HARNESS_DB_PATH?.trim() || resolve(statePaths(root).directory, "harness.sqlite"), Date.now()));
  } catch { blockers.push("DURABLE_TELEMETRY_UNAVAILABLE"); }
  blockers.push(...await processBlockers());
  return { observedAtMs: Date.now(), lastActivityMs, paused: await exists(statePaths(root).pause), blockers };
}

export async function checkContinuation(root: string, observe = observeContinuation): Promise<ContinuationDecision> {
  const paths = statePaths(root);
  await mkdir(paths.directory, { recursive: true });
  try { await mkdir(paths.lock); } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    return appendDecision(root, { at: new Date().toISOString(), mode: "log-only", action: "blocked", reasons: ["MUTEX_BUSY_OR_ABANDONED"], dispatched: false });
  }
  try {
    let decision: ContinuationDecision;
    try {
      const observation = await exists(paths.pause)
        ? { observedAtMs: Date.now(), lastActivityMs: null, paused: true, blockers: [] }
        : await observe(root);
      observation.paused ||= await exists(paths.pause);
      decision = evaluateContinuation(observation, Date.now());
    } catch {
      decision = { at: new Date().toISOString(), mode: "log-only", action: "blocked", reasons: ["OBSERVATION_FAILED"], dispatched: false };
    }
    return await appendDecision(root, decision);
  } finally { await rmdir(paths.lock); }
}

export async function dispatchContinuation(root: string, adapter: ContinuationAdapter = { observe: observeContinuation, authorize: authorizeContinuation, execute: executeContinuation }): Promise<ContinuationDecision> {
  const paths = statePaths(root);
  await mkdir(paths.directory, { recursive: true });
  const blocked = (reason: string): ContinuationDecision => ({
    at: new Date().toISOString(), mode: "guarded-dispatch", action: "blocked", reasons: [reason], dispatched: false,
  });
  try { await mkdir(paths.lock); } catch (error) {
    if (!hasCode(error, "EEXIST")) throw error;
    return appendDecision(root, blocked("MUTEX_BUSY_OR_ABANDONED"));
  }
  let attempted = false;
  try {
    if (await exists(paths.dispatch)) return await appendDecision(root, blocked("PREVIOUS_DISPATCH_OUTCOME_UNKNOWN"));
    let binding: ContinuationBinding | undefined;
    for (let pass = 0; pass < 2; pass++) {
      const observation = await exists(paths.pause)
        ? { observedAtMs: Date.now(), lastActivityMs: null, paused: true, blockers: [] }
        : await adapter.observe(root);
      observation.paused ||= await exists(paths.pause);
      const decision = evaluateContinuation(observation, Date.now());
      if (decision.action !== "stale-log-only") return await appendDecision(root, { ...decision, mode: "guarded-dispatch" });
      const current = await adapter.authorize(root);
      if (!Number.isFinite(Date.parse(current.deadline)) || Date.parse(current.deadline) <= Date.now()) {
        return await appendDecision(root, blocked("TASK_EXPIRED"));
      }
      if (binding && JSON.stringify(binding) !== JSON.stringify(current)) {
        return await appendDecision(root, blocked("PENDING_BINDING_CHANGED"));
      }
      binding = current;
    }
    const intent: ContinuationDecision = {
      at: new Date().toISOString(), mode: "guarded-dispatch", action: "dispatch-intent",
      reasons: ["AUTHORIZED_PENDING_EFFECT"], dispatched: false, binding,
    };
    const handle = await open(paths.dispatch, "wx", 0o600);
    try { await handle.writeFile(`${JSON.stringify(intent)}\n`); await handle.sync(); } finally { await handle.close(); }
    await appendDecision(root, intent);
    if (await exists(paths.pause)) {
      await unlink(paths.dispatch);
      return await appendDecision(root, { ...blocked("USER_PAUSED"), action: "paused" });
    }
    attempted = true;
    await adapter.execute(root, binding!);
    const completed = await appendDecision(root, { ...intent, at: new Date().toISOString(), action: "completed", dispatched: true, reasons: ["DURABLE_EFFECT_COMPLETED"] });
    await unlink(paths.dispatch);
    return completed;
  } catch {
    return await appendDecision(root, { ...blocked(attempted ? "CHILD_OUTCOME_UNKNOWN" : "DISPATCH_PREFLIGHT_FAILED"), dispatched: attempted });
  } finally { await rmdir(paths.lock); }
}

export async function setContinuationPaused(root: string, paused: boolean): Promise<ContinuationDecision> {
  const paths = statePaths(root);
  await mkdir(paths.directory, { recursive: true });
  if (paused) {
    try {
      const handle = await open(paths.pause, "wx", 0o600);
      try { await handle.writeFile("USER_PAUSED\n"); await handle.sync(); } finally { await handle.close(); }
    } catch (error) { if (!hasCode(error, "EEXIST")) throw error; }
  } else {
    try { await unlink(paths.pause); } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  }
  return appendDecision(root, { at: new Date().toISOString(), mode: "log-only", action: paused ? "paused" : "observe", reasons: [paused ? "USER_PAUSED" : "USER_RESUMED_LOG_ONLY"], dispatched: false });
}

export async function continuationStatus(root: string): Promise<{ paused: boolean; locked: boolean; lastDecision: unknown }> {
  const paths = statePaths(root);
  let lastDecision: unknown = null;
  try {
    const handle = await open(paths.log, "r");
    try {
      const size = (await handle.stat()).size;
      const buffer = Buffer.alloc(Math.min(size, 16_384));
      await handle.read(buffer, 0, buffer.length, Math.max(0, size - buffer.length));
      const lines = buffer.toString("utf8").trimEnd().split("\n");
      lastDecision = JSON.parse(lines[lines.length - 1]);
    } finally { await handle.close(); }
  } catch (error) { if (!hasCode(error, "ENOENT")) throw error; }
  return { paused: await exists(paths.pause), locked: await exists(paths.lock), lastDecision };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  try {
    const command = process.argv[2] || "check";
    if (process.argv.length > 3) throw new Error("Unexpected arguments");
    if (command === "dispatch" && (!process.stdin.isTTY || !process.stdout.isTTY)) throw new Error("Dispatch requires an operator-owned foreground terminal, never the two-minute scheduled task.");
    const result = command === "check" ? await checkContinuation(root)
      : command === "dispatch" ? await dispatchContinuation(root)
      : command === "pause" ? await setContinuationPaused(root, true)
      : command === "resume" ? await setContinuationPaused(root, false)
      : command === "status" ? await continuationStatus(root)
      : null;
    if (!result) throw new Error("Unknown command");
    console.log(JSON.stringify(result, null, 2));
  } catch {
    console.error("Continuation watchdog failed closed. Commands: check, dispatch (foreground terminal only), pause, resume, status. Check local configuration and file permissions.");
    process.exitCode = 1;
  }
}