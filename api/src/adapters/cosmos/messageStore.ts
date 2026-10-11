import type { Container, SqlParameter } from '@azure/cosmos';
import type { MessageListOptions, MessageRecord, MessageStore } from '../../ports/messageStore';
import { getCosmosDatabase } from './cosmosClient';
import { ownerScopedDocumentId } from './ownerScopedId';

type MessageDocument = Omit<MessageRecord, 'id'> & { id: string; messageId?: string };
type MessageIdentity = Pick<MessageDocument, 'id' | 'messageId' | 'userId' | 'threadId'>;

function matchesMessageDocument<Document extends MessageIdentity>(document: Document | undefined, userId: string, threadId: string, id: string, documentId: string): document is Document {
  return !!document && document.userId === userId && document.threadId === threadId && document.id === documentId &&
    (document.messageId ?? document.id) === id;
}

function assertMessageBinding(document: MessageIdentity, userId: string, threadId: string): void {
  const id = document.messageId ?? document.id;
  if (typeof id !== 'string' || !id || (document.messageId !== undefined && typeof document.messageId !== 'string')) {
    throw new Error('Message result binding failed.');
  }
  const documentId = document.messageId === undefined ? id : ownerScopedDocumentId('message', userId, id);
  if (!matchesMessageDocument(document, userId, threadId, id, documentId)) throw new Error('Message result binding failed.');
}

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
    const documentId = ownerScopedDocumentId('message', userId, id);
    try {
      const { resource } = await this.container
        .item(documentId, threadId)
        .read<MessageDocument>();
      return matchesMessageDocument(resource, userId, threadId, id, documentId) ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
    try {
      const { resource } = await this.container.item(id, threadId).read<MessageDocument>();
      return matchesMessageDocument(resource, userId, threadId, id, id) ? fromDocument(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async list(userId: string, threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    const conditions = ['c.userId = @userId', 'c.threadId = @threadId', 'IS_NULL(c.deletedAt)'];
    const parameters: SqlParameter[] = [{ name: '@userId', value: userId }, { name: '@threadId', value: threadId }];
    if (opts?.since) {
      conditions.push('c.createdAt >= @since');
      parameters.push({ name: '@since', value: opts.since });
    }
    const query = `SELECT * FROM c WHERE ${conditions.join(' AND ')} ORDER BY c.createdAt ASC, c.id ASC`;
    const { resources } = await this.container.items
      .query<MessageDocument>({ query, parameters }, { partitionKey: threadId })
      .fetchAll();
    const records = new Map<string, MessageRecord>();
    for (const document of resources) {
      assertMessageBinding(document, userId, threadId);
      const record = fromDocument(document);
      if (!records.has(record.id) || document.messageId) records.set(record.id, record);
    }
    const result = [...records.values()];
    return opts?.limit === undefined ? result : result.slice(0, opts.limit);
  }

  async createIfAbsent(record: MessageRecord): Promise<MessageRecord | null> {
    const document: MessageDocument = {
      ...record,
      id: ownerScopedDocumentId('message', record.userId, record.id),
      messageId: record.id,
    };
    try {
      await this.container.items.create(document);
      return record;
    } catch (error) {
      if ((error as { code?: number }).code === 409) return null;
      throw error;
    }
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

  async delete(userId: string, threadId: string, id: string): Promise<void> {
    await this.container.item(ownerScopedDocumentId('message', userId, id), threadId).delete().catch((error) => {
      if ((error as { code?: number }).code !== 404) throw error;
    });
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    const { resources } = await this.container.items
      .query<MessageIdentity>(
        { query: 'SELECT c.id, c.messageId, c.userId, c.threadId FROM c WHERE c.userId = @userId AND c.threadId = @threadId', parameters: [{ name: '@userId', value: userId }, { name: '@threadId', value: threadId }] },
        { partitionKey: threadId },
      )
      .fetchAll();
    for (const resource of resources) assertMessageBinding(resource, userId, threadId);
    for (const { id } of resources) {
      await this.container.item(id, threadId).delete().catch((error) => {
        if ((error as { code?: number }).code !== 404) throw error;
      });
    }
  }
}
