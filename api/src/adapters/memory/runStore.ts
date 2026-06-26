import type { RunRecord, RunStore } from '../../ports/runStore';
import { isActive } from '../../domain/run';

/** In-memory RunStore for unit tests and local dev (keyed by threadId + runId). */
export class InMemoryRunStore implements RunStore {
  private byKey = new Map<string, RunRecord>();

  private key(threadId: string, runId: string): string {
    return `${threadId}\u0000${runId}`;
  }

  async get(threadId: string, runId: string): Promise<RunRecord | null> {
    return this.byKey.get(this.key(threadId, runId)) ?? null;
  }

  async put(record: RunRecord): Promise<RunRecord> {
    this.byKey.set(this.key(record.threadId, record.id), { ...record });
    return record;
  }

  async listActive(threadId: string): Promise<RunRecord[]> {
    return [...this.byKey.values()].filter((r) => r.threadId === threadId && isActive(r.status));
  }
}
