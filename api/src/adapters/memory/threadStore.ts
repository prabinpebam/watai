import type { ListOptions, ThreadLockStore, ThreadRecord, ThreadStore } from '../../ports/threadStore';

/**
 * In-memory ThreadStore for unit tests and local dev. Keys include the userId so reads
 * are partition-scoped exactly like Cosmos — cross-user access returns nothing.
 */
export class InMemoryThreadStore implements ThreadStore, ThreadLockStore {
  private byKey = new Map<string, ThreadRecord>();
  /** Per-record version, the in-memory stand-in for the Cosmos `_etag` (compare-and-set). */
  private versions = new Map<string, number>();

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
          (opts?.includeDeleted || !r.deletedAt) &&
          (opts?.includeArchived || !r.archived) &&
          (!since || r.updatedAt > since),
      )
      .sort((a, b) => (a.updatedAt < b.updatedAt ? 1 : -1));
  }

  async put(record: ThreadRecord): Promise<ThreadRecord> {
    const k = this.key(record.userId, record.id);
    this.byKey.set(k, { ...record });
    this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    return record;
  }

  async getForUpdate(
    userId: string,
    id: string,
  ): Promise<{ record: ThreadRecord; etag: string } | null> {
    const k = this.key(userId, id);
    const record = this.byKey.get(k);
    if (!record) return null;
    return { record: { ...record }, etag: String(this.versions.get(k) ?? 0) };
  }

  async putIfMatch(record: ThreadRecord, etag: string): Promise<ThreadRecord | null> {
    const k = this.key(record.userId, record.id);
    if (String(this.versions.get(k) ?? 0) !== etag) return null; // lost the race
    this.byKey.set(k, { ...record });
    this.versions.set(k, (this.versions.get(k) ?? 0) + 1);
    return record;
  }
}
