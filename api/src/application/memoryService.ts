import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { AppError } from '../domain/errors';
import {
  memorySourceKeys,
  parseCreateMemory,
  parseMemoryRecord,
  parseMemorySummaryRecord,
  parsePatchMemory,
  parsePutMemorySummary,
  parseMemoryTransferArchive,
  type CreateMemoryInput,
  type ListMemoryQuery,
  type MemoryImportInput,
  type MemoryRecord,
  type MemorySummaryRecord,
  type MemoryTransferArchive,
  type PatchMemoryInput,
} from '../domain/memory';
import { buildMemoryProfile, type MemoryProfileView } from '../domain/memoryProfile';
import type { MemoryListPage, MemoryStore } from '../ports/memoryStore';
import type { ServiceClock } from './threadService';
import type { MemoryIndexStore } from '../ports/memoryIndexStore';

export interface MemoryExportResponse {
  exportedAt: string;
  version: 1;
  memories: MemoryRecord[];
  summary: MemorySummaryRecord | null;
}

export interface MemoryImportResponse {
  added: number;
  skipped: number;
  rejected: Array<{ text: string; reason: string }>;
  preview?: MemoryRecord[];
  archive?: MemoryTransferArchive;
}

export interface MemoryDeleteReceipt {
  memoryId: string;
  servingExcluded: true;
  purgeState: 'logical_exclusion_complete';
  retained: Array<'exclusion_receipt' | 'deleted_tombstone' | 'source_conversation' | 'provider_or_backup_copies'>;
}

function normalizeText(text: string): string {
  return text.trim().replace(/\s+/g, ' ').toLowerCase();
}

