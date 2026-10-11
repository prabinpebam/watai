import type { MemoryRecord } from '../domain/memory';
import type { MemoryIndexJob } from '../domain/memoryIndex';

export interface MemoryIndexStore {
  saveWithIndex(record: MemoryRecord, model: string, expectedRevision?: number): Promise<MemoryRecord | null>;
  listIndexJobs(now: string, limit: number): Promise<MemoryIndexJob[]>;
  getIndexJob(userId: string, id: string): Promise<MemoryIndexJob | null>;
  claimIndexJob(userId: string, id: string, now: string, token: string): Promise<MemoryIndexJob | null>;
  finishIndexJob(job: MemoryIndexJob, state: 'completed' | 'ignored' | 'queued' | 'failed', now: string,
    publication?: { expected: MemoryRecord; record: MemoryRecord }): Promise<boolean>;
}