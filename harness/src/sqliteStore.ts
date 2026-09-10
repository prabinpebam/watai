import { mkdirSync } from "node:fs";
import { createRequire } from "node:module";
import { dirname } from "node:path";
import type { DatabaseSync as DatabaseSyncType } from "node:sqlite";

import {
  applyEvent,
  createCandidate,
  type ApplyResult,
  type CandidateSnapshot,
  type CompiledWorkflow,
  type EventCommand,
  type HarnessAuthorities,
} from "./controller.js";
import {
  claimEffect,
  completeEffect,
  markEffectOutcomeUnknown,
  renewEffectClaim,
  reserveBudget,
  updateReservation,
  type BudgetReservation,
  type BudgetState,
  type ClaimEffectCommand,
  type EffectExecution,
  type ReservationStatus,
} from "./execution.js";
import type { GatewayReceiptStore, GatewayStoredReceipt } from "./gatewayService.js";
import type { ProviderUsageReceipt } from "./executionCoordinator.js";

const { DatabaseSync } = createRequire(import.meta.url)("node:sqlite") as typeof import("node:sqlite");

export class SqliteStoreError extends Error {
  constructor(readonly code: string, message: string) {
    super(message);
    this.name = "SqliteStoreError";
  }
}

export interface HarnessLease {
  leaseName: string;
  ownerId: string;
  fencingEpoch: number;
  leaseUntilMs: number;
  revision: number;
}

interface CandidateRow {
  snapshot_json: string;
  revision: number;
}

interface LeaseRow {
  lease_name: string;
  owner_id: string;
  fencing_epoch: number;
  lease_until_ms: number;
  revision: number;
}

interface BudgetRow {
  revision: number;
  state_json: string;
}

interface EffectExecutionRow {
  run_id: string;
  revision: number;
  state_json: string;
  session_id: string | null;
}

function parseSnapshot(value: string): CandidateSnapshot {
  try {
    return JSON.parse(value) as CandidateSnapshot;
  } catch {
    throw new SqliteStoreError("STORE_CORRUPT", "Candidate snapshot is not valid JSON.");
  }
}

function lease(row: LeaseRow): HarnessLease {
  return {
    leaseName: row.lease_name,
    ownerId: row.owner_id,
    fencingEpoch: row.fencing_epoch,
    leaseUntilMs: row.lease_until_ms,
    revision: row.revision,
  };
}

export class SqliteHarnessStore {
  private readonly database: DatabaseSyncType;
  private readonly injectFault: (point: string) => void;

