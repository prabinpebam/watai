import type { Container, OperationInput, SqlParameter } from '@azure/cosmos';
import type {
  ImageGenRecord,
  ImageDispatchRecord,
  ImageListOptions,
  ImageListResult,
  ImageStore,
} from '../../ports/imageStore';
import { getCosmosDatabase } from './cosmosClient';
import type { ImageStatus } from '../../domain/imageGen';

type ImageDocument = ImageGenRecord & { _etag?: string };
type ImageDispatchDocument = ImageDispatchRecord & { id: string; recordType: 'image-dispatch'; _etag?: string };

function dispatchId(imageId: string): string {
  return `dispatch-${imageId}`;
}

/** Cosmos-backed ImageStore. Container `images`, partition key /userId. */
export class CosmosImageStore implements ImageStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('images');
  }

  async get(userId: string, id: string): Promise<ImageGenRecord | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<ImageGenRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: ImageGenRecord): Promise<ImageGenRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async putQueued(record: ImageGenRecord): Promise<ImageGenRecord> {
    if (!record.releaseId || !record.executionToken || !record.dispatchAttempt) throw new Error('Image is missing dispatch fencing metadata.');
    const dispatch: ImageDispatchDocument = {
      id: dispatchId(record.id), recordType: 'image-dispatch', imageId: record.id, userId: record.userId,
      releaseId: record.releaseId, executionToken: record.executionToken, attempt: record.dispatchAttempt,
      state: 'pending', createdAt: record.createdAt, updatedAt: record.updatedAt,
    };
    const operations = [record, dispatch]
      .map((resourceBody) => ({ operationType: 'Create' as const, resourceBody })) as unknown as OperationInput[];
    const { result } = await this.container.items.batch(operations, record.userId);
    if (!result || !result.every((operation) => operation.statusCode >= 200 && operation.statusCode < 300)) {
      throw new Error(`Image admission batch failed (${result?.map((operation) => operation.statusCode).join(',') ?? 'no-result'}).`);
    }
    return record;
  }

  async transition(userId: string, id: string, expected: ImageStatus[], patch: Partial<ImageGenRecord>): Promise<ImageGenRecord | null> {
    const item = this.container.item(id, userId);
    try {
      const { resource } = await item.read<ImageDocument>();
      if (!resource || resource.userId !== userId || !expected.includes(resource.status)) return resource ?? null;
      if (!resource._etag) throw new Error('Image transition requires a Cosmos ETag.');
      const updated = { ...resource, ...patch, id: resource.id, userId: resource.userId };
      try {
        const { resource: replaced } = await item.replace(updated, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
        return (replaced ?? updated) as ImageGenRecord;
      } catch (error) {
        if ((error as { code?: number }).code !== 412) throw error;
        return this.get(userId, id);
      }
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async listPendingDispatch(limit = 50): Promise<ImageDispatchRecord[]> {
    const { resources } = await this.container.items.query<ImageDispatchDocument>({
      query: 'SELECT * FROM c WHERE c.recordType = @type AND c.state = @state OFFSET 0 LIMIT @limit',
      parameters: [
        { name: '@type', value: 'image-dispatch' }, { name: '@state', value: 'pending' }, { name: '@limit', value: limit },
      ],
    }).fetchAll();
    return resources.map(({ id: _id, recordType: _type, _etag: _etag, ...record }) => record);
  }

  async listStaleActive(before: string, limit = 50): Promise<ImageGenRecord[]> {
    const { resources } = await this.container.items.query<ImageGenRecord>({
      query: "SELECT * FROM c WHERE c.status = 'generating' AND c.updatedAt < @before OFFSET 0 LIMIT @limit",
      parameters: [{ name: '@before', value: before }, { name: '@limit', value: limit }],
    }).fetchAll();
    return resources;
  }

  async markDispatchSent(record: ImageDispatchRecord, sentAt: string): Promise<void> {
    const item = this.container.item(dispatchId(record.imageId), record.userId);
    try {
      const { resource } = await item.read<ImageDispatchDocument>();
      if (!resource || resource.state !== 'pending' || resource.executionToken !== record.executionToken || resource.attempt !== record.attempt) return;
      await item.replace({ ...resource, state: 'sent', updatedAt: sentAt }, resource._etag
        ? { accessCondition: { type: 'IfMatch', condition: resource._etag } }
        : undefined);
    } catch (error) {
      if (![404, 409, 412].includes((error as { code?: number }).code ?? 0)) throw error;
    }
  }

  async list(userId: string, options: ImageListOptions = {}): Promise<ImageListResult> {
    const sort = options.sort === 'oldest' ? 'ASC' : 'DESC';
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    const conditions = ['c.userId = @u'];
    const parameters: SqlParameter[] = [{ name: '@u', value: userId }];
    if (options.q?.trim()) {
      conditions.push('CONTAINS(LOWER(c.prompt), @q)');
      parameters.push({ name: '@q', value: options.q.trim().toLowerCase() });
    }
    if (options.size) {
      conditions.push('c.size = @sz');
      parameters.push({ name: '@sz', value: options.size });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.createdAt ${sort}`;
    const iterator = this.container.items.query<ImageGenRecord>(
      { query, parameters },
      { partitionKey: userId, maxItemCount: limit, continuationToken: options.cursor },
    );
    const page = await iterator.fetchNext();
    return {
      items: page.resources,
      ...(page.continuationToken ? { cursor: page.continuationToken } : {}),
    };
  }

  async delete(userId: string, id: string): Promise<void> {
    try {
      await this.container.item(id, userId).delete();
      await this.container.item(dispatchId(id), userId).delete().catch(() => undefined);
    } catch (err) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
  }
}
