import { describe, expect, it, vi } from 'vitest';
import { CosmosImageStore } from './imageStore';
import { InMemoryImageStore } from '../memory/imageStore';
import type { ImageGenRecord } from '../../ports/imageStore';

const record: ImageGenRecord = {
  id: 'image', userId: 'owner', batchId: 'batch', status: 'generating', prompt: 'A landscape',
  size: '1024x1024', outputFormat: 'png', model: 'test-image', createdAt: '2026', updatedAt: '2026',
  releaseId: 'release', executionToken: 'execution', dispatchAttempt: 1,
};

describe('ImageStore execution fencing', () => {
  it('rejects a stale recovery timestamp even when execution identity still matches', async () => {
    const replace = vi.fn();
    const store = new CosmosImageStore({ item: () => ({ read: async () => ({ resource: { ...record, updatedAt: 'fresh-heartbeat', _etag: 'fresh-etag' } }), replace }) } as never);
    expect(await store.transition('owner', 'image', ['generating'], { status: 'error' }, { ...record, expectedUpdatedAt: record.updatedAt })).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([[], [201], [201, 424], [201, 201, 201], undefined].map(statuses => ({ statuses })))('rejects incomplete image admission receipts: %j', async ({ statuses }) => {
    const batch = vi.fn().mockResolvedValue({ result: statuses?.map(statusCode => ({ statusCode })) });
    const store = new CosmosImageStore({ items: { batch } } as never);
    await expect(store.putQueued({ ...record, status: 'queued' })).rejects.toThrow('Image admission batch failed');
  });

  it('accepts only the complete atomic job and dispatch admission', async () => {
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 201 }, { statusCode: 201 }] });
    const store = new CosmosImageStore({ items: { batch } } as never);
    expect(await store.putQueued({ ...record, status: 'queued' })).toMatchObject({ id: 'image', status: 'queued' });
    expect(batch.mock.calls[0][0]).toHaveLength(2);
    expect(batch.mock.calls[0][0].map((operation: { operationType: string }) => operation.operationType)).toEqual(['Create', 'Create']);
  });

  it('rejects missing dispatch identity before changing in-memory admission state', async () => {
    const store = new InMemoryImageStore();
    await expect(store.putQueued({ ...record, status: 'queued', executionToken: undefined })).rejects.toThrow('dispatch fencing metadata');
    expect(await store.get('owner', 'image')).toBeNull();
    expect(await store.listPendingDispatch()).toEqual([]);
  });

  it.each([
    { releaseId: 'replacement' },
    { executionToken: 'replacement' },
    { dispatchAttempt: 2 },
    { releaseId: undefined, executionToken: undefined, dispatchAttempt: undefined },
  ])('rejects a different execution tuple without writing: %j', async replacement => {
    const current = { ...record, ...replacement };
    const replace = vi.fn();
    const cosmos = new CosmosImageStore({ item: () => ({ read: async () => ({ resource: { ...current, _etag: 'current-etag' } }), replace }) } as never);
    const memory = new InMemoryImageStore();
    await memory.put(current);
    for (const store of [cosmos, memory]) {
      expect(await store.transition('owner', 'image', ['generating'], { status: 'ready' }, record)).toBeNull();
    }
    expect(replace).not.toHaveBeenCalled();
    expect(await memory.get('owner', 'image')).toEqual(current);
  });

  it('conditionally replaces the matching execution using its current ETag', async () => {
    const replace = vi.fn(async (updated: ImageGenRecord) => ({ resource: updated }));
    const cosmos = new CosmosImageStore({ item: () => ({ read: async () => ({ resource: { ...record, _etag: 'current-etag' } }), replace }) } as never);
    expect(await cosmos.transition('owner', 'image', ['generating'], { status: 'ready' }, record)).toMatchObject({ status: 'ready', executionToken: 'execution' });
    expect(replace).toHaveBeenCalledWith(expect.objectContaining({ status: 'ready' }), { accessCondition: { type: 'IfMatch', condition: 'current-etag' } });
  });

  it('does not report a concurrent winner as its own successful transition', async () => {
    const read = vi.fn().mockResolvedValue({ resource: { ...record, _etag: 'old-etag' } });
    const replace = vi.fn(async () => {
      read.mockResolvedValue({ resource: { ...record, status: 'ready', executionToken: 'replacement', _etag: 'new-etag' } });
      throw { code: 412 };
    });
    const cosmos = new CosmosImageStore({ item: () => ({ read, replace }) } as never);
    expect(await cosmos.transition('owner', 'image', ['generating'], { status: 'ready' }, record)).toBeNull();
    expect(read).toHaveBeenCalledOnce();
    expect(replace).toHaveBeenCalledOnce();
  });

  it('rejects an already-claimed status while preserving unfenced compatibility', async () => {
    const memory = new InMemoryImageStore();
    await memory.put(record);
    expect(await memory.transition('owner', 'image', ['queued'], { status: 'generating' }, record)).toBeNull();
    expect(await memory.transition('owner', 'image', ['queued'], { status: 'generating' })).toEqual(record);
  });

  it('accepts a matching legacy execution without accepting a newly fenced replacement', async () => {
    const memory = new InMemoryImageStore();
    const legacy = { ...record, releaseId: undefined, executionToken: undefined, dispatchAttempt: undefined };
    await memory.put(legacy);
    expect(await memory.transition('owner', 'image', ['generating'], { status: 'ready' }, {})).toMatchObject({ status: 'ready' });
    await memory.put(record);
    expect(await memory.transition('owner', 'image', ['generating'], { status: 'ready' }, {})).toBeNull();
  });
});