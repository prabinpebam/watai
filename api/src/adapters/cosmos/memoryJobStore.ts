import type { Container } from '@azure/cosmos';
import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import type { MemoryJobStore } from '../../ports/memoryJobStore';
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

  async put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord> {
    await this.container.items.upsert(record);
    return record;
  }
}