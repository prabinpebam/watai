import type { Container, SqlParameter } from '@azure/cosmos';
import type { MessageListOptions, MessageRecord, MessageStore } from '../../ports/messageStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos-backed MessageStore. Container `messages`, partition key /threadId. */
export class CosmosMessageStore implements MessageStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('messages');
  }

  async get(threadId: string, id: string): Promise<MessageRecord | null> {
    try {
      const { resource } = await this.container.item(id, threadId).read<MessageRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async list(threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    const conditions = ['c.threadId = @threadId', 'IS_NULL(c.deletedAt)'];
    const parameters: SqlParameter[] = [{ name: '@threadId', value: threadId }];
    if (opts?.since) {
      conditions.push('c.createdAt > @since');
      parameters.push({ name: '@since', value: opts.since });
    }
    let query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.createdAt ASC`;
    if (opts?.limit !== undefined) {
      query += ' OFFSET 0 LIMIT @limit';
      parameters.push({ name: '@limit', value: opts.limit });
    }
    const { resources } = await this.container.items
      .query<MessageRecord>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    return resources;
  }

  async append(record: MessageRecord): Promise<MessageRecord> {
    await this.container.items.upsert(record);
    return record;
  }
}
