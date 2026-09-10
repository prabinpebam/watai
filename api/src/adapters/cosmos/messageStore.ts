import type { Container, SqlParameter } from '@azure/cosmos';
import type { MessageListOptions, MessageRecord, MessageStore } from '../../ports/messageStore';
import { getCosmosDatabase } from './cosmosClient';
import { ownerScopedDocumentId } from './ownerScopedId';

type MessageDocument = Omit<MessageRecord, 'id'> & { id: string; messageId?: string };

function fromDocument(document: MessageDocument): MessageRecord {
  const { messageId, ...record } = document;
  return { ...record, id: messageId ?? document.id };
}

/** Cosmos-backed MessageStore. Container `messages`, partition key /threadId. */
export class CosmosMessageStore implements MessageStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('messages');
  }

  async get(userId: string, threadId: string, id: string): Promise<MessageRecord | null> {
    try {
      const { resource } = await this.container
        .item(ownerScopedDocumentId('message', userId, id), threadId)
        .read<MessageDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    try {
      const { resource } = await this.container.item(id, threadId).read<MessageDocument>();
      return resource?.userId === userId ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async list(userId: string, threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    const conditions = ['c.userId = @userId', 'c.threadId = @threadId', 'IS_NULL(c.deletedAt)'];
    const parameters: SqlParameter[] = [{ name: '@userId', value: userId }, { name: '@threadId', value: threadId }];
    if (opts?.since) {
      conditions.push('c.createdAt > @since');
      parameters.push({ name: '@since', value: opts.since });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.createdAt ASC`;
    const { resources } = await this.container.items
      .query<MessageDocument>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    const records = new Map<string, MessageRecord>();
    for (const document of resources) {
      const record = fromDocument(document);
      if (!records.has(record.id) || document.messageId) records.set(record.id, record);
    }
    const result = [...records.values()];
    return opts?.limit === undefined ? result : result.slice(0, opts.limit);
  }

  async append(record: MessageRecord): Promise<MessageRecord> {
    const document: MessageDocument = {
      ...record,
      id: ownerScopedDocumentId('message', record.userId, record.id),
      messageId: record.id,
    };
    await this.container.items.upsert(document);
    return record;
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
