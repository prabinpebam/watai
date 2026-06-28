import type { Container, SqlQuerySpec } from '@azure/cosmos';
import type { MemoryRecord, MemorySummaryRecord } from '../../domain/memory';
import type { MemoryListPage, MemoryStore, MemoryStoreListOptions } from '../../ports/memoryStore';
import { getCosmosDatabase } from './cosmosClient';

function encodeCursor(record: MemoryRecord): string {
  return Buffer.from(JSON.stringify({ updatedAt: record.updatedAt, id: record.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updatedAt?: string; id?: string };
    return parsed.updatedAt && parsed.id ? { updatedAt: parsed.updatedAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

/** Cosmos-backed memory store. Container `memory`, partition key /userId. */
export class CosmosMemoryStore implements MemoryStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('memory');
  }

  async list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage> {
    const conditions = ['c.userId = @userId', 'c.id != @summaryId'];
    const parameters: SqlQuerySpec['parameters'] = [
      { name: '@userId', value: userId },
      { name: '@summaryId', value: 'memory-summary' },
      { name: '@status', value: opts?.status ?? 'active' },
    ];
    conditions.push('c.status = @status');
    if (opts?.kind) {
      conditions.push('c.kind = @kind');
      parameters.push({ name: '@kind', value: opts.kind });
    }
    if (opts?.q?.trim()) {
      const q = opts.q.trim().toLowerCase();
      conditions.push('(CONTAINS(LOWER(c.text), @q) OR CONTAINS(LOWER(c.summary), @q) OR ARRAY_CONTAINS(c.entities, @q, true) OR ARRAY_CONTAINS(c.topics, @q, true))');
      parameters.push({ name: '@q', value: q });
    }
    const cursor = decodeCursor(opts?.cursor);
    if (cursor) {
      conditions.push('(c.updatedAt < @cursorUpdatedAt OR (c.updatedAt = @cursorUpdatedAt AND c.id < @cursorId))');
      parameters.push({ name: '@cursorUpdatedAt', value: cursor.updatedAt }, { name: '@cursorId', value: cursor.id });
    }
    const limit = opts?.limit ?? 50;
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.updatedAt DESC, c.id DESC OFFSET 0 LIMIT ${limit + 1}`;
    const { resources } = await this.container.items
      .query<MemoryRecord>({ query, parameters }, { partitionKey: userId })
      .fetchAll();
    const page = resources.slice(0, limit);
    return {
      memories: page,
      ...(resources.length > limit && page.length ? { cursor: encodeCursor(page[page.length - 1]) } : {}),
    };
  }

  async get(userId: string, memoryId: string): Promise<MemoryRecord | null> {
    try {
      const { resource } = await this.container.item(memoryId, userId).read<MemoryRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: MemoryRecord): Promise<MemoryRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    try {
      const { resource } = await this.container.item('memory-summary', userId).read<MemorySummaryRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord> {
    await this.container.items.upsert(record);
    return record;
  }
}