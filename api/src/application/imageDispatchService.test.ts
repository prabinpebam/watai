import { describe, expect, it, vi } from 'vitest';
import { InMemoryImageStore } from '../adapters/memory/imageStore';
import type { ImageGenRecord } from '../ports/imageStore';
import { ImageDispatchService } from './imageDispatchService';

const clock = { newId: () => 'id', now: () => '2026-01-01T00:00:10Z' };
const image = (overrides: Partial<ImageGenRecord> = {}): ImageGenRecord => ({
  id: 'image-1', userId: 'user-1', batchId: 'batch-1', status: 'queued', prompt: 'x',
  size: '1024x1024', outputFormat: 'png', model: 'image-model', createdAt: '2026-01-01T00:00:00Z',
  updatedAt: '2026-01-01T00:00:00Z', releaseId: 'release-1', executionToken: 'token-1',
  dispatchAttempt: 1, ...overrides,
});

describe('ImageDispatchService', () => {
  it('retries pending accepted images once and records transport acknowledgement', async () => {
    const store = new InMemoryImageStore();
    await store.putQueued(image());
    const start = vi.fn(async () => {});
    const service = new ImageDispatchService(store, { start }, clock);
    await expect(service.reconcile()).resolves.toEqual({ inspected: 1, sent: 1, discarded: 0, failed: 0 });
    await expect(service.reconcile()).resolves.toEqual({ inspected: 0, sent: 0, discarded: 0, failed: 0 });
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('retains transient failures and discards stale fencing without dispatch', async () => {
    const store = new InMemoryImageStore();
    await store.putQueued(image());
    const failed = new ImageDispatchService(store, { start: async () => { throw new Error('queue'); } }, clock);
    await expect(failed.reconcile()).resolves.toMatchObject({ failed: 1 });
    await store.put(image({ executionToken: 'token-new' }));
    const start = vi.fn(async () => {});
    await expect(new ImageDispatchService(store, { start }, clock).reconcile()).resolves.toMatchObject({ discarded: 1 });
    expect(start).not.toHaveBeenCalled();
  });

  it('terminalizes stale generating work as outcome-unknown without provider replay', async () => {
    const store = new InMemoryImageStore();
    await store.put(image({ status: 'generating', updatedAt: '2025-12-31T22:00:00Z' }));
    const start = vi.fn(async () => {});
    await new ImageDispatchService(store, { start }, clock).reconcile();
    expect(start).not.toHaveBeenCalled();
    await expect(store.get('user-1', 'image-1')).resolves.toMatchObject({
      status: 'error', error: { code: 'provider_outcome_unknown' },
    });
  });
});
