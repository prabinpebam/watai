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
  it('marks only stale running jobs unconfirmed without retrying possible provider effects', async () => {
    const store = new InMemoryMemoryJobStore();
    await store.put(job({ id: 'stale', status: 'running', updatedAt: '2026-01-01T00:29:59Z', acceptedCount: 2 }));
    await store.put(job({ id: 'boundary', status: 'running', updatedAt: '2026-01-01T00:30:00Z' }));
    await store.put(job({ id: 'fresh', status: 'running', updatedAt: '2026-01-01T00:45:00Z' }));
    const enqueue = vi.fn();
    const now = '2026-01-01T01:00:00Z';
    const service = new MemoryDispatchService(store, { enqueue }, { ...clock, now: () => now });
    expect(await service.reconcile()).toMatchObject({ inspected: 1, sent: 0, failed: 0 });
    expect(await store.get('user-1', 'stale')).toMatchObject({ status: 'failed', acceptedCount: 2,
      lastErrorCode: 'provider_outcome_unknown', terminalReason: 'worker_outcome_unconfirmed', completedAt: now });
    expect((await store.get('user-1', 'boundary'))?.status).toBe('running');
    expect((await store.get('user-1', 'fresh'))?.status).toBe('running');
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('preserves a newer completion and continues after an unavailable recovery write', async () => {
    const store = new InMemoryMemoryJobStore();
    for (const id of ['completed', 'unavailable', 'recoverable']) await store.put(job({ id, status: 'running' }));
    const put = store.putIfCurrent.bind(store);
    vi.spyOn(store, 'putIfCurrent').mockImplementation(async (next, expected) => {
      if (next.id === 'completed') await store.put({ ...expected, status: 'completed', acceptedCount: 1 });
      if (next.id === 'unavailable') throw new Error('Write unavailable');
      return put(next, expected);
    });
    const enqueue = vi.fn();
    const service = new MemoryDispatchService(store, { enqueue }, { ...clock, now: () => '2026-01-01T01:00:00Z' });
    expect(await service.reconcile()).toMatchObject({ inspected: 3, failed: 1, sent: 0 });
    expect((await store.get('user-1', 'completed'))?.status).toBe('completed');
    expect((await store.get('user-1', 'unavailable'))?.status).toBe('running');
    expect((await store.get('user-1', 'recoverable'))?.lastErrorCode).toBe('provider_outcome_unknown');
    expect(enqueue).not.toHaveBeenCalled();
  });

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
