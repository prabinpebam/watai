// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { mkdtemp, mkdir, readFile, rm, stat, utimes, writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { resolve } from "node:path";

import type { EffectExecution } from "./execution";
import { SqliteHarnessStore } from "./sqliteStore";
import { evaluateControllerHealth, reconcileExpiredEffect } from "./watchdog";
import { checkContinuation, continuationExecutorCommand, continuationStaleMs, continuationStatus, dispatchContinuation, evaluateContinuation, inspectContinuationTask, inspectCostPermits, inspectDurableState, latestActivity, matchesContinuationTask, setContinuationPaused } from "./continuationWatchdog";
import type { LockedTaskSpec } from "./taskSpec";

describe("continuation watchdog", () => {
  it("uses a fixed windowless check-only scheduled launcher", async () => {
    const launcher = await readFile(resolve("scripts/continuation-watchdog-hidden.vbs"), "utf8");
    const installer = await readFile(resolve("scripts/continuation-watchdog-task.ps1"), "utf8");
    expect(launcher).toContain('shell.Run(command, 0, True)');
    expect(launcher).toContain(' & " check"');
    expect(launcher).not.toContain('dispatch');
    expect(installer).toContain('New-ScheduledTaskAction -Execute $windowlessHost');
    expect(installer).toContain('Task remains disabled until its quiet canary passes.');
  });

  it("keeps windowless checks non-interactive and task output unfocused", async () => {
    const tasks = JSON.parse(await readFile(resolve('.vscode/tasks.json'), 'utf8'));
    const runner = await readFile(resolve('scripts/run-quiet-check.ps1'), 'utf8');
    expect(tasks.presentation).toMatchObject({ reveal: 'never', revealProblems: 'never', focus: false, showReuseMessage: false });
    expect(tasks.options.shell.args).toContain('-NoProfile');
    expect(tasks.options.shell.args).toContain('-NonInteractive');
    expect(runner).toContain('$start.CreateNoWindow = $true');
    expect(runner).toContain('$start.UseShellExecute = $false');
    expect(runner).toContain('$process.StandardInput.Close()');
  });

  const nowMs = Date.parse("2026-09-11T06:00:00Z");
  const observation = { observedAtMs: nowMs, lastActivityMs: nowMs - continuationStaleMs, paused: false, blockers: [] };

  it("only logs stale work even when all supplied gates are clear", () => {
    expect(evaluateContinuation(observation, nowMs)).toMatchObject({ action: "stale-log-only", dispatched: false });
  });

  it("rechecks under the lock and logs intent before one fake execution", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const binding = { runId: "run", effectId: "effect", taskSpecSha256: "a".repeat(64), deadline: new Date(Date.now() + 60_000).toISOString() };
      const observe = vi.fn(async () => ({ ...observation, observedAtMs: Date.now(), lastActivityMs: Date.now() - continuationStaleMs }));
      const authorize = vi.fn(async () => binding);
      const execute = vi.fn(async () => {
        expect((await stat(resolve(root, ".harness-state", "continuation-watchdog.lock"))).isDirectory()).toBe(true);
        expect((await continuationStatus(root)).lastDecision).toMatchObject({ action: "dispatch-intent", binding, dispatched: false });
        expect((await dispatchContinuation(root, { observe, authorize, execute })).reasons).toEqual(["MUTEX_BUSY_OR_ABANDONED"]);
      });
      expect(await dispatchContinuation(root, { observe, authorize, execute })).toMatchObject({ action: "completed", dispatched: true });
      expect(observe).toHaveBeenCalledTimes(2);
      expect(authorize).toHaveBeenCalledTimes(2);
      expect(execute).toHaveBeenCalledOnce();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["activity", "pause", "authority", "binding", "unknown-child"])("fails closed when %s changes before dispatch or completion", async (change) => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const binding = { runId: "run", effectId: "effect", taskSpecSha256: "a".repeat(64), deadline: new Date(Date.now() + 60_000).toISOString() };
      let observations = 0;
      let authorizations = 0;
      const observe = vi.fn(async () => ({ ...observation, observedAtMs: Date.now(), lastActivityMs: Date.now() - (++observations === 2 && change === "activity" ? 0 : continuationStaleMs) }));
      const authorize = vi.fn(async () => {
        if (++authorizations === 2) {
          if (change === "authority") throw new Error("revoked");
          if (change === "pause") await setContinuationPaused(root, true);
          if (change === "binding") return { ...binding, effectId: "other" };
        }
        return binding;
      });
      const execute = vi.fn(async () => { throw new Error("unknown"); });
      const result = await dispatchContinuation(root, { observe, authorize, execute });
      expect(result.action).not.toBe("completed");
      if (change === "unknown-child") {
        expect(result.reasons).toEqual(["CHILD_OUTCOME_UNKNOWN"]);
        expect((await dispatchContinuation(root, { observe, authorize, execute })).reasons).toEqual(["PREVIOUS_DISPATCH_OUTCOME_UNKNOWN"]);
        expect(execute).toHaveBeenCalledOnce();
      } else expect(execute).not.toHaveBeenCalled();
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("observes activity until the twenty-minute threshold", () => {
    expect(evaluateContinuation({ ...observation, lastActivityMs: nowMs - continuationStaleMs + 1 }, nowMs).action).toBe("observe");
  });

  it("keeps a user pause in force regardless of age or blockers", () => {
    expect(evaluateContinuation({ ...observation, paused: true, observedAtMs: 0 }, nowMs).action).toBe("paused");
  });

  it.each([null, NaN, nowMs + 1])("fails closed for unknown activity %s", (lastActivityMs) => {
    expect(evaluateContinuation({ ...observation, lastActivityMs }, nowMs)).toMatchObject({ action: "blocked", dispatched: false });
  });

  it.each([0, NaN, nowMs + 1])("fails closed for stale or invalid telemetry %s", (observedAtMs) => {
    expect(evaluateContinuation({ ...observation, observedAtMs }, nowMs).action).toBe("blocked");
  });

  it.each(["AUTHORITY_ABSENT", "EFFECT_CLAIMED_OR_UNKNOWN", "PROCESS_UNKNOWN", "ACTIVE_COST_PERMIT", "CLOUD_OUTCOME_UNKNOWN"])("preserves blocker %s", (blocker) => {
    expect(evaluateContinuation({ ...observation, blockers: [blocker] }, nowMs)).toMatchObject({ action: "blocked", reasons: [blocker], activityStale: true, lastActivityAt: new Date(observation.lastActivityMs).toISOString() });
  });

  it("uses mtimes without parsing activity content or counting models metadata", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      await writeFile(resolve(root, "main.jsonl"), "secret-content-not-json");
      await utimes(resolve(root, "main.jsonl"), new Date(nowMs), new Date(nowMs));
      await writeFile(resolve(root, "models.json"), "unrelated");
      await writeFile(resolve(root, "continuation-watchdog-decisions.jsonl"), "not-progress");
      expect(await latestActivity(root)).toBe(nowMs);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("serializes concurrent checks, preserves append-only history, and never uses its log as activity", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      let release!: () => void;
      let entered!: () => void;
      const waiting = new Promise<void>((resolveWait) => { release = resolveWait; });
      const started = new Promise<void>((resolveStart) => { entered = resolveStart; });
      const staleObservation = () => ({ ...observation, observedAtMs: Date.now(), lastActivityMs: Date.now() - continuationStaleMs });
      const probe = vi.fn(async () => { entered(); await waiting; return staleObservation(); });
      const first = checkContinuation(root, probe);
      await started;
      expect((await checkContinuation(root, probe)).reasons).toEqual(["MUTEX_BUSY_OR_ABANDONED"]);
      release();
      expect((await first).action).toBe("stale-log-only");
      expect(probe).toHaveBeenCalledOnce();
      const log = resolve(root, ".harness-state", "continuation-watchdog-decisions.jsonl");
      const before = await readFile(log, "utf8");
      await checkContinuation(root, async () => staleObservation());
      expect((await readFile(log, "utf8")).startsWith(before)).toBe(true);
      expect((await continuationStatus(root)).lastDecision).toMatchObject({ action: "stale-log-only" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("persists pause until explicit resume and skips observations while paused", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const probe = vi.fn(async () => observation);
      await setContinuationPaused(root, true);
      await setContinuationPaused(root, true);
      expect((await checkContinuation(root, probe)).action).toBe("paused");
      expect(probe).not.toHaveBeenCalled();
      expect((await continuationStatus(root)).paused).toBe(true);
      await setContinuationPaused(root, false);
      expect((await continuationStatus(root)).paused).toBe(false);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("never steals an abandoned lock and fails closed on observation failure", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const probe = vi.fn(async () => { throw new Error("secret exception details"); });
      expect((await checkContinuation(root, probe)).reasons).toEqual(["OBSERVATION_FAILED"]);
      const lock = resolve(root, ".harness-state", "continuation-watchdog.lock");
      await mkdir(lock);
      await utimes(lock, new Date(0), new Date(0));
      expect((await checkContinuation(root, probe)).reasons).toEqual(["MUTEX_BUSY_OR_ABANDONED"]);
      expect((await stat(lock)).isDirectory()).toBe(true);
      expect(await readFile(resolve(root, ".harness-state", "continuation-watchdog-decisions.jsonl"), "utf8")).not.toContain("secret");
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("observes active and consumed cost permits without changing them", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const directory = resolve(root, ".harness-state", "work-decisions");
      await mkdir(directory, { recursive: true });
      const path = resolve(directory, "consumed.json");
      const text = JSON.stringify({ status: "APPROVED", expiresAt: new Date(nowMs + 60_000).toISOString() });
      await writeFile(path, text);
      expect(await inspectCostPermits(root, nowMs)).toEqual(["ACTIVE_COST_PERMIT"]);
      expect(await readFile(path, "utf8")).toBe(text);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it.each(["claimed", "reconciling", "outcome-unknown"])("reads real SQLite %s effects and active leases without mutation", async (status) => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const path = resolve(root, "harness.sqlite");
      new SqliteHarnessStore(path).close();
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
      const database = new DatabaseSync(path);
      try {
        database.prepare("INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?)").run("run", 1, "source", "policy", 1, "{}");
        database.prepare("INSERT INTO effect_outbox VALUES (?, ?, ?, ?, ?)").run("effect", "run", 1, status, JSON.stringify({ kind: "worker" }));
        database.prepare("INSERT INTO leases VALUES (?, ?, ?, ?, ?)").run("lease", "owner", 1, nowMs + 60_000, 1);
        database.prepare("INSERT INTO budget_ledgers VALUES (?, ?, ?)").run("run", 1, JSON.stringify({ reservations: [{ status: "reserved" }] }));
      } finally { database.close(); }
      const before = await readFile(path);
      expect(inspectDurableState(path, nowMs)).toEqual(expect.arrayContaining(["EFFECT_CLAIMED_OR_UNKNOWN", "NO_PENDING_WORKER_EFFECT", "ACTIVE_OR_UNKNOWN_LEASE", "BUDGET_RESERVED_OR_UNKNOWN"]));
      expect(await readFile(path)).toEqual(before);
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("does not create a missing durable database", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const path = resolve(root, "missing.sqlite");
      expect(() => inspectDurableState(path, nowMs)).toThrow();
      await expect(stat(path)).rejects.toMatchObject({ code: "ENOENT" });
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("binds a pending task and existing budget read-only, rejecting mismatches and prior execution", async () => {
    const root = await mkdtemp(resolve(tmpdir(), "watai-watchdog-"));
    try {
      const path = resolve(root, "harness.sqlite");
      const intent = { ...effect("queryable").intent, status: "pending" as const, deadline: new Date(nowMs + 60_000).toISOString(), providerId: "provider", model: "model" };
      const task = { runId: intent.runId, fencingEpoch: intent.epoch, taskSpecSha256: intent.inputSha256, deadline: intent.deadline, source: { sourceSha: intent.sourceSha }, bindings: { policySha256: intent.policySha256 }, agentRuntime: { providerId: intent.providerId, model: intent.model }, budgets: { maxUsd: 1, maxInputTokens: 10, maxOutputTokens: 10, maxRequests: 1 } } as LockedTaskSpec;
      new SqliteHarnessStore(path).close();
      const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");
      const database = new DatabaseSync(path);
      try {
        database.prepare("INSERT INTO candidates VALUES (?, ?, ?, ?, ?, ?)").run(intent.runId, 1, intent.sourceSha, intent.policySha256, intent.epoch, "{}");
        database.prepare("INSERT INTO effect_outbox VALUES (?, ?, ?, ?, ?)").run(intent.effectId, intent.runId, intent.epoch, "pending", JSON.stringify(intent));
        database.prepare("INSERT INTO budget_ledgers VALUES (?, ?, ?)").run(intent.runId, 0, JSON.stringify({ revision: 0, limits: { usd: 1, inputTokens: 10, outputTokens: 10, requests: 1 }, reservations: [] }));
        expect(inspectContinuationTask(path, task, nowMs)).toMatchObject({ effectId: intent.effectId, runId: intent.runId });
        for (const key of ["runId", "inputSha256", "sourceSha", "policySha256", "epoch", "deadline", "providerId", "model", "status", "kind"] as const) {
          expect(matchesContinuationTask({ ...intent, [key]: "mismatch" }, task)).toBe(false);
        }
        expect(() => inspectContinuationTask(path, { ...task, budgets: { ...task.budgets, maxRequests: 2 } }, nowMs)).toThrow();
        expect(() => inspectContinuationTask(path, task, nowMs + 60_000)).toThrow();
        database.prepare("INSERT INTO effect_executions VALUES (?, ?, ?, ?, ?, ?)").run(intent.effectId, intent.runId, 1, JSON.stringify({ ...effect("queryable"), status: "completed" }), null, new Date(nowMs).toISOString());
        expect(() => inspectContinuationTask(path, task, nowMs)).toThrow("EFFECT_ALREADY_DISPATCHED");
        expect(database.prepare("SELECT revision FROM budget_ledgers").get()?.revision).toBe(0);
      } finally { database.close(); }
    } finally { await rm(root, { recursive: true, force: true }); }
  });

  it("constructs only the fixed durable executor command with literal binding data", () => {
    const binding = { runId: "run", effectId: "effect & arbitrary-command", taskSpecSha256: "a".repeat(64), deadline: new Date(nowMs).toISOString() };
    expect(continuationExecutorCommand("E:/example", binding)).toEqual({ executable: process.execPath, args: [resolve("E:/example", ".harness-dist", "durableExecutorCli.js"), "--continuation-binding", JSON.stringify(binding)] });
  });
});

const effect = (idempotency: EffectExecution["idempotency"]): EffectExecution => ({
  revision: 1,
  intent: {
    effectId: "effect-watchdog",
    runId: "run-watchdog",
    epoch: 4,
    kind: "worker",
    inputSha256: "a".repeat(64),
    sourceSha: "b".repeat(40),
    policySha256: "c".repeat(64),
    eventId: "event-watchdog",
    deadline: "2026-09-10T12:00:00.000Z",
    status: "pending",
  },
  status: "claimed",
  attempts: 1,
  reservationId: "reservation-watchdog",
  idempotency,
  claim: {
    workerId: "worker-old",
    fencingEpoch: 4,
    claimedAt: "2026-09-10T10:58:00.000Z",
    leaseUntil: "2026-09-10T10:59:00.000Z",
  },
});

describe("watchdog", () => {
  it("waits for lease expiry before fencing a missed controller", () => {
    const health = {
      ownerId: "controller-a",
      fencingEpoch: 4,
      leaseUntilMs: 10_000,
      lastHeartbeatMs: 7_000,
      consecutiveMisses: 3,
    };
    expect(evaluateControllerHealth(health, 9_000, 1_000, 3).action).toBe("observe");
    expect(evaluateControllerHealth(health, 10_001, 1_000, 3)).toMatchObject({
      action: "fence-and-takeover",
      nextFencingEpoch: 5,
    });
  });

  it("confirms a queryable provider receipt before completion", async () => {
    const reader = { query: vi.fn().mockResolvedValue({
      status: "completed",
      receiptId: "receipt-watchdog",
      outputSha256: "d".repeat(64),
      completedAt: "2026-09-10T11:01:00.000Z",
    }) };
    const result = await reconcileExpiredEffect(
      effect("queryable"),
      1,
      "2026-09-10T11:00:00.000Z",
      reader,
    );
    expect(result).toMatchObject({ action: "completed", effect: { status: "completed", revision: 3 } });
  });

  it("permits retry only when the provider proves no effect exists", async () => {
    const result = await reconcileExpiredEffect(
      effect("queryable"),
      1,
      "2026-09-10T11:00:00.000Z",
      { query: vi.fn().mockResolvedValue({ status: "not-found" }) },
    );
    expect(result).toMatchObject({ action: "retry-eligible", effect: { status: "failed" } });
  });

  it("blocks unqueryable and ambiguous effects without repeating them", async () => {
    const reader = { query: vi.fn().mockResolvedValue({ status: "unknown", reason: "provider unavailable" }) };
    const unqueryable = await reconcileExpiredEffect(effect("none"), 1, "2026-09-10T11:00:00.000Z", reader);
    const ambiguous = await reconcileExpiredEffect(effect("queryable"), 1, "2026-09-10T11:00:00.000Z", reader);
    expect(unqueryable).toMatchObject({ action: "blocked-unknown", effect: { status: "outcome-unknown" } });
    expect(ambiguous).toMatchObject({ action: "blocked-unknown", effect: { status: "outcome-unknown" } });
    expect(reader.query).toHaveBeenCalledOnce();
  });
});