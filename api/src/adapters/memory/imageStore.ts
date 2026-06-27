import type {
  ImageGenRecord,
  ImageListOptions,
  ImageListResult,
  ImageStore,
} from '../../ports/imageStore';

/** In-memory ImageStore for unit tests and local dev (keyed by userId + id). */
export class InMemoryImageStore implements ImageStore {
  private byKey = new Map<string, ImageGenRecord>();

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
  }
}
