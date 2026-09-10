import type {
  ImageGenRecord,
  ImageDispatchRecord,
  ImageListOptions,
  ImageListResult,
  ImageStore,
} from '../../ports/imageStore';
import type { ImageStatus } from '../../domain/imageGen';

/** In-memory ImageStore for unit tests and local dev (keyed by userId + id). */
export class InMemoryImageStore implements ImageStore {
  private byKey = new Map<string, ImageGenRecord>();
  private dispatches = new Map<string, ImageDispatchRecord>();

  private key(userId: string, id: string): string {
    return `${userId}\u0000${id}`;
  }

  async get(userId: string, id: string): Promise<ImageGenRecord | null> {
    return this.byKey.get(this.key(userId, id)) ?? null;
  }

  async put(record: ImageGenRecord): Promise<ImageGenRecord> {
    this.byKey.set(this.key(record.userId, record.id), { ...record });
    return record;
  }

  async putQueued(record: ImageGenRecord): Promise<ImageGenRecord> {
    await this.put(record);
    if (!record.releaseId || !record.executionToken || !record.dispatchAttempt) throw new Error('Image is missing dispatch fencing metadata.');
    this.dispatches.set(this.key(record.userId, record.id), {
      imageId: record.id, userId: record.userId, releaseId: record.releaseId,
      executionToken: record.executionToken, attempt: record.dispatchAttempt, state: 'pending',
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    });
    return record;
  }

  async transition(userId: string, id: string, expected: ImageStatus[], patch: Partial<ImageGenRecord>): Promise<ImageGenRecord | null> {
    const key = this.key(userId, id);
    const current = this.byKey.get(key);
    if (!current || !expected.includes(current.status)) return current ?? null;
    const updated = { ...current, ...patch, id: current.id, userId: current.userId };
    this.byKey.set(key, updated);
    return updated;
  }

  async listPendingDispatch(limit = 50): Promise<ImageDispatchRecord[]> {
    return [...this.dispatches.values()].filter((record) => record.state === 'pending').slice(0, limit);
  }

  async listStaleActive(before: string, limit = 50): Promise<ImageGenRecord[]> {
    return [...this.byKey.values()]
      .filter((record) => record.status === 'generating' && record.updatedAt < before)
      .slice(0, limit);
  }

  async markDispatchSent(record: ImageDispatchRecord, sentAt: string): Promise<void> {
    const key = this.key(record.userId, record.imageId);
    const current = this.dispatches.get(key);
    if (current?.attempt === record.attempt && current.executionToken === record.executionToken) {
      this.dispatches.set(key, { ...current, state: 'sent', updatedAt: sentAt });
    }
  }

  async list(userId: string, options: ImageListOptions = {}): Promise<ImageListResult> {
    let items = [...this.byKey.values()].filter((r) => r.userId === userId);
    if (options.q?.trim()) {
      const q = options.q.trim().toLowerCase();
      items = items.filter((r) => r.prompt.toLowerCase().includes(q));
    }
    if (options.size) items = items.filter((r) => r.size === options.size);
    items.sort((a, b) =>
      options.sort === 'oldest'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    );
    const limit = Math.min(Math.max(options.limit ?? 30, 1), 100);
    return { items: items.slice(0, limit) };
  }

  async delete(userId: string, id: string): Promise<void> {
    this.byKey.delete(this.key(userId, id));
    this.dispatches.delete(this.key(userId, id));
  }
}