  constructor(path: string, options: { injectFault?: (point: string) => void } = {}) {
    this.injectFault = options.injectFault ?? (() => undefined);
    mkdirSync(dirname(path), { recursive: true });
    this.database = new DatabaseSync(path);
    this.database.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = FULL;
      PRAGMA foreign_keys = ON;
      PRAGMA busy_timeout = 5000;
      CREATE TABLE IF NOT EXISTS harness_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS budget_ledgers (
        run_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL
      ) STRICT;
      INSERT INTO harness_meta(key, value) VALUES ('schema_version', '1.0')
        ON CONFLICT(key) DO NOTHING;
      CREATE TABLE IF NOT EXISTS candidates (
        run_id TEXT PRIMARY KEY,
        revision INTEGER NOT NULL,
        source_sha TEXT NOT NULL,
        policy_sha256 TEXT NOT NULL,
        fencing_epoch INTEGER NOT NULL,
        snapshot_json TEXT NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS event_receipts (
        run_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        event_id TEXT NOT NULL,
        receipt_json TEXT NOT NULL,
        PRIMARY KEY(run_id, revision),
        UNIQUE(run_id, event_id),
        FOREIGN KEY(run_id) REFERENCES candidates(run_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS effect_outbox (
        effect_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        fencing_epoch INTEGER NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','claimed','completed','failed','reconciling','outcome-unknown')),
        intent_json TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES candidates(run_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS leases (
        lease_name TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        fencing_epoch INTEGER NOT NULL,
        lease_until_ms INTEGER NOT NULL,
        revision INTEGER NOT NULL
      ) STRICT;
      CREATE TABLE IF NOT EXISTS effect_executions (
        effect_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        revision INTEGER NOT NULL,
        state_json TEXT NOT NULL,
        session_id TEXT,
        updated_at TEXT NOT NULL,
        FOREIGN KEY(effect_id) REFERENCES effect_outbox(effect_id),
        FOREIGN KEY(run_id) REFERENCES candidates(run_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS gateway_receipts (
        run_id TEXT NOT NULL,
        request_id TEXT NOT NULL,
        fingerprint TEXT NOT NULL,
        tool TEXT NOT NULL,
        status TEXT NOT NULL CHECK(status IN ('pending','completed')),
        response_json TEXT,
        created_at TEXT NOT NULL,
        completed_at TEXT,
        PRIMARY KEY(run_id, request_id),
        FOREIGN KEY(run_id) REFERENCES candidates(run_id)
      ) STRICT;
      CREATE TABLE IF NOT EXISTS provider_usage_receipts (
        receipt_id TEXT PRIMARY KEY,
        run_id TEXT NOT NULL,
        effect_id TEXT NOT NULL UNIQUE,
        receipt_json TEXT NOT NULL,
        FOREIGN KEY(run_id) REFERENCES candidates(run_id),
        FOREIGN KEY(effect_id) REFERENCES effect_executions(effect_id)
      ) STRICT;
    `);
  }

  close(): void {
    this.database.close();
  }

  createCandidate(
    workflow: CompiledWorkflow,
    input: Pick<CandidateSnapshot, "runId" | "fencingEpoch" | "sourceSha" | "policySha256">,
  ): CandidateSnapshot {
    const snapshot = createCandidate(workflow, input);
    try {
      this.database.prepare(`
        INSERT INTO candidates(run_id, revision, source_sha, policy_sha256, fencing_epoch, snapshot_json)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(
        snapshot.runId,
        snapshot.revision,
        snapshot.sourceSha,
        snapshot.policySha256,
        snapshot.fencingEpoch,
        JSON.stringify(snapshot),
      );
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) {
        const existing = this.readCandidate(snapshot.runId);
        if (
          existing.sourceSha === snapshot.sourceSha &&
          existing.policySha256 === snapshot.policySha256 &&
          existing.fencingEpoch === snapshot.fencingEpoch
        ) {
          return existing;
        }
        throw new SqliteStoreError("CANDIDATE_ID_CONFLICT", "Run ID is bound to another candidate identity.");
      }
      throw error;
    }
    return snapshot;
  }

  readCandidate(runId: string): CandidateSnapshot {
    const row = this.database
      .prepare("SELECT revision, snapshot_json FROM candidates WHERE run_id = ?")
      .get(runId) as unknown as CandidateRow | undefined;
    if (!row) throw new SqliteStoreError("CANDIDATE_UNKNOWN", `Unknown candidate ${runId}.`);
    const snapshot = parseSnapshot(row.snapshot_json);
    if (snapshot.revision !== row.revision || snapshot.runId !== runId) {
      throw new SqliteStoreError("STORE_CORRUPT", "Candidate columns do not match its snapshot.");
    }
    return snapshot;
  }

  apply(
    workflow: CompiledWorkflow,
    command: EventCommand,
    authorities: HarnessAuthorities,
  ): ApplyResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readCandidate(command.envelope.runId);
      const result = applyEvent(workflow, current, command, authorities);
      if (result.kind !== "replayed") {
        const event = result.receipt;
        this.database.prepare(`
          INSERT INTO event_receipts(run_id, revision, event_id, receipt_json)
          VALUES (?, ?, ?, ?)
        `).run(result.candidate.runId, event.revision, event.eventId, JSON.stringify(event));
        const previousEffects = new Set(current.outbox.map((intent) => intent.effectId));
        for (const intent of result.candidate.outbox) {
          if (previousEffects.has(intent.effectId)) continue;
          this.database.prepare(`
            INSERT INTO effect_outbox(effect_id, run_id, fencing_epoch, status, intent_json)
            VALUES (?, ?, ?, 'pending', ?)
          `).run(intent.effectId, intent.runId, intent.epoch, JSON.stringify(intent));
        }
        const updated = this.database.prepare(`
          UPDATE candidates
             SET revision = ?, snapshot_json = ?
           WHERE run_id = ? AND revision = ? AND source_sha = ? AND policy_sha256 = ? AND fencing_epoch = ?
        `).run(
          result.candidate.revision,
          JSON.stringify(result.candidate),
          result.candidate.runId,
          current.revision,
          current.sourceSha,
          current.policySha256,
          current.fencingEpoch,
        );
        if (updated.changes !== 1) {
          throw new SqliteStoreError("CANDIDATE_CAS_LOST", "Candidate compare-and-swap lost.");
        }
      }
      this.database.exec("COMMIT");
      return result;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  pendingEffects(runId: string): Array<{ effectId: string; status: string; intent: unknown }> {
    const rows = this.database.prepare(`
      SELECT effect_id, status, intent_json
        FROM effect_outbox
       WHERE run_id = ? AND status IN ('pending','reconciling')
       ORDER BY effect_id
    `).all(runId) as unknown as Array<{ effect_id: string; status: string; intent_json: string }>;
    return rows.map((row) => ({
      effectId: row.effect_id,
      status: row.status,
      intent: JSON.parse(row.intent_json),
    }));
  }

  readEffect(effectId: string): EffectExecution {
    const row = this.database.prepare(`
      SELECT run_id, revision, state_json, session_id
        FROM effect_executions
       WHERE effect_id = ?
    `).get(effectId) as unknown as EffectExecutionRow | undefined;
    if (!row) throw new SqliteStoreError("EFFECT_UNKNOWN", `Unknown effect execution ${effectId}.`);
    const effect = JSON.parse(row.state_json) as EffectExecution;
    if (
      effect.intent.effectId !== effectId ||
      effect.intent.runId !== row.run_id ||
      effect.revision !== row.revision
    ) {
      throw new SqliteStoreError("STORE_CORRUPT", "Effect execution columns do not match its state.");
    }
    return effect;
  }

  readEffectSessionId(effectId: string): string | null {
    const row = this.database.prepare("SELECT session_id FROM effect_executions WHERE effect_id = ?")
      .get(effectId) as unknown as { session_id: string | null } | undefined;
    if (!row) throw new SqliteStoreError("EFFECT_UNKNOWN", `Unknown effect execution ${effectId}.`);
    return row.session_id;
  }

  listEffects(runId: string, statuses?: EffectExecution["status"][]): EffectExecution[] {
    const rows = this.database.prepare(`
      SELECT state_json FROM effect_executions WHERE run_id = ? ORDER BY effect_id
    `).all(runId) as unknown as Array<{ state_json: string }>;
    const effects = rows.map((row) => JSON.parse(row.state_json) as EffectExecution);
    return statuses ? effects.filter((effect) => statuses.includes(effect.status)) : effects;
  }

  gatewayReceiptStore(): GatewayReceiptStore {
    return {
      begin: async (receipt) => {
        try {
          this.database.prepare(`
            INSERT INTO gateway_receipts(run_id, request_id, fingerprint, tool, status, response_json, created_at, completed_at)
            VALUES (?, ?, ?, ?, 'pending', NULL, ?, NULL)
          `).run(receipt.runId, receipt.requestId, receipt.fingerprint, receipt.tool, receipt.createdAt);
          return undefined;
        } catch (error) {
          if (!String(error).includes("UNIQUE constraint failed")) throw error;
          return this.readGatewayReceipt(receipt.runId, receipt.requestId);
        }
      },
      complete: async (runId, requestId, fingerprint, response, completedAt) => {
        const result = this.database.prepare(`
          UPDATE gateway_receipts
             SET status = 'completed', response_json = ?, completed_at = ?
           WHERE run_id = ? AND request_id = ? AND fingerprint = ? AND status = 'pending'
        `).run(JSON.stringify(response), completedAt, runId, requestId, fingerprint);
        if (result.changes === 1) return;
        const current = this.readGatewayReceipt(runId, requestId);
        if (
          current.status === "completed" &&
          current.fingerprint === fingerprint &&
          JSON.stringify(current.response) === JSON.stringify(response)
        ) return;
        throw new SqliteStoreError("GATEWAY_RECEIPT_CAS_LOST", "Gateway receipt completion is stale or conflicting.");
      },
      list: async (runId) => {
        const rows = this.database.prepare(`
          SELECT request_id FROM gateway_receipts WHERE run_id = ? ORDER BY request_id
        `).all(runId) as unknown as Array<{ request_id: string }>;
        return rows.map((row) => this.readGatewayReceipt(runId, row.request_id));
      },
    };
  }

  private readGatewayReceipt(runId: string, requestId: string): GatewayStoredReceipt {
    const row = this.database.prepare(`
      SELECT fingerprint, tool, status, response_json, created_at, completed_at
        FROM gateway_receipts WHERE run_id = ? AND request_id = ?
    `).get(runId, requestId) as unknown as {
      fingerprint: string;
      tool: GatewayStoredReceipt["tool"];
      status: "pending" | "completed";
      response_json: string | null;
      created_at: string;
      completed_at: string | null;
    } | undefined;
    if (!row) throw new SqliteStoreError("GATEWAY_RECEIPT_UNKNOWN", `Unknown gateway receipt ${runId}/${requestId}.`);
    return {
      requestId,
      runId,
      fingerprint: row.fingerprint,
      tool: row.tool,
      status: row.status,
      ...(row.response_json ? { response: JSON.parse(row.response_json) } : {}),
      createdAt: row.created_at,
      ...(row.completed_at ? { completedAt: row.completed_at } : {}),
    };
  }

  beginEffectDispatch(
    runId: string,
    effectId: string,
    idempotency: EffectExecution["idempotency"],
    reservation: BudgetReservation,
    command: Omit<ClaimEffectCommand, "expectedRevision" | "reservation">,
  ): { effect: EffectExecution; budget: BudgetState } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database.prepare("SELECT 1 FROM effect_executions WHERE effect_id = ?")
        .get(effectId);
      if (existing) {
        throw new SqliteStoreError("EFFECT_ALREADY_DISPATCHED", `Effect ${effectId} already has durable execution state.`);
      }
      const outbox = this.database.prepare(`
        SELECT run_id, status, intent_json FROM effect_outbox WHERE effect_id = ?
      `).get(effectId) as unknown as { run_id: string; status: string; intent_json: string } | undefined;
      if (!outbox || outbox.run_id !== runId || outbox.status !== "pending") {
        throw new SqliteStoreError("EFFECT_NOT_PENDING", `Effect ${effectId} is not pending for ${runId}.`);
      }
      const budget = this.readBudget(runId);
      const reserved = reserveBudget(budget, budget.revision, reservation);
      const dispatched = updateReservation(
        reserved,
        reserved.revision,
        reservation.reservationId,
        "dispatched",
      );
      const initial: EffectExecution = {
        revision: 0,
        intent: JSON.parse(outbox.intent_json) as EffectExecution["intent"],
        status: "pending",
        attempts: 0,
        reservationId: reservation.reservationId,
        idempotency,
      };
      const claimed = claimEffect(initial, {
        ...command,
        expectedRevision: initial.revision,
        reservation,
      });
      const budgetUpdate = this.database.prepare(`
        UPDATE budget_ledgers SET revision = ?, state_json = ?
         WHERE run_id = ? AND revision = ?
      `).run(dispatched.revision, JSON.stringify(dispatched), runId, budget.revision);
      if (budgetUpdate.changes !== 1) throw new SqliteStoreError("BUDGET_CAS_LOST", "Budget compare-and-swap lost.");
      this.injectFault("dispatch-after-budget");
      this.database.prepare(`
        INSERT INTO effect_executions(effect_id, run_id, revision, state_json, session_id, updated_at)
        VALUES (?, ?, ?, ?, NULL, ?)
      `).run(effectId, runId, claimed.revision, JSON.stringify(claimed), command.now);
      this.injectFault("dispatch-after-effect");
      const outboxUpdate = this.database.prepare(`
        UPDATE effect_outbox SET status = 'claimed' WHERE effect_id = ? AND status = 'pending'
      `).run(effectId);
      if (outboxUpdate.changes !== 1) throw new SqliteStoreError("EFFECT_CAS_LOST", "Effect claim compare-and-swap lost.");
      this.injectFault("dispatch-after-outbox");
      this.database.exec("COMMIT");
      return { effect: claimed, budget: dispatched };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  bindEffectSession(effectId: string, expectedRevision: number, sessionId: string, updatedAt: string): void {
    if (!sessionId.trim() || !Number.isFinite(Date.parse(updatedAt))) {
      throw new SqliteStoreError("SESSION_BINDING_INVALID", "Session ID and timestamp are required.");
    }
    const result = this.database.prepare(`
      UPDATE effect_executions SET session_id = ?, updated_at = ?
       WHERE effect_id = ? AND revision = ? AND session_id IS NULL
    `).run(sessionId, updatedAt, effectId, expectedRevision);
    if (result.changes !== 1) {
      const current = this.readEffectSessionId(effectId);
      if (current === sessionId) return;
      throw new SqliteStoreError("EFFECT_SESSION_CAS_LOST", "Effect session binding is stale or conflicting.");
    }
  }

  renewEffect(
    effectId: string,
    expectedRevision: number,
    fencingEpoch: number,
    now: string,
    leaseUntil: string,
    minimumLeaseMs: number,
  ): EffectExecution {
    return this.updateEffect(effectId, expectedRevision, now, (effect) =>
      renewEffectClaim(effect, expectedRevision, fencingEpoch, now, leaseUntil, minimumLeaseMs));
  }

  markEffectUnknown(
    runId: string,
    effectId: string,
    expectedEffectRevision: number,
    fencingEpoch: number,
    expectedBudgetRevision: number,
    reservationId: string,
    updatedAt: string,
  ): { effect: EffectExecution; budget: BudgetState } {
    return this.settleEffectTransaction(
      runId,
      effectId,
      expectedEffectRevision,
      expectedBudgetRevision,
      updatedAt,
      (effect) => markEffectOutcomeUnknown(effect, expectedEffectRevision, fencingEpoch),
      (budget) => updateReservation(budget, expectedBudgetRevision, reservationId, "outcome-unknown"),
    );
  }

  completeEffect(
    runId: string,
    effectId: string,
    expectedEffectRevision: number,
    fencingEpoch: number,
    expectedBudgetRevision: number,
    reservationId: string,
    providerReceipt: ProviderUsageReceipt,
  ): { effect: EffectExecution; budget: BudgetState } {
    const receipt: NonNullable<EffectExecution["receipt"]> = {
      receiptId: providerReceipt.receiptId,
      outputSha256: providerReceipt.outputSha256,
      completedAt: providerReceipt.completedAt,
    };
    return this.settleEffectTransaction(
      runId,
      effectId,
      expectedEffectRevision,
      expectedBudgetRevision,
      receipt.completedAt,
      (effect) => {
        if (
          providerReceipt.runId !== runId ||
          providerReceipt.effectId !== effectId ||
          providerReceipt.reservationId !== reservationId ||
          effect.reservationId !== reservationId ||
          (effect.intent.providerId !== undefined && providerReceipt.providerId !== effect.intent.providerId) ||
          (effect.intent.model !== undefined && providerReceipt.model !== effect.intent.model)
        ) {
          throw new SqliteStoreError(
            "PROVIDER_RECEIPT_BINDING_MISMATCH",
            "Provider receipt does not belong to the claimed effect and reservation.",
          );
        }
        return completeEffect(effect, expectedEffectRevision, fencingEpoch, receipt);
      },
      (budget) => updateReservation(budget, expectedBudgetRevision, reservationId, "settled", providerReceipt.usage),
      providerReceipt,
    );
  }

  readProviderUsageReceipt(effectId: string): ProviderUsageReceipt {
    const row = this.database.prepare("SELECT receipt_json FROM provider_usage_receipts WHERE effect_id = ?")
      .get(effectId) as unknown as { receipt_json: string } | undefined;
    if (!row) throw new SqliteStoreError("PROVIDER_RECEIPT_UNKNOWN", `No provider receipt exists for ${effectId}.`);
    return JSON.parse(row.receipt_json) as ProviderUsageReceipt;
  }

  private updateEffect(
    effectId: string,
    expectedRevision: number,
    updatedAt: string,
    reducer: (effect: EffectExecution) => EffectExecution,
  ): EffectExecution {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readEffect(effectId);
      const next = reducer(current);
      const result = this.database.prepare(`
        UPDATE effect_executions SET revision = ?, state_json = ?, updated_at = ?
         WHERE effect_id = ? AND revision = ?
      `).run(next.revision, JSON.stringify(next), updatedAt, effectId, expectedRevision);
      if (result.changes !== 1) throw new SqliteStoreError("EFFECT_CAS_LOST", "Effect compare-and-swap lost.");
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  private settleEffectTransaction(
    runId: string,
    effectId: string,
    expectedEffectRevision: number,
    expectedBudgetRevision: number,
    updatedAt: string,
    effectReducer: (effect: EffectExecution) => EffectExecution,
    budgetReducer: (budget: BudgetState) => BudgetState,
    providerReceipt?: ProviderUsageReceipt,
  ): { effect: EffectExecution; budget: BudgetState } {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const currentEffect = this.readEffect(effectId);
      if (currentEffect.intent.runId !== runId) throw new SqliteStoreError("EFFECT_RUN_MISMATCH", "Effect belongs to another run.");
      const currentBudget = this.readBudget(runId);
      const nextEffect = effectReducer(currentEffect);
      const nextBudget = budgetReducer(currentBudget);
      const effectUpdate = this.database.prepare(`
        UPDATE effect_executions SET revision = ?, state_json = ?, updated_at = ?
         WHERE effect_id = ? AND revision = ?
      `).run(nextEffect.revision, JSON.stringify(nextEffect), updatedAt, effectId, expectedEffectRevision);
      if (effectUpdate.changes !== 1) throw new SqliteStoreError("EFFECT_CAS_LOST", "Effect compare-and-swap lost.");
      this.injectFault("settle-after-effect");
      const budgetUpdate = this.database.prepare(`
        UPDATE budget_ledgers SET revision = ?, state_json = ?
         WHERE run_id = ? AND revision = ?
      `).run(nextBudget.revision, JSON.stringify(nextBudget), runId, expectedBudgetRevision);
      if (budgetUpdate.changes !== 1) throw new SqliteStoreError("BUDGET_CAS_LOST", "Budget compare-and-swap lost.");
      this.injectFault("settle-after-budget");
      const outboxUpdate = this.database.prepare(`
        UPDATE effect_outbox SET status = ? WHERE effect_id = ? AND status = 'claimed'
      `).run(nextEffect.status, effectId);
      if (outboxUpdate.changes !== 1) throw new SqliteStoreError("EFFECT_CAS_LOST", "Outbox effect compare-and-swap lost.");
      if (providerReceipt) {
        this.database.prepare(`
          INSERT INTO provider_usage_receipts(receipt_id, run_id, effect_id, receipt_json)
          VALUES (?, ?, ?, ?)
        `).run(providerReceipt.receiptId, runId, effectId, JSON.stringify(providerReceipt));
      }
      this.injectFault("settle-after-outbox");
      this.database.exec("COMMIT");
      return { effect: nextEffect, budget: nextBudget };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  createBudget(runId: string, limits: BudgetState["limits"]): BudgetState {
    const state: BudgetState = { revision: 0, limits, reservations: [] };
    try {
      this.database.prepare(`
        INSERT INTO budget_ledgers(run_id, revision, state_json) VALUES (?, 0, ?)
      `).run(runId, JSON.stringify(state));
      return state;
    } catch (error) {
      if (String(error).includes("UNIQUE constraint failed")) return this.readBudget(runId);
      throw error;
    }
  }

  readBudget(runId: string): BudgetState {
    const row = this.database
      .prepare("SELECT revision, state_json FROM budget_ledgers WHERE run_id = ?")
      .get(runId) as unknown as BudgetRow | undefined;
    if (!row) throw new SqliteStoreError("BUDGET_UNKNOWN", `Unknown budget ledger ${runId}.`);
    const state = JSON.parse(row.state_json) as BudgetState;
    if (state.revision !== row.revision) throw new SqliteStoreError("STORE_CORRUPT", "Budget revision mismatch.");
    return state;
  }

  reserve(
    runId: string,
    expectedRevision: number,
    reservation: BudgetReservation,
  ): BudgetState {
    return this.updateBudget(runId, expectedRevision, (state) =>
      reserveBudget(state, expectedRevision, reservation));
  }

  transitionReservation(
    runId: string,
    expectedRevision: number,
    reservationId: string,
    status: Exclude<ReservationStatus, "reserved">,
    actual?: BudgetState["limits"],
  ): BudgetState {
    return this.updateBudget(runId, expectedRevision, (state) =>
      updateReservation(state, expectedRevision, reservationId, status, actual));
  }

  private updateBudget(
    runId: string,
    expectedRevision: number,
    reducer: (state: BudgetState) => BudgetState,
  ): BudgetState {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const current = this.readBudget(runId);
      const next = reducer(current);
      const result = this.database.prepare(`
        UPDATE budget_ledgers SET revision = ?, state_json = ?
         WHERE run_id = ? AND revision = ?
      `).run(next.revision, JSON.stringify(next), runId, expectedRevision);
      if (result.changes !== 1) throw new SqliteStoreError("BUDGET_CAS_LOST", "Budget compare-and-swap lost.");
      this.database.exec("COMMIT");
      return next;
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  acquireLease(
    leaseName: string,
    ownerId: string,
    nowMs: number,
    ttlMs: number,
  ): HarnessLease {
    if (!leaseName.trim() || !ownerId.trim() || !Number.isSafeInteger(nowMs) || !Number.isSafeInteger(ttlMs) || ttlMs < 1) {
      throw new SqliteStoreError("LEASE_INPUT_INVALID", "Lease name, owner, time and TTL are required.");
    }
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const existing = this.database
        .prepare("SELECT * FROM leases WHERE lease_name = ?")
        .get(leaseName) as unknown as LeaseRow | undefined;
      if (existing && existing.lease_until_ms > nowMs && existing.owner_id !== ownerId) {
        throw new SqliteStoreError("LEASE_HELD", `Lease ${leaseName} is held by another owner.`);
      }
      const next: LeaseRow = {
        lease_name: leaseName,
        owner_id: ownerId,
        fencing_epoch: existing && existing.owner_id === ownerId
          ? existing.fencing_epoch
          : (existing?.fencing_epoch ?? 0) + 1,
        lease_until_ms: nowMs + ttlMs,
        revision: (existing?.revision ?? -1) + 1,
      };
      this.database.prepare(`
        INSERT INTO leases(lease_name, owner_id, fencing_epoch, lease_until_ms, revision)
        VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(lease_name) DO UPDATE SET
          owner_id = excluded.owner_id,
          fencing_epoch = excluded.fencing_epoch,
          lease_until_ms = excluded.lease_until_ms,
          revision = excluded.revision
      `).run(next.lease_name, next.owner_id, next.fencing_epoch, next.lease_until_ms, next.revision);
      this.database.exec("COMMIT");
      return lease(next);
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  heartbeatLease(
    leaseName: string,
    ownerId: string,
    fencingEpoch: number,
    expectedRevision: number,
    nowMs: number,
    ttlMs: number,
  ): HarnessLease {
    const updated = this.database.prepare(`
      UPDATE leases
         SET lease_until_ms = ?, revision = revision + 1
       WHERE lease_name = ? AND owner_id = ? AND fencing_epoch = ? AND revision = ? AND lease_until_ms > ?
    `).run(nowMs + ttlMs, leaseName, ownerId, fencingEpoch, expectedRevision, nowMs);
    if (updated.changes !== 1) {
      throw new SqliteStoreError("LEASE_FENCED", "Lease heartbeat is stale, expired or lost.");
    }
    const row = this.database
      .prepare("SELECT * FROM leases WHERE lease_name = ?")
      .get(leaseName) as unknown as LeaseRow;
    return lease(row);
  }
}