import type { MessageListOptions, MessageRecord, MessageStore } from '../../ports/messageStore';

/** In-memory MessageStore for unit tests and local dev. Partition-scoped by threadId. */
export class InMemoryMessageStore implements MessageStore {
  private byKey = new Map<string, MessageRecord>();

  private key(threadId: string, id: string): string {
    return `${threadId}\u0000${id}`;
  }

  async get(threadId: string, id: string): Promise<MessageRecord | null> {
    return this.byKey.get(this.key(threadId, id)) ?? null;
  }

  async list(threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    const since = opts?.since;
    let rows = [...this.byKey.values()].filter(
      (m) => m.threadId === threadId && !m.deletedAt && (!since || m.createdAt > since),
    );
    rows.sort((a, b) => (a.createdAt < b.createdAt ? -1 : a.createdAt > b.createdAt ? 1 : 0));
    if (opts?.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async append(record: MessageRecord): Promise<MessageRecord> {
    this.byKey.set(this.key(record.threadId, record.id), { ...record });
    return record;
  }
}
