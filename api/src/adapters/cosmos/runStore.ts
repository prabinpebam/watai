import type { Container, SqlParameter } from '@azure/cosmos';
import type { RunRecord, RunStore } from '../../ports/runStore';
import { getCosmosDatabase } from './cosmosClient';
import { ownerScopedDocumentId } from './ownerScopedId';

type RunDocument = Omit<RunRecord, 'id'> & { id: string; runId?: string };

function fromDocument(document: RunDocument): RunRecord {
  const { runId, ...record } = document;
  return { ...record, id: runId ?? document.id };
}

/** Cosmos-backed RunStore. Container `runs`, partition key /threadId. */
export class CosmosRunStore implements RunStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('runs');
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord | null> {
    try {
      const { resource } = await this.container
        .item(ownerScopedDocumentId('run', userId, runId), threadId)
        .read<RunDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    try {
      const { resource } = await this.container.item(runId, threadId).read<RunDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: RunRecord): Promise<RunRecord> {
    const document: RunDocument = {
      ...record,
      id: ownerScopedDocumentId('run', record.userId, record.id),
      runId: record.id,
    };
    await this.container.items.upsert(document);
    return record;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    const query =
      "SELECT * FROM c WHERE c.userId = @u AND c.threadId = @t AND (c.status = 'queued' OR c.status = 'running')";
    const parameters: SqlParameter[] = [{ name: '@u', value: userId }, { name: '@t', value: threadId }];
    const { resources } = await this.container.items
      .query<RunDocument>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    const records = new Map<string, RunRecord>();
    for (const document of resources) {
      const record = fromDocument(document);
      if (!records.has(record.id) || document.runId) records.set(record.id, record);
    }
    return [...records.values()];
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    const { resources } = await this.container.items
      .query<{ id: string }>(
        { query: 'SELECT c.id FROM c WHERE c.userId = @userId AND c.threadId = @threadId', parameters: [{ name: '@userId', value: userId }, { name: '@threadId', value: threadId }] },
        { partitionKey: threadId },
      )
      .fetchAll();
    for (const { id } of resources) {
      await this.container.item(id, threadId).delete().catch(() => {});
    }
  }
}
