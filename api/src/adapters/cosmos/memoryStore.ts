import type { Container, OperationInput, SqlQuerySpec } from '@azure/cosmos';
import { isDeepStrictEqual } from 'node:util';
import { memorySourceKeys, prepareMemorySupersession, type MemoryRecord, type MemorySummaryRecord } from '../../domain/memory';
import { archivedMemoryExclusion, memoryExclusionBatch, MemoryPublicationUnconfirmedError, type MemoryExclusion, type MemoryExclusionCandidate, type MemoryListPage, type MemoryStore, type MemoryStoreListOptions } from '../../ports/memoryStore';
import { getCosmosDatabase } from './cosmosClient';
import { claimMemoryIndexJob, memoryIndexJob, parseMemoryIndexJob, validMemoryIndexPublication, type MemoryIndexJob } from '../../domain/memoryIndex';
import type { MemoryIndexStore } from '../../ports/memoryIndexStore';

/** Cosmos adds system metadata (_rid, _self, _etag, _attachments, _ts) to every item. Strip it so
 *  the domain layer — including strict re-validation on update/delete — sees a clean record. */
function strip<T>(resource: T): T {
  if (!resource || typeof resource !== 'object') return resource;
  const clean = { ...(resource as Record<string, unknown>) };
  for (const key of ['_rid', '_self', '_etag', '_attachments', '_ts']) delete clean[key];
  return clean as T;
}

