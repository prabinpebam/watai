import type { Container, OperationInput } from '@azure/cosmos';
import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import type { MemoryJobDispatchRecord, MemoryJobStore } from '../../ports/memoryJobStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos-backed MemoryJobStore. Container `memoryJobs`, partition key /userId. */
export class CosmosMemoryJobStore implements MemoryJobStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('memoryJobs');
  }

  async get(userId: string, id: string): Promise<MemoryExtractionJobRecord | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<MemoryExtractionJobRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async getByDedupeKey(userId: string, dedupeKey: string): Promise<MemoryExtractionJobRecord | null> {
    const { resources } = await this.container.items
      .query<MemoryExtractionJobRecord>(
        {
          query: 'SELECT TOP 1 * FROM c WHERE c.userId = @userId AND c.dedupeKey = @dedupeKey ORDER BY c.createdAt DESC',
          parameters: [
            { name: '@userId', value: userId },
            { name: '@dedupeKey', value: dedupeKey },
          ],
        },
        { partitionKey: userId },
      )
      .fetchAll();
    return resources[0] ?? null;
  }

  async admit(record: MemoryExtractionJobRecord): Promise<{ outcome: 'accepted' | 'replay'; job: MemoryExtractionJobRecord }> {
    const dispatch = {
      id: `memory-dispatch-${record.id}`,
      recordType: 'memory-dispatch',
      jobId: record.id,
      userId: record.userId,
      releaseId: record.releaseId,
      executionToken: record.executionToken,
      attempt: record.dispatchAttempt,
      state: 'pending',
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
    };
    const operations = [record, dispatch]
      .map((resourceBody) => ({ operationType: 'Create' as const, resourceBody })) as unknown as OperationInput[];
    try {
      const { result } = await this.container.items.batch(operations, record.userId);
      if (result?.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) {
        return { outcome: 'accepted', job: record };
      }
      if (!result?.some((operation) => operation.statusCode === 409)) {
        throw new Error(`Memory job admission failed (${result?.map((operation) => operation.statusCode).join(',') ?? 'no-result'}).`);
      }
    } catch (error) {
      if ((error as { code?: number }).code !== 409) throw error;
    }
    const existing = await this.get(record.userId, record.id);
    if (!existing) throw new Error('Memory job admission conflicted without an existing job.');
    return { outcome: 'replay', job: existing };
  }

  async claim(userId: string, id: string, updatedAt: string, fence?: { releaseId: string; executionToken: string; attempt: number }): Promise<MemoryExtractionJobRecord | null> {
    const item = this.container.item(id, userId);
    try {
      const { resource } = await item.read<MemoryExtractionJobRecord & { _etag?: string }>();
      if (!resource || resource.status !== 'queued' || !resource._etag) return null;
      if (fence && (resource.releaseId !== fence.releaseId || resource.executionToken !== fence.executionToken || resource.dispatchAttempt !== fence.attempt)) return null;
      const { _etag, ...current } = resource;
      const claimed = { ...current, status: 'running' as const, attempts: current.attempts + 1, updatedAt };
      try {
        const { resource: replaced } = await item.replace(claimed, { accessCondition: { type: 'IfMatch', condition: _etag } });
        if (!replaced) return claimed;
        const { _etag: _nextEtag, ...clean } = replaced as MemoryExtractionJobRecord & { _etag?: string };
        return clean;
      } catch (error) {
        if ((error as { code?: number }).code === 412) return null;
        throw error;
      }
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async listPendingDispatch(limit = 50): Promise<MemoryJobDispatchRecord[]> {
    const { resources } = await this.container.items.query<Array<MemoryJobDispatchRecord & { id: string; recordType: string }>[number]>({
      query: "SELECT * FROM c WHERE c.recordType = 'memory-dispatch' AND c.state = 'pending' OFFSET 0 LIMIT @limit",
      parameters: [{ name: '@limit', value: limit }],
    }).fetchAll();
    return resources.map(({ id: _id, recordType: _type, ...record }) => record);
  }

  async markDispatchSent(record: MemoryJobDispatchRecord, sentAt: string): Promise<void> {
    const item = this.container.item(`memory-dispatch-${record.jobId}`, record.userId);
    try {
      const { resource } = await item.read<MemoryJobDispatchRecord & { id: string; recordType: string; _etag?: string }>();
      if (!resource || resource.state !== 'pending' || resource.executionToken !== record.executionToken || resource.attempt !== record.attempt) return;
      await item.replace({ ...resource, state: 'sent', updatedAt: sentAt }, resource._etag
        ? { accessCondition: { type: 'IfMatch', condition: resource._etag } }
        : undefined);
    } catch (error) {
      if (![404, 409, 412].includes((error as { code?: number }).code ?? 0)) throw error;
    }
  }

  async put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord> {
    await this.container.items.upsert(record);
    return record;
  }
}