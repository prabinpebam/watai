import type { MessageListOptions, MessageRecord, MessageStore } from '../../ports/messageStore';

/** In-memory MessageStore for unit tests and local dev. */
export class InMemoryMessageStore implements MessageStore {
  private byKey = new Map<string, MessageRecord>();

  private key(userId: string, threadId: string, id: string): string {
    return `${userId}\u0000${threadId}\u0000${id}`;
  }

  async get(userId: string, threadId: string, id: string): Promise<MessageRecord | null> {
    return this.byKey.get(this.key(userId, threadId, id)) ?? null;
  }

  async list(userId: string, threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    const since = opts?.since;
    let rows = [...this.byKey.values()].filter(
      (m) => m.userId === userId && m.threadId === threadId && !m.deletedAt && (!since || m.createdAt >= since),
    );
    rows.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id));
    if (opts?.limit !== undefined) rows = rows.slice(0, opts.limit);
    return rows;
  }

  async append(record: MessageRecord): Promise<MessageRecord> {
    this.byKey.set(this.key(record.userId, record.threadId, record.id), { ...record });
    return record;
  }

  async delete(userId: string, threadId: string, id: string): Promise<void> {
    this.byKey.delete(this.key(userId, threadId, id));
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    for (const [key, m] of [...this.byKey.entries()]) {
      if (m.userId === userId && m.threadId === threadId) this.byKey.delete(key);
    }
  }
}