function sourceHash(text: string, kind: string, entities: string[] = []): string {
  return createHash('sha256').update(`${normalizeText(text)}\n${kind}\n${[...entities].sort().join('|')}`).digest('hex');
}

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly clock: ServiceClock,
    private readonly indexing?: { store: MemoryIndexStore; model: string },
  ) {}

  list(userId: string, query: ListMemoryQuery): Promise<MemoryListPage> {
    return this.store.list(userId, query);
  }

  async profile(userId: string): Promise<MemoryProfileView> {
    const memories = await this.activeInventory(userId);
    return buildMemoryProfile(userId, this.clock.now(), memories.filter(memory => memory.confirmation === 'approved'));
  }

  private async activeInventory(userId: string, maximumRecords?: number): Promise<MemoryRecord[]> {
    const memories = new Map<string, MemoryRecord>();
    const observedCursors = new Set<string>();
    let cursor: string | undefined;
    do {
      const page = await this.store.list(userId, { status: 'active', limit: 100, cursor });
      for (const memory of page.memories) {
        const previous = memories.get(memory.id);
        if (memory.userId !== userId || memory.status !== 'active' || (previous && !isDeepStrictEqual(previous, memory))) {
          throw new AppError('conflict', 'Memory inventory changed during collection. Retry from the current state.');
        }
        if (!previous) memories.set(memory.id, structuredClone(memory));
        if (maximumRecords !== undefined && memories.size > maximumRecords) {
          throw new AppError('validation', 'Memory archive exceeds the 1000-record limit.');
        }
      }
      cursor = page.cursor;
      if (cursor) {
        if (observedCursors.has(cursor)) throw new AppError('internal', 'Memory inventory pagination did not advance.');
        observedCursors.add(cursor);
      }
    } while (cursor);
    const collected = [...memories.values()];
    for (let offset = 0; offset < collected.length; offset += 100) {
      if (await this.store.hasExcludedMemories(userId, collected.slice(offset, offset + 100))) {
        throw new AppError('conflict', 'Memory inventory contains excluded records. Retry from the current state.');
      }
    }
    return collected;
  }

  async createManual(userId: string, input: CreateMemoryInput): Promise<MemoryRecord> {
    const parsed = parseCreateMemory(input);
    const ts = this.clock.now();
    const text = parsed.text.trim();
    const sourceRef = parsed.sourceRef ?? { type: 'manual' as const, createdAt: ts };
    const record = parseMemoryRecord({
      id: this.clock.newId(),
      userId,
      kind: parsed.kind ?? 'fact',
      status: 'active',
      text,
      normalizedText: normalizeText(text),
      sourceRefs: [{ ...sourceRef, createdAt: sourceRef.createdAt || ts }],
      confidence: 1,
      salience: 0.7,
      pinned: parsed.pinned ?? false,
      sensitive: false,
      sourceHash: sourceHash(text, parsed.kind ?? 'fact'),
      origin: 'manual',
      confirmation: 'approved',
      revision: 1,
      visibility: parsed.visibility ?? 'normal',
      createdAt: ts,
      updatedAt: ts,
      useCount: 0,
    });
    if (await this.store.isExcluded(userId, record.sourceHash, record.sourceRefs)) {
      throw new AppError('conflict', 'This memory matches a prior exclusion. Explicit reauthorization is not available.');
    }
    const saved = this.indexing ? await this.indexing.store.saveWithIndex(record, this.indexing.model) : await this.store.createIfAbsent(record);
    if (!saved) throw new AppError('conflict', 'Memory identifier already exists. Retry creating the memory.');
    return saved;
  }

  async patch(userId: string, memoryId: string, input: PatchMemoryInput): Promise<MemoryRecord> {
    const patch = parsePatchMemory(input);
    const current = await this.store.get(userId, memoryId);
    if (!current) throw new AppError('not_found', 'Memory not found.');
    if (current.status === 'deleted') throw new AppError('conflict', 'Deleted memory cannot be changed.');
    if ((current.revision ?? 1) !== patch.expectedRevision) throw new AppError('conflict', 'Memory changed. Reload before saving.');
    const ts = this.clock.now();
    const nextText = patch.text?.trim();
    const textChanged = nextText !== undefined && nextText !== current.text;
    const nextKind = patch.kind ?? current.kind;
    const restoring = patch.status === 'active' && current.status === 'invalidated';
    if (patch.status === 'active' && current.supersededBy) throw new AppError('conflict', 'Superseded memory requires a new corrected assertion.');
    if (restoring) {
      const end = Date.parse(current.invalidAt ?? '');
      const start = current.validAt === undefined ? undefined : Date.parse(current.validAt);
      if (!Number.isFinite(end) || !Number.isFinite(Date.parse(ts)) || end > Date.parse(ts) ||
          (start !== undefined && (!Number.isFinite(start) || start > end))) {
        throw new AppError('conflict', 'Memory validity cannot be restored from this record.');
      }
      if ((current.validityHistory?.length ?? 0) >= 16) throw new AppError('conflict', 'Memory validity history is full. Create a new corrected assertion.');
    } else if (patch.status === 'active' && current.invalidAt !== undefined &&
        (!Number.isFinite(Date.parse(current.invalidAt)) || Date.parse(current.invalidAt) <= Date.parse(ts))) {
      throw new AppError('conflict', 'Historical memory requires an explicit invalidated-state restoration.');
    }
    const next = parseMemoryRecord({
      ...current,
      ...(textChanged ? { text: nextText, normalizedText: normalizeText(nextText), embedding: undefined, embeddingModel: undefined, embeddingTextHash: undefined,
        route: undefined, summary: undefined, entities: undefined, topics: undefined } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.salience !== undefined ? { salience: patch.salience } : {}),
      ...(patch.status === 'invalidated' ? { invalidAt: ts } : {}),
      ...(restoring ? { validAt: ts, invalidAt: undefined, validityHistory: [...(current.validityHistory ?? []), {
        ...(current.validAt !== undefined ? { validAt: current.validAt } : {}), invalidAt: current.invalidAt!, revision: current.revision ?? 1,
      }] } : {}),
      ...(textChanged || nextKind !== current.kind ? { sourceHash: sourceHash(nextText ?? current.text, nextKind, textChanged ? [] : current.entities) } : {}),
      origin: 'manual',
      confirmation: 'approved',
      revision: (current.revision ?? 0) + 1,
      updatedAt: ts,
    });
    if (patch.status === 'active' && (await this.store.getExclusion(userId, memoryId) ||
      await this.store.isExcluded(userId, current.sourceHash, current.sourceRefs) ||
        (next.sourceHash !== current.sourceHash && await this.store.isExcluded(userId, next.sourceHash, next.sourceRefs)))) {
      throw new AppError('conflict', 'Excluded memory cannot be restored.');
    }
    if (next.status === 'active' && patch.status !== 'active' &&
        await this.store.isExcluded(userId, next.sourceHash, next.sourceRefs, memoryId)) {
      throw new AppError('conflict', 'This memory matches a prior exclusion. Explicit reauthorization is not available.');
    }
    const saved = this.indexing && next.status === 'active' && !next.sensitive
      ? await this.indexing.store.saveWithIndex(next, this.indexing.model, patch.expectedRevision)
      : await this.store.putIfRevision(next, patch.expectedRevision);
    if (!saved) throw new AppError('conflict', 'Memory changed. Reload before saving.');
    return saved;
  }

  async delete(userId: string, memoryId: string): Promise<MemoryDeleteReceipt> {
    let excluded = false;
    for (let attempt = 0; attempt < 3; attempt++) {
      const current = await this.store.get(userId, memoryId);
      if (!current) throw new AppError('not_found', 'Memory not found.');
      let sourceKeys = memorySourceKeys(current.sourceRefs);
      let excludedHash = current.sourceHash ?? (current.status === 'deleted' ? undefined : sourceHash(current.text, current.kind, current.entities));
      let receiptComplete = false;
      const receipt = await this.store.getExclusion(userId, memoryId);
      if (receipt && (receipt.userId !== userId || receipt.memoryId !== memoryId ||
          !Array.isArray(receipt.sourceKeys) || !receipt.sourceKeys.every(key => typeof key === 'string') ||
          !receipt.excludedAt)) {
        throw new AppError('conflict', 'Existing deletion evidence conflicts with this record.');
      }
      if (current.status === 'deleted') {
        if (!excludedHash && !sourceKeys.length) throw new AppError('conflict', 'Deletion exclusion cannot be verified from this legacy record.');
        receiptComplete = receipt?.userId === userId && receipt.memoryId === memoryId &&
        (!excludedHash || receipt.sourceHash === excludedHash) && Array.isArray(receipt.sourceKeys) &&
          sourceKeys.every(key => receipt.sourceKeys.includes(key));
      }
      if (receipt) {
        sourceKeys = [...new Set([...receipt.sourceKeys, ...sourceKeys])];
        excludedHash ??= receipt.sourceHash;
      }
      const ts = this.clock.now();
      const deleted = parseMemoryRecord({
        id: current.id,
        userId,
        kind: current.kind,
        status: 'deleted',
        text: 'Deleted memory',
        sourceHash: excludedHash,
        sourceRefs: current.sourceRefs.map(ref => ({
          type: ref.type, threadId: ref.threadId, messageId: ref.messageId, runId: ref.runId, createdAt: ref.createdAt,
        })),
        confidence: 0,
        salience: 0,
        pinned: false,
        sensitive: false,
        visibility: 'background',
        useCount: 0,
        revision: (current.revision ?? 1) + 1,
        createdAt: current.createdAt,
        deletedAt: current.deletedAt ?? ts,
        updatedAt: ts,
      });
      if (receiptComplete && isDeepStrictEqual(
        JSON.parse(JSON.stringify(current)),
        JSON.parse(JSON.stringify({ ...deleted, revision: current.revision, updatedAt: current.updatedAt })),
      )) { excluded = true; break; }
      excluded = await this.store.exclude(deleted, {
        id: `memory-exclusion-${current.id}`,
        userId,
        memoryId: current.id,
        sourceHash: excludedHash,
        sourceKeys,
        excludedAt: receipt?.excludedAt ?? ts,
      }, current.revision ?? 1, receipt ?? undefined);
      if (excluded) break;
    }
    if (!excluded) throw new AppError('conflict', 'Memory changed repeatedly. Retry deletion from the current state.');
    return {
      memoryId,
      servingExcluded: true,
      purgeState: 'logical_exclusion_complete',
      retained: ['exclusion_receipt', 'deleted_tombstone', 'source_conversation', 'provider_or_backup_copies'],
    };
  }

  async getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    const summary = await this.store.getSummary(userId);
    if (!summary) return null;
    const parsed = parseMemorySummaryRecord(summary);
    if (parsed.userId !== userId || parsed.id !== 'memory-summary') throw new AppError('conflict', 'Memory summary owner binding failed.');
    const sourceIds = [...new Set(parsed.sourceMemoryIds)];
    for (let offset = 0; offset < sourceIds.length; offset += 100) {
      const sources = sourceIds.slice(offset, offset + 100).map(id => ({ id, userId, sourceRefs: [] }));
      if (await this.store.hasExcludedMemories(userId, sources)) {
        throw new AppError('conflict', 'Memory summary contains excluded sources. Rebuild it from current records.');
      }
    }
    return parsed;
  }

  async putSummary(userId: string, input: string | { text: string }): Promise<MemorySummaryRecord> {
    const { text } = parsePutMemorySummary(typeof input === 'string' ? { text: input } : input);
    const existing = await this.store.getSummary(userId);
    const ts = this.clock.now();
    const record = parseMemorySummaryRecord({
      id: 'memory-summary',
      userId,
      kind: 'summary',
      text,
      sourceMemoryIds: existing?.sourceMemoryIds ?? [],
      updatedAt: ts,
      version: (existing?.version ?? 0) + 1,
    });
    return this.store.putSummary(record);
  }

  async export(userId: string, version: 1 | 2 = 1): Promise<MemoryExportResponse | MemoryTransferArchive> {
    const memories = await this.activeInventory(userId, version === 2 ? 1000 : undefined);
    const result = { exportedAt: this.clock.now(), version, memories, summary: await this.getSummary(userId) };
    return version === 2 ? parseMemoryTransferArchive({ ...result, scope: 'active-records' }) : { ...result, version: 1 };
  }

  async import(userId: string, input: MemoryImportInput): Promise<MemoryImportResponse> {
    if (input.version === 2) {
      if (input.mode !== 'preview') throw new AppError('validation', 'Memory archive activation is not supported.');
      const { mode: _mode, ...payload } = input;
      const archive = parseMemoryTransferArchive(payload);
      const ids = new Set<string>();
      for (const memory of archive.memories) {
        if (memory.userId !== userId || ids.has(memory.id)) throw new AppError('validation', 'Memory archive owner or identity binding failed.');
        ids.add(memory.id);
      }
      if (archive.summary && archive.summary.userId !== userId) throw new AppError('validation', 'Memory archive owner or identity binding failed.');
      for (let offset = 0; offset < archive.memories.length; offset += 100) {
        if (await this.store.hasExcludedMemories(userId, archive.memories.slice(offset, offset + 100))) {
          throw new AppError('conflict', 'Memory archive contains excluded records.');
        }
      }
      const sources = archive.summary?.sourceMemoryIds ?? [];
      for (let offset = 0; offset < sources.length; offset += 100) {
        if (await this.store.hasExcludedMemories(userId, sources.slice(offset, offset + 100).map(id => ({ id, userId, sourceRefs: [] })))) {
          throw new AppError('conflict', 'Memory archive contains excluded summary sources.');
        }
      }
      return { added: 0, skipped: 0, rejected: [], archive };
    }
    const preview: MemoryRecord[] = [];
    const rejected: Array<{ text: string; reason: string }> = [];
    for (const item of input.memories) {
      try {
        const ts = this.clock.now();
        preview.push(
          parseMemoryRecord({
            id: this.clock.newId(),
            userId,
            kind: item.kind,
            status: 'active',
            text: item.text,
            normalizedText: normalizeText(item.text),
            sourceRefs: item.sourceRefs,
            confidence: 1,
            salience: 0.7,
            pinned: item.pinned,
            sensitive: false,
            sourceHash: sourceHash(item.text, item.kind),
            origin: 'imported',
            confirmation: 'unknown',
            revision: 1,
            visibility: item.visibility,
            createdAt: ts,
            updatedAt: ts,
            useCount: 0,
          }),
        );
      } catch {
        rejected.push({ text: item.text, reason: 'validation' });
      }
    }
    if (input.mode === 'commit') {
      let added = 0;
      let skipped = 0;
      for (const memory of preview) {
        if (await this.store.isExcluded(userId, memory.sourceHash, memory.sourceRefs)) skipped++;
        else if (await this.store.createIfAbsent(memory)) added++;
        else skipped++;
      }
      return { added, skipped, rejected };
    }
    return { added: 0, skipped: 0, rejected, preview };
  }
}