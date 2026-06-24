import type { ListOptions, ThreadRecord, ThreadStore } from '../../ports/threadStore';

/**
 * In-memory ThreadStore for unit tests and local dev. Keys include the userId so reads
 * are partition-scoped exactly like Cosmos — cross-user access returns nothing.
 */
export class InMemoryThreadStore implements ThreadStore {
  private byKey = new Map<string, ThreadRecord>();

  private key(userId: string, id: string): string {
    return `${userId}\u0000${id}`;
  }

  async get(userId: string, id: string): Promise<ThreadRecord | null> {
    return this.byKey.get(this.key(userId, id)) ?? null;
  }

  async list(userId: string, opts?: ListOptions): Promise<ThreadRecord[]> {
    const since = opts?.since;
    return [...this.byKey.values()]
      .filter(
        (r) =>
          r.userId === userId &&
          !r.deletedAt &&
          (opts?.includeArchived || !r.archived) &&
          (!since || r.updatedAt > since),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async put(record: ThreadRecord): Promise<ThreadRecord> {
    this.byKey.set(this.key(record.userId, record.id), { ...record });
    return record;
  }
}
