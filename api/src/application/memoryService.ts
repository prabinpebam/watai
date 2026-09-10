import { createHash } from 'node:crypto';
import { AppError } from '../domain/errors';
import {
  parseCreateMemory,
  parseMemoryRecord,
  parseMemorySummaryRecord,
  parsePatchMemory,
  parsePutMemorySummary,
  type CreateMemoryInput,
  type ListMemoryQuery,
  type MemoryImportInput,
  type MemoryRecord,
  type MemorySummaryRecord,
  type PatchMemoryInput,
} from '../domain/memory';
import { buildMemoryProfile, type MemoryProfileView } from '../domain/memoryProfile';
import type { MemoryListPage, MemoryStore } from '../ports/memoryStore';
import type { ServiceClock } from './threadService';

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

function sourceKeys(memory: MemoryRecord): string[] {
  return [...new Set(memory.sourceRefs.map((ref) => `${ref.type}:${ref.threadId ?? ''}:${ref.messageId ?? ''}:${ref.runId ?? ''}`))];
}

export class MemoryService {
  constructor(
    private readonly store: MemoryStore,
    private readonly clock: ServiceClock,
  ) {}

  list(userId: string, query: ListMemoryQuery): Promise<MemoryListPage> {
    return this.store.list(userId, query);
  }

  async profile(userId: string): Promise<MemoryProfileView> {
    const memories: MemoryRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.store.list(userId, { status: 'active', limit: 100, cursor });
      memories.push(...page.memories);
      cursor = page.cursor;
    } while (cursor);
    return buildMemoryProfile(userId, this.clock.now(), memories);
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
      visibility: parsed.visibility ?? 'normal',
      createdAt: ts,
      updatedAt: ts,
      useCount: 0,
    });
    return this.store.put(record);
  }

  async patch(userId: string, memoryId: string, input: PatchMemoryInput): Promise<MemoryRecord> {
    const patch = parsePatchMemory(input);
    const current = await this.store.get(userId, memoryId);
    if (!current) throw new AppError('not_found', 'Memory not found.');
    if (current.status === 'deleted') throw new AppError('conflict', 'Deleted memory cannot be changed.');
    const ts = this.clock.now();
    const nextText = patch.text?.trim();
    const nextKind = patch.kind ?? current.kind;
    const next = parseMemoryRecord({
      ...current,
      ...(nextText !== undefined ? { text: nextText, normalizedText: normalizeText(nextText), embedding: undefined, embeddingModel: undefined } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.salience !== undefined ? { salience: patch.salience } : {}),
      ...(patch.status === 'invalidated' ? { invalidAt: ts } : {}),
      ...(nextText !== undefined || patch.kind !== undefined ? { sourceHash: sourceHash(nextText ?? current.text, nextKind, current.entities) } : {}),
      updatedAt: ts,
    });
    return this.store.put(next);
  }

  async delete(userId: string, memoryId: string): Promise<MemoryDeleteReceipt> {
    const current = await this.store.get(userId, memoryId);
    if (!current) throw new AppError('not_found', 'Memory not found.');
    if (current.status !== 'deleted') {
      const ts = this.clock.now();
      const deleted = parseMemoryRecord({ ...current, status: 'deleted', deletedAt: ts, updatedAt: ts });
      await this.store.exclude(deleted, {
        id: `memory-exclusion-${current.id}`,
        userId,
        memoryId: current.id,
        ...(current.sourceHash ? { sourceHash: current.sourceHash } : {}),
        sourceKeys: sourceKeys(current),
        excludedAt: ts,
      });
    }
    return {
      memoryId,
      servingExcluded: true,
      purgeState: 'logical_exclusion_complete',
      retained: ['exclusion_receipt', 'deleted_tombstone', 'source_conversation', 'provider_or_backup_copies'],
    };
  }

  getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    return this.store.getSummary(userId);
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

  async export(userId: string): Promise<MemoryExportResponse> {
    const pages: MemoryRecord[] = [];
    let cursor: string | undefined;
    do {
      const page = await this.store.list(userId, { limit: 100, cursor, status: 'active' });
      pages.push(...page.memories);
      cursor = page.cursor;
    } while (cursor);
    return { exportedAt: this.clock.now(), version: 1, memories: pages, summary: await this.store.getSummary(userId) };
  }

  async import(userId: string, input: MemoryImportInput): Promise<MemoryImportResponse> {
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
        else {
          await this.store.put(memory);
          added++;
        }
      }
      return { added, skipped, rejected };
    }
    return { added: 0, skipped: 0, rejected, preview };
  }
}