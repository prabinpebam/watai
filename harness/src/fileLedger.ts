import { createHash, randomUUID } from "node:crypto";
import {
  mkdir,
  open,
  readFile,
  rename,
  unlink,
  writeFile,
  type FileHandle,
} from "node:fs/promises";
import { dirname } from "node:path";

import {
  applyEvent,
  HarnessRejection,
  type ApplyResult,
  type CandidateSnapshot,
  type CompiledWorkflow,
  type EventCommand,
  type HarnessAuthorities,
} from "./controller.js";

interface LedgerRecord {
  sequence: number;
  previousHash: string | null;
  snapshot: CandidateSnapshot;
  recordHash: string;
}

interface LedgerDocument {
  formatVersion: "1.0-local-rehearsal";
  releaseEligible: false;
  records: LedgerRecord[];
}

interface LockRecord {
  pid: number;
  createdAt: string;
}

export type LedgerErrorCode =
  | "LEDGER_CORRUPT"
  | "LEDGER_IDENTITY_MISMATCH"
  | "LEDGER_LOCKED";

export class FileLedgerError extends Error {
  constructor(
    readonly code: LedgerErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "FileLedgerError";
  }
}

function canonical(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map((item) => item === undefined ? "null" : canonical(item)).join(",")}]`;
  }
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonical(record[key])}`)
      .join(",")}}`;
  }
  return value === undefined ? "null" : JSON.stringify(value);
}

function hashRecord(record: Omit<LedgerRecord, "recordHash">): string {
  return createHash("sha256").update(canonical(record)).digest("hex");
}

function createRecord(
  snapshot: CandidateSnapshot,
  sequence: number,
  previousHash: string | null,
): LedgerRecord {
  const content = { sequence, previousHash, snapshot };
  return { ...content, recordHash: hashRecord(content) };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isNonemptyString(value: unknown): value is string {
  return typeof value === "string" && value.trim().length > 0;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  return isRecord(value) && Object.values(value).every(isNonemptyString);
}

function isEventReceipt(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.eventId) &&
    isNonemptyString(value.commandFingerprint) &&
    isNonemptyString(value.actor) &&
    isNonemptyString(value.actorIdentity) &&
    isNonemptyString(value.eventType) &&
    isNonemptyString(value.payloadSha256) &&
    Number.isSafeInteger(value.fencingEpoch) &&
    Number(value.fencingEpoch) >= 0 &&
    isNonemptyString(value.sourceSha) &&
    isNonemptyString(value.policySha256) &&
    isNonemptyString(value.from) &&
    isNonemptyString(value.to) &&
    Number.isSafeInteger(value.revision) &&
    Number(value.revision) > 0 &&
    (value.effectId === undefined || isNonemptyString(value.effectId)) &&
    isStringRecord(value.guardEvidence) &&
    (value.permitId === undefined || isNonemptyString(value.permitId))
  );
}

function isEffectIntent(value: unknown): boolean {
  if (!isRecord(value)) return false;
  return (
    isNonemptyString(value.effectId) &&
    isNonemptyString(value.runId) &&
    Number.isSafeInteger(value.epoch) &&
    Number(value.epoch) >= 0 &&
    isNonemptyString(value.kind) &&
    isNonemptyString(value.inputSha256) &&
    isNonemptyString(value.sourceSha) &&
    isNonemptyString(value.policySha256) &&
    isNonemptyString(value.eventId) &&
    (value.permitId === undefined || isNonemptyString(value.permitId)) &&
    isNonemptyString(value.deadline) &&
    Number.isFinite(Date.parse(value.deadline)) &&
    value.status === "pending"
  );
}

function isCandidateSnapshot(value: unknown): value is CandidateSnapshot {
  if (!isRecord(value)) return false;
  if (
    !isNonemptyString(value.runId) ||
    !isNonemptyString(value.state) ||
    !Number.isSafeInteger(value.revision) ||
    Number(value.revision) < 0 ||
    !Number.isSafeInteger(value.fencingEpoch) ||
    Number(value.fencingEpoch) < 0 ||
    !isNonemptyString(value.sourceSha) ||
    !isNonemptyString(value.policySha256) ||
    !Array.isArray(value.events) ||
    !value.events.every(isEventReceipt) ||
    !Array.isArray(value.outbox) ||
    !value.outbox.every(isEffectIntent) ||
    !Array.isArray(value.consumedPermitNonces) ||
    !value.consumedPermitNonces.every(isNonemptyString)
  ) {
    return false;
  }

  const snapshot = value as unknown as CandidateSnapshot;
  const eventIds = snapshot.events.map((event) => event.eventId);
  const effectIds = snapshot.outbox.map((effect) => effect.effectId);
  if (
    snapshot.revision !== snapshot.events.length ||
    new Set(eventIds).size !== eventIds.length ||
    new Set(effectIds).size !== effectIds.length ||
    new Set(snapshot.consumedPermitNonces).size !== snapshot.consumedPermitNonces.length
  ) {
    return false;
  }

  for (let index = 0; index < snapshot.events.length; index += 1) {
    const event = snapshot.events[index];
    if (
      event.revision !== index + 1 ||
      event.fencingEpoch !== snapshot.fencingEpoch ||
      event.sourceSha !== snapshot.sourceSha ||
      event.policySha256 !== snapshot.policySha256 ||
      (index > 0 && event.from !== snapshot.events[index - 1].to)
    ) {
      return false;
    }
  }
  if (snapshot.events.length > 0 && snapshot.state !== snapshot.events[snapshot.events.length - 1].to) {
    return false;
  }
  for (const effect of snapshot.outbox) {
    if (
      effect.runId !== snapshot.runId ||
      effect.epoch !== snapshot.fencingEpoch ||
      effect.sourceSha !== snapshot.sourceSha ||
      effect.policySha256 !== snapshot.policySha256 ||
      !snapshot.events.some((event) => event.effectId === effect.effectId)
    ) {
      return false;
    }
  }
  return true;
}

function parseDocument(text: string): LedgerDocument {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new FileLedgerError("LEDGER_CORRUPT", "Ledger is not valid JSON");
  }

  if (
    !isRecord(value) ||
    value.formatVersion !== "1.0-local-rehearsal" ||
    value.releaseEligible !== false ||
    !Array.isArray(value.records) ||
    value.records.length === 0
  ) {
    throw new FileLedgerError("LEDGER_CORRUPT", "Ledger header or records are invalid");
  }

  let previousHash: string | null = null;
  let previousSnapshot: CandidateSnapshot | undefined;
  for (let index = 0; index < value.records.length; index += 1) {
    const record = value.records[index];
    if (
      !isRecord(record) ||
      record.sequence !== index ||
      record.previousHash !== previousHash ||
      !isCandidateSnapshot(record.snapshot) ||
      typeof record.recordHash !== "string"
    ) {
      throw new FileLedgerError("LEDGER_CORRUPT", `Ledger record ${index} is malformed`);
    }

    const expectedHash = hashRecord({
      sequence: record.sequence as number,
      previousHash: record.previousHash as string | null,
      snapshot: record.snapshot,
    });
    if (record.recordHash !== expectedHash) {
      throw new FileLedgerError("LEDGER_CORRUPT", `Ledger record ${index} hash mismatch`);
    }
    if (record.snapshot.revision !== index) {
      throw new FileLedgerError("LEDGER_CORRUPT", `Ledger revision ${index} is discontinuous`);
    }
    if (previousSnapshot) {
      const identityChanged =
        record.snapshot.runId !== previousSnapshot.runId ||
        record.snapshot.sourceSha !== previousSnapshot.sourceSha ||
        record.snapshot.policySha256 !== previousSnapshot.policySha256 ||
        record.snapshot.fencingEpoch !== previousSnapshot.fencingEpoch;
      const invalidAppend =
        record.snapshot.revision !== previousSnapshot.revision + 1 ||
        record.snapshot.events.length !== previousSnapshot.events.length + 1 ||
        record.snapshot.outbox.length < previousSnapshot.outbox.length ||
        record.snapshot.outbox.length > previousSnapshot.outbox.length + 1 ||
        record.snapshot.consumedPermitNonces.length < previousSnapshot.consumedPermitNonces.length ||
        record.snapshot.consumedPermitNonces.length > previousSnapshot.consumedPermitNonces.length + 1 ||
        canonical(record.snapshot.events.slice(0, -1)) !== canonical(previousSnapshot.events) ||
        canonical(record.snapshot.outbox.slice(0, previousSnapshot.outbox.length)) !== canonical(previousSnapshot.outbox) ||
        canonical(record.snapshot.consumedPermitNonces.slice(0, previousSnapshot.consumedPermitNonces.length)) !== canonical(previousSnapshot.consumedPermitNonces) ||
        record.snapshot.events[record.snapshot.events.length - 1].from !== previousSnapshot.state;
      if (identityChanged || invalidAppend) {
        throw new FileLedgerError(
          "LEDGER_CORRUPT",
          `Ledger record ${index} violates immutable identity or append-only history`,
        );
      }
    }
    previousHash = record.recordHash;
    previousSnapshot = record.snapshot;
  }

  return value as unknown as LedgerDocument;
}

async function atomicWrite(path: string, document: LedgerDocument): Promise<void> {
  const temporary = `${path}.${process.pid}.${randomUUID()}.tmp`;
  let handle: FileHandle | undefined;
  try {
    handle = await open(temporary, "wx", 0o600);
    await handle.writeFile(`${JSON.stringify(document, null, 2)}\n`, "utf8");
    await handle.sync();
    await handle.close();
    handle = undefined;
    await rename(temporary, path);
  } finally {
    await handle?.close().catch(() => undefined);
    await unlink(temporary).catch(() => undefined);
  }
}

export class FileCandidateLedger {
  private readonly lockPath: string;

  private constructor(private readonly path: string) {
    this.lockPath = `${path}.lock`;
  }

  static async open(path: string, initial: CandidateSnapshot): Promise<FileCandidateLedger> {
    if (!isCandidateSnapshot(initial) || initial.revision !== 0 || initial.events.length !== 0) {
      throw new FileLedgerError("LEDGER_CORRUPT", "Initial candidate snapshot is malformed");
    }
    const ledger = new FileCandidateLedger(path);
    await mkdir(dirname(path), { recursive: true });
    await ledger.withLock(async () => {
      try {
        const existing = await ledger.readDocument();
        const current = existing.records[existing.records.length - 1].snapshot;
        if (
          current.runId !== initial.runId ||
          current.sourceSha !== initial.sourceSha ||
          current.policySha256 !== initial.policySha256 ||
          current.fencingEpoch !== initial.fencingEpoch
        ) {
          throw new FileLedgerError(
            "LEDGER_IDENTITY_MISMATCH",
            "Existing ledger does not match the requested candidate identity",
          );
        }
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
        const document: LedgerDocument = {
          formatVersion: "1.0-local-rehearsal",
          releaseEligible: false,
          records: [createRecord(initial, 0, null)],
        };
        await atomicWrite(path, document);
      }
    });
    return ledger;
  }

  async read(): Promise<CandidateSnapshot> {
    const document = await this.readDocument();
    return structuredClone(document.records[document.records.length - 1].snapshot);
  }

  async historyLength(): Promise<number> {
    return (await this.readDocument()).records.length;
  }

  async dispatch(
    workflow: CompiledWorkflow,
    command: EventCommand,
    authorities: HarnessAuthorities,
  ): Promise<ApplyResult> {
    return this.withLock(async () => {
      const document = await this.readDocument();
      const priorRecord = document.records[document.records.length - 1];
      const result = applyEvent(workflow, priorRecord.snapshot, command, authorities);
      if (result.kind !== "replayed") {
        document.records.push(
          createRecord(result.candidate, priorRecord.sequence + 1, priorRecord.recordHash),
        );
        await atomicWrite(this.path, document);
      }
      return {
        ...result,
        candidate: structuredClone(result.candidate),
        receipt: structuredClone(result.receipt),
      };
    });
  }

  private async readDocument(): Promise<LedgerDocument> {
    return parseDocument(await readFile(this.path, "utf8"));
  }

  private async acquireLock(): Promise<FileHandle> {
    try {
      const handle = await open(this.lockPath, "wx", 0o600);
      const lock: LockRecord = { pid: process.pid, createdAt: new Date().toISOString() };
      await handle.writeFile(`${JSON.stringify(lock)}\n`, "utf8");
      await handle.sync();
      return handle;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      let owner = "unknown";
      try {
        const lock = JSON.parse(await readFile(this.lockPath, "utf8")) as LockRecord;
        if (Number.isSafeInteger(lock.pid)) owner = String(lock.pid);
      } catch {}
      throw new FileLedgerError(
        "LEDGER_LOCKED",
        `Ledger lock is held by process ${owner}; automatic lock removal is forbidden`,
      );
    }
  }

  private async withLock<T>(operation: () => Promise<T>): Promise<T> {
    const handle = await this.acquireLock();
    try {
      return await operation();
    } finally {
      await handle.close().catch(() => undefined);
      await unlink(this.lockPath).catch(() => undefined);
    }
  }
}