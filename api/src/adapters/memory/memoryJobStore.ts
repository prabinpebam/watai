import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import type { MemoryJobStore } from '../../ports/memoryJobStore';

function key(userId: string, id: string): string {
  return `${userId}\u0000${id}`;
}

export class InMemoryMemoryJobStore implements MemoryJobStore {
  private readonly byKey = new Map<string, MemoryExtractionJobRecord>();

  async get(userId: string, id: string): Promise<MemoryExtractionJobRecord | null> {
    const record = this.byKey.get(key(userId, id));
    return record ? { ...record } : null;
  }

  async getByDedupeKey(userId: string, dedupeKey: string): Promise<MemoryExtractionJobRecord | null> {
    const record = [...this.byKey.values()].find((item) => item.userId === userId && item.dedupeKey === dedupeKey);
    return record ? { ...record } : null;
  }

  async put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord> {
    this.byKey.set(key(record.userId, record.id), { ...record });
    return record;
  }
}