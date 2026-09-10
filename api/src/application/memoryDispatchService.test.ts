import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryJobStore } from '../adapters/memory/memoryJobStore';
import type { MemoryExtractionJobRecord } from '../domain/memoryExtraction';
import { MemoryDispatchService } from './memoryDispatchService';

const clock = { newId: () => 'id', now: () => '2026-01-01T00:01:00Z' };
const job = (overrides: Partial<MemoryExtractionJobRecord> = {}): MemoryExtractionJobRecord => ({
  id: 'job-1', userId: 'user-1', threadId: 'thread-1', kind: 'turn', status: 'queued',
  assistantMessageId: 'assistant-1', dedupeKey: 'turn:assistant-1:revision', sourceRevision: 'a'.repeat(64),
  releaseId: 'release-1', executionToken: 'token-1', dispatchAttempt: 1, attempts: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', ...overrides,
});

describe('MemoryDispatchService', () => {
  it('retries pending jobs once and acknowledges exact transport', async () => {
    const store = new InMemoryMemoryJobStore();
    await store.admit(job());
    const enqueue = vi.fn(async () => {});
    const service = new MemoryDispatchService(store, { enqueue }, clock);
    await expect(service.reconcile()).resolves.toEqual({ inspected: 1, sent: 1, discarded: 0, failed: 0 });
    await expect(service.reconcile()).resolves.toEqual({ inspected: 0, sent: 0, discarded: 0, failed: 0 });
    expect(enqueue).toHaveBeenCalledTimes(1);
  });

  it('retains transient failure and discards stale execution fencing', async () => {
    const store = new InMemoryMemoryJobStore();
    await store.admit(job());
    await expect(new MemoryDispatchService(store, { enqueue: async () => { throw new Error('queue'); } }, clock).reconcile())
      .resolves.toMatchObject({ failed: 1 });
    await store.put(job({ executionToken: 'token-new' }));
    const enqueue = vi.fn(async () => {});
    await expect(new MemoryDispatchService(store, { enqueue }, clock).reconcile()).resolves.toMatchObject({ discarded: 1 });
    expect(enqueue).not.toHaveBeenCalled();
  });
});
