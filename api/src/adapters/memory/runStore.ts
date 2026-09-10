import type { RunRecord, RunStore } from '../../ports/runStore';
import { isActive } from '../../domain/run';

/** In-memory RunStore for unit tests and local dev (keyed by owner + threadId + runId). */
export class InMemoryRunStore implements RunStore {
  private byKey = new Map<string, RunRecord>();

  private key(userId: string, threadId: string, runId: string): string {
    return `${userId}\u0000${threadId}\u0000${runId}`;
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord | null> {
    return this.byKey.get(this.key(userId, threadId, runId)) ?? null;
  }

  async put(record: RunRecord): Promise<RunRecord> {
    this.byKey.set(this.key(record.userId, record.threadId, record.id), { ...record });
    return record;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    return [...this.byKey.values()].filter((r) => r.userId === userId && r.threadId === threadId && isActive(r.status));
  }

  async deleteByThread(userId: string, threadId: string): Promise<void> {
    for (const [key, run] of [...this.byKey.entries()]) {
      if (run.userId === userId && run.threadId === threadId) this.byKey.delete(key);
    }
  }
}
