import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import type { MemoryJobDispatchRecord, MemoryJobStore } from '../../ports/memoryJobStore';

function key(userId: string, id: string): string {
  return `${userId}\u0000${id}`;
}

export class InMemoryMemoryJobStore implements MemoryJobStore {
  private readonly byKey = new Map<string, MemoryExtractionJobRecord>();
  private readonly dispatches = new Map<string, MemoryJobDispatchRecord>();

  async get(userId: string, id: string): Promise<MemoryExtractionJobRecord | null> {
    const record = this.byKey.get(key(userId, id));
    return record ? { ...record } : null;
  }

  async getByDedupeKey(userId: string, dedupeKey: string): Promise<MemoryExtractionJobRecord | null> {
    const record = [...this.byKey.values()].find((item) => item.userId === userId && item.dedupeKey === dedupeKey);
    return record ? { ...record } : null;
  }

  async admit(record: MemoryExtractionJobRecord): Promise<{ outcome: 'accepted' | 'replay'; job: MemoryExtractionJobRecord }> {
    const existing = await this.getByDedupeKey(record.userId, record.dedupeKey);
    if (existing) return { outcome: 'replay', job: existing };
    this.byKey.set(key(record.userId, record.id), { ...record });
    this.dispatches.set(key(record.userId, record.id), {
      jobId: record.id, userId: record.userId, releaseId: record.releaseId,
      executionToken: record.executionToken, attempt: record.dispatchAttempt, state: 'pending',
      createdAt: record.createdAt, updatedAt: record.updatedAt,
    });
    return { outcome: 'accepted', job: record };
  }

  async claim(userId: string, id: string, updatedAt: string, fence?: { releaseId: string; executionToken: string; attempt: number }): Promise<MemoryExtractionJobRecord | null> {
    const mapKey = key(userId, id);
    const current = this.byKey.get(mapKey);
    if (!current || current.status !== 'queued') return null;
    if (fence && (current.releaseId !== fence.releaseId || current.executionToken !== fence.executionToken || current.dispatchAttempt !== fence.attempt)) return null;
    const claimed = { ...current, status: 'running' as const, attempts: current.attempts + 1, updatedAt };
    this.byKey.set(mapKey, claimed);
    return { ...claimed };
  }

  async listPendingDispatch(limit = 50): Promise<MemoryJobDispatchRecord[]> {
    return [...this.dispatches.values()].filter((record) => record.state === 'pending').slice(0, limit);
  }

  async markDispatchSent(record: MemoryJobDispatchRecord, sentAt: string): Promise<void> {
    const mapKey = key(record.userId, record.jobId);
    const current = this.dispatches.get(mapKey);
    if (current?.executionToken === record.executionToken && current.attempt === record.attempt) {
      this.dispatches.set(mapKey, { ...current, state: 'sent', updatedAt: sentAt });
    }
  }

  async put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord> {
    this.byKey.set(key(record.userId, record.id), { ...record });
    return record;
  }
}