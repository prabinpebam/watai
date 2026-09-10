import type { Container, OperationInput, SqlQuerySpec } from '@azure/cosmos';
import type { MemoryRecord, MemorySummaryRecord } from '../../domain/memory';
import type { MemoryExclusion, MemoryListPage, MemoryStore, MemoryStoreListOptions } from '../../ports/memoryStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos adds system metadata (_rid, _self, _etag, _attachments, _ts) to every item. Strip it so
 *  the domain layer — including strict re-validation on update/delete — sees a clean record. */
function strip<T>(resource: T): T {
  if (!resource || typeof resource !== 'object') return resource;
  const clean = { ...(resource as Record<string, unknown>) };
  for (const key of ['_rid', '_self', '_etag', '_attachments', '_ts']) delete clean[key];
  return clean as T;
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
    const limit = opts?.limit ?? 50;
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.updatedAt DESC`;
    const page = await this.container.items
      .query<MemoryRecord>({ query, parameters }, {
        partitionKey: userId,
        maxItemCount: limit,
        continuationToken: opts?.cursor,
      })
      .fetchNext();
    return {
      memories: page.resources.map(strip),
      ...(page.continuationToken ? { cursor: page.continuationToken } : {}),
    };
  }

  async get(userId: string, memoryId: string): Promise<MemoryRecord | null> {
    try {
      const { resource } = await this.container.item(memoryId, userId).read<MemoryRecord>();
      return resource ? strip(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: MemoryRecord): Promise<MemoryRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async exclude(record: MemoryRecord, exclusion: MemoryExclusion): Promise<void> {
    const exclusionDocument = { ...exclusion, recordType: 'memory-exclusion' };
    const operations = [record, exclusionDocument]
      .map((resourceBody) => ({ operationType: 'Upsert' as const, resourceBody })) as unknown as OperationInput[];
    const { result } = await this.container.items.batch(operations, record.userId);
    if (!result || !result.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) {
      throw new Error(`Memory exclusion batch failed (${result?.map((operation) => operation.statusCode).join(',') ?? 'no-result'}).`);
    }
  }

  async isExcluded(userId: string, sourceHash: string | undefined, sourceRefs: MemoryRecord['sourceRefs']): Promise<boolean> {
    const sourceKeys = [...new Set(sourceRefs.map((ref) => `${ref.type}:${ref.threadId ?? ''}:${ref.messageId ?? ''}:${ref.runId ?? ''}`))];
    const matches: string[] = [];
    const parameters: SqlQuerySpec['parameters'] = [
      { name: '@userId', value: userId },
      { name: '@recordType', value: 'memory-exclusion' },
    ];
    if (sourceHash) {
      matches.push('c.sourceHash = @sourceHash');
      parameters.push({ name: '@sourceHash', value: sourceHash });
    }
    sourceKeys.forEach((sourceKey, index) => {
      const name = `@sourceKey${index}`;
      matches.push(`ARRAY_CONTAINS(c.sourceKeys, ${name})`);
      parameters.push({ name, value: sourceKey });
    });
    if (!matches.length) return false;
    const { resources } = await this.container.items.query<{ id: string }>({
      query: `SELECT TOP 1 c.id FROM c WHERE c.userId = @userId AND c.recordType = @recordType AND (${matches.join(' OR ')})`,
      parameters,
    }, { partitionKey: userId }).fetchAll();
    return resources.length > 0;
  }

  async getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    try {
      const { resource } = await this.container.item('memory-summary', userId).read<MemorySummaryRecord>();
      return resource ? strip(resource) : null;
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