/** Cosmos-backed memory store. Container `memory`, partition key /userId. */
export class CosmosMemoryStore implements MemoryStore, MemoryIndexStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('memory');
  }

  async saveWithIndex(record: MemoryRecord, model: string, expectedRevision?: number): Promise<MemoryRecord | null> {
    const job = memoryIndexJob(record, model);
    const operations: OperationInput[] = [{ operationType: 'Create', resourceBody: record }, { operationType: 'Create', resourceBody: { ...job } }];
    try {
      if (expectedRevision !== undefined) {
        const { resource } = await this.container.item(record.id, record.userId).read<MemoryRecord & { _etag?: string; recordType?: string }>();
        if (!resource || resource.recordType || resource.id !== record.id || resource.userId !== record.userId || resource.status === 'deleted' ||
            (resource.revision ?? 1) !== expectedRevision || typeof resource._etag !== 'string' || !resource._etag.trim()) return null;
        operations[0] = { operationType: 'Replace', id: record.id, resourceBody: record, ifMatch: resource._etag };
      }
      const { result } = await this.container.items.batch(operations, record.userId);
      if (result?.some(receipt => [404, 409, 412].includes(receipt.statusCode))) return null;
      if (result?.length !== operations.length || !result.every(receipt => receipt.statusCode >= 200 && receipt.statusCode < 300)) {
        throw new Error('Memory index admission was not confirmed.');
      }
      return record;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      throw error;
    }
  }

  async listIndexJobs(now: string, limit: number): Promise<MemoryIndexJob[]> {
    const boundedLimit = Math.max(1, Math.min(10, limit));
    const page = await this.container.items.query<MemoryIndexJob>({
      query: 'SELECT TOP @limit * FROM c WHERE c.recordType = @recordType AND (c.state = "queued" OR c.state = "running") AND c.availableAt <= @now ORDER BY c.availableAt ASC',
      parameters: [{ name: '@limit', value: boundedLimit }, { name: '@recordType', value: 'memory-index-job' }, { name: '@now', value: now }],
    }, { maxItemCount: boundedLimit }).fetchNext();
    const jobs: MemoryIndexJob[] = [];
    let invalid = 0;
    for (const resource of page.resources.slice(0, boundedLimit)) {
      try { jobs.push(parseMemoryIndexJob(strip(resource))); } catch { invalid += 1; }
    }
    if (invalid) console.warn('[memory-index] Invalid job records omitted from page.', { count: invalid });
    return jobs;
  }

  async getIndexJob(userId: string, id: string): Promise<MemoryIndexJob | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<MemoryIndexJob>();
      if (!resource || resource.id !== id || resource.userId !== userId || resource.recordType !== 'memory-index-job') return null;
      return parseMemoryIndexJob(strip(resource));
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async claimIndexJob(userId: string, id: string, now: string, token: string): Promise<MemoryIndexJob | null> {
    try {
      const item = this.container.item(id, userId);
      const { resource } = await item.read<MemoryIndexJob & { _etag?: string }>();
      if (!resource || resource.id !== id || resource.userId !== userId || typeof resource._etag !== 'string' || !resource._etag.trim()) return null;
      const claimed = claimMemoryIndexJob(parseMemoryIndexJob(strip(resource)), now, token);
      if (!claimed) return null;
      await item.replace(claimed, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      return claimed.state === 'running' ? claimed : null;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      throw error;
    }
  }

  async finishIndexJob(job: MemoryIndexJob, state: 'completed' | 'ignored' | 'queued' | 'failed', now: string,
    publication?: { expected: MemoryRecord; record: MemoryRecord }): Promise<boolean> {
    if (job.state !== 'running' || job.availableAt <= now) return false;
    if ((state === 'completed' && publication === undefined) || (publication && state !== 'completed')) return false;
    if (publication && !validMemoryIndexPublication(job, publication.expected, publication.record)) return false;
    try {
      const { resource } = await this.container.item(job.id, job.userId).read<MemoryIndexJob & { _etag?: string }>();
      if (!resource?._etag || !isDeepStrictEqual(strip(resource), job)) return false;
      const operations: OperationInput[] = [{ operationType: 'Replace', id: job.id, ifMatch: resource._etag,
        resourceBody: { ...job, state, availableAt: new Date(Date.parse(now) + 30_000).toISOString() } }];
      if (publication) {
        const { resource: memory } = await this.container.item(job.memoryId, job.userId).read<MemoryRecord & { _etag?: string }>();
        if (!memory?._etag || !isDeepStrictEqual(strip(memory), publication.expected)) return false;
        operations.push({ operationType: 'Replace', id: job.memoryId, ifMatch: memory._etag, resourceBody: publication.record });
      }
      const { result } = await this.container.items.batch(operations, job.userId);
      if (result?.some(receipt => [404, 409, 412].includes(receipt.statusCode))) return false;
      if (result?.length !== operations.length || !result.every(receipt => receipt.statusCode >= 200 && receipt.statusCode < 300)) {
        throw new Error('Memory index completion was not confirmed.');
      }
      return true;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return false;
      throw error;
    }
  }

  async list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage> {
    const conditions = ['c.userId = @userId', 'c.id != @summaryId', 'NOT IS_DEFINED(c.recordType)'];
    const parameters: SqlQuerySpec['parameters'] = [
      { name: '@userId', value: userId },
      { name: '@summaryId', value: 'memory-summary' },
      { name: '@status', value: opts?.status ?? 'active' },
    ];
    conditions.push('c.status = @status');
    if (opts?.pinned) {
      conditions.push('c.pinned = @pinned');
      parameters.push({ name: '@pinned', value: true });
    }
    if (opts?.confirmations) {
      conditions.push('ARRAY_CONTAINS(@confirmations, c.confirmation)');
      parameters.push({ name: '@confirmations', value: opts.confirmations });
    }
    if (opts?.excludeKinds?.length) {
      conditions.push('NOT ARRAY_CONTAINS(@excludeKinds, c.kind)');
      parameters.push({ name: '@excludeKinds', value: opts.excludeKinds });
    }
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
    if (page.resources.some(memory => memory.userId !== userId || 'recordType' in memory)) throw new Error('Memory page owner binding failed.');
    return {
      memories: page.resources.map(strip),
      ...(page.continuationToken ? { cursor: page.continuationToken } : {}),
    };
  }

  async get(userId: string, memoryId: string): Promise<MemoryRecord | null> {
    try {
      const { resource } = await this.container.item(memoryId, userId).read<MemoryRecord & { recordType?: string }>();
      return resource?.id === memoryId && resource.userId === userId && !resource.recordType ? strip(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: MemoryRecord): Promise<MemoryRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async createIfAbsent(record: MemoryRecord, predecessors: MemoryRecord[] = []): Promise<MemoryRecord | null> {
    const replacements = prepareMemorySupersession(record, predecessors);
    if (!replacements) return null;
    try {
      if (predecessors.length) {
        const operations: OperationInput[] = [{ operationType: 'Create', resourceBody: record }];
        for (const [index, previous] of predecessors.entries()) {
          const { resource } = await this.container.item(previous.id, record.userId).read<MemoryRecord & { _etag?: string }>();
          if (!resource?._etag || !isDeepStrictEqual(strip(resource), previous)) return null;
          operations.push({ operationType: 'Replace', id: previous.id, resourceBody: replacements[index], ifMatch: resource._etag });
        }
        const { result } = await this.container.items.batch(operations, record.userId);
        if (result?.some(operation => [404, 409, 412].includes(operation.statusCode))) return null;
        if (result?.length !== operations.length || !result.every(operation => operation.statusCode >= 200 && operation.statusCode < 300)) {
          throw new MemoryPublicationUnconfirmedError();
        }
        return record;
      }
      const { resource } = await this.container.items.create(record);
      return resource ? strip(resource as MemoryRecord) : record;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      if (predecessors.length) throw new MemoryPublicationUnconfirmedError();
      throw error;
    }
  }

  async putIfRevision(record: MemoryRecord, expectedRevision: number): Promise<MemoryRecord | null> {
    const item = this.container.item(record.id, record.userId);
    try {
      const { resource } = await item.read<MemoryRecord & { _etag?: string; recordType?: string }>();
        if (!resource || resource.recordType || resource.id !== record.id || resource.userId !== record.userId || resource.status === 'deleted' ||
          (resource.revision ?? 1) !== expectedRevision || !resource._etag) return null;
      const { resource: replaced } = await item.replace(record, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      return replaced ? strip(replaced as MemoryRecord) : record;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      throw error;
    }
  }

  async exclude(record: MemoryRecord, exclusion: MemoryExclusion, expectedRevision: number, previous?: MemoryExclusion): Promise<boolean> {
    if (exclusion.userId !== record.userId || exclusion.memoryId !== record.id) return false;
    if (previous && (previous.id !== exclusion.id || previous.userId !== exclusion.userId || previous.memoryId !== exclusion.memoryId ||
      previous.excludedAt !== exclusion.excludedAt || !Array.isArray(previous.sourceKeys) || !Array.isArray(exclusion.sourceKeys) ||
      !previous.sourceKeys.every(source => exclusion.sourceKeys.includes(source)))) return false;
    try {
      const { resource } = await this.container.item(record.id, record.userId).read<MemoryRecord & { _etag?: string }>();
        if (!resource || resource.id !== record.id || resource.userId !== record.userId ||
          (resource.status === 'deleted' && record.status !== 'deleted') ||
          (resource.revision ?? 1) !== expectedRevision || !resource._etag) return false;
      const operations: OperationInput[] = [
        { operationType: 'Replace', id: record.id, resourceBody: record, ifMatch: resource._etag },
        { operationType: 'Create', resourceBody: { ...exclusion, recordType: 'memory-exclusion' } },
      ];
      if (previous) {
        const { resource: receipt } = await this.container.item(exclusion.id, record.userId).read<MemoryExclusion & { _etag?: string; recordType?: string }>();
        if (!receipt?._etag || receipt.recordType !== 'memory-exclusion') return false;
        const { recordType: _recordType, ...snapshot } = strip(receipt);
        if (!isDeepStrictEqual(snapshot, previous)) return false;
        operations[1] = { operationType: 'Replace', id: exclusion.id, resourceBody: { ...exclusion, recordType: 'memory-exclusion' }, ifMatch: receipt._etag };
        const archive = previous.sourceHash && previous.sourceHash !== exclusion.sourceHash ? archivedMemoryExclusion(previous) : null;
        if (archive) {
          let existingArchive: (MemoryExclusion & { recordType?: string }) | undefined;
          try {
            existingArchive = (await this.container.item(archive.id, record.userId).read<MemoryExclusion & { recordType?: string }>()).resource;
          } catch (error) {
            if ((error as { code?: number }).code !== 404) throw error;
          }
          if (existingArchive) {
            if (existingArchive.id !== archive.id || existingArchive.userId !== record.userId || existingArchive.memoryId !== record.id ||
                existingArchive.recordType !== 'memory-exclusion' || existingArchive.sourceHash !== archive.sourceHash ||
                !Array.isArray(existingArchive.sourceKeys)) return false;
          } else operations.push({ operationType: 'Create', resourceBody: { ...archive, recordType: 'memory-exclusion' } });
        }
      }
      const { result } = await this.container.items.batch(operations, record.userId);
      if (result?.some(operation => [404, 409, 412].includes(operation.statusCode))) return false;
      if (result?.length !== operations.length || !result.every(operation => operation.statusCode >= 200 && operation.statusCode < 300)) {
        throw new Error('Memory exclusion batch failed.');
      }
      return true;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return false;
      throw error;
    }
  }

  async getExclusion(userId: string, memoryId: string): Promise<MemoryExclusion | null> {
    const id = `memory-exclusion-${memoryId}`;
    try {
      const { resource } = await this.container.item(id, userId).read<MemoryExclusion & { recordType?: string }>();
      if (!resource || resource.id !== id || resource.userId !== userId || resource.memoryId !== memoryId ||
          resource.recordType !== 'memory-exclusion') return null;
          const { recordType: _recordType, ...receipt } = strip(resource);
          return receipt;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async isExcluded(userId: string, sourceHash: string | undefined, sourceRefs: MemoryRecord['sourceRefs'], memoryId?: string): Promise<boolean> {
    const sourceKeys = memorySourceKeys(sourceRefs);
    const matches: string[] = [];
    const parameters: SqlQuerySpec['parameters'] = [
      { name: '@userId', value: userId },
      { name: '@recordType', value: 'memory-exclusion' },
    ];
    if (memoryId) {
      matches.push('c.memoryId = @memoryId');
      parameters.push({ name: '@memoryId', value: memoryId });
    }
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
      return resource?.id === 'memory-summary' && resource.userId === userId && resource.kind === 'summary' ? strip(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async hasExcludedMemories(userId: string, memories: MemoryExclusionCandidate[]): Promise<boolean> {
    const batch = memoryExclusionBatch(userId, memories);
    if (!batch.ids.length) return false;
    const { resources } = await this.container.items.query<{ id: string }>({
      query: 'SELECT TOP 1 c.id FROM c WHERE c.userId = @userId AND c.recordType = @recordType AND (ARRAY_CONTAINS(@ids, c.memoryId) OR ARRAY_CONTAINS(@hashes, c.sourceHash) OR EXISTS(SELECT VALUE sourceKey FROM sourceKey IN c.sourceKeys WHERE ARRAY_CONTAINS(@sourceKeys, sourceKey)))',
      parameters: [
        { name: '@userId', value: userId }, { name: '@recordType', value: 'memory-exclusion' },
        { name: '@ids', value: batch.ids }, { name: '@hashes', value: batch.hashes }, { name: '@sourceKeys', value: batch.sourceKeys },
      ],
    }, { partitionKey: userId }).fetchAll();
    return resources.length > 0;
  }

  async putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord> {
    await this.container.items.upsert(record);
    return record;
  }
}