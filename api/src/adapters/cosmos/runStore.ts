import type { Container, SqlParameter } from '@azure/cosmos';
import type { RunRecord, RunStore } from '../../ports/runStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos-backed RunStore. Container `runs`, partition key /threadId. */
export class CosmosRunStore implements RunStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('runs');
  }

  async get(threadId: string, runId: string): Promise<RunRecord | null> {
    try {
      const { resource } = await this.container.item(runId, threadId).read<RunRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: RunRecord): Promise<RunRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async listActive(threadId: string): Promise<RunRecord[]> {
    const query =
      "SELECT * FROM c WHERE c.threadId = @t AND (c.status = 'queued' OR c.status = 'running')";
    const parameters: SqlParameter[] = [{ name: '@t', value: threadId }];
    const { resources } = await this.container.items
      .query<RunRecord>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    return resources;
  }
}
