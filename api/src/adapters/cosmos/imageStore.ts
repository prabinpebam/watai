import type { Container, SqlParameter } from '@azure/cosmos';
import type {
  ImageGenRecord,
  ImageListOptions,
  ImageListResult,
  ImageStore,
} from '../../ports/imageStore';
import { getCosmosDatabase } from './cosmosClient';

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
    } catch (err) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
  }
}
