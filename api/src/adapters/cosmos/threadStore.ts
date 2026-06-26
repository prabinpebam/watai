import type { Container } from '@azure/cosmos';
import type { ListOptions, ThreadLockStore, ThreadRecord, ThreadStore } from '../../ports/threadStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos-backed ThreadStore. Container `threads`, partition key /userId. */
export class CosmosThreadStore implements ThreadStore, ThreadLockStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('threads');
  }

  async get(userId: string, id: string): Promise<ThreadRecord | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<ThreadRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async list(userId: string, opts?: ListOptions): Promise<ThreadRecord[]> {
    const conditions = ['c.userId = @userId'];
    const parameters: { name: string; value: string }[] = [{ name: '@userId', value: userId }];
    if (!opts?.includeDeleted) conditions.push('IS_NULL(c.deletedAt)');
    if (!opts?.includeArchived) conditions.push('c.archived = false');
    if (opts?.since) {
      conditions.push('c.updatedAt > @since');
      parameters.push({ name: '@since', value: opts.since });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.updatedAt DESC`;
    const { resources } = await this.container.items
      .query<ThreadRecord>({ query, parameters }, { partitionKey: userId })
      .fetchAll();
    return resources;
  }

  async put(record: ThreadRecord): Promise<ThreadRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async getForUpdate(
    userId: string,
    id: string,
  ): Promise<{ record: ThreadRecord; etag: string } | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<ThreadRecord & { _etag: string }>();
      if (!resource) return null;
      return { record: resource, etag: resource._etag };
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  /** Conditional write: succeeds only if the stored `_etag` still matches; a 412 (someone
   *  else wrote first) returns null so the caller can re-read and retry. */
  async putIfMatch(record: ThreadRecord, etag: string): Promise<ThreadRecord | null> {
    try {
      await this.container.items.upsert(record, { accessCondition: { type: 'IfMatch', condition: etag } });
      return record;
    } catch (err) {
      if ((err as { code?: number }).code === 412) return null;
      throw err;
    }
  }
}
