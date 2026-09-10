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
  reserveBudget,
  updateReservation,
  type BudgetReservation,
  type BudgetState,
  type ReservationStatus,
} from "./execution.js";

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

  constructor(path: string) {
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