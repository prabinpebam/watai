import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreadService } from './threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { AppError } from '../domain/errors';

function makeService() {
  const store = new InMemoryThreadStore();
  let n = 0;
  let t = 0;
  const svc = new ThreadService(store, {
    newId: () => `thr_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  });
  return { store, svc };
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('ThreadService.create', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('creates a thread owned by the caller with defaults', async () => {
    const t = await ctx.svc.create('userA', { title: 'Trip', temporary: false });
    expect(t).toMatchObject({
      id: 'thr_1',
      userId: 'userA',
      title: 'Trip',
      pinned: false,
      archived: false,
      deletedAt: null,
      messageCount: 0,
    });
    expect(t.createdAt).toBe(t.updatedAt);
  });

  it('refuses to persist temporary threads (local-only invariant)', async () => {
    expect(await code(() => ctx.svc.create('userA', { title: 'tmp', temporary: true }))).toBe(
      'validation',
    );
  });

  it('uses a client-supplied id when provided', async () => {
    const t = await ctx.svc.create('userA', { id: 'thr_client', title: 'A', temporary: false });
    expect(t.id).toBe('thr_client');
  });

  it('is idempotent for a repeated client id (no duplicate, returns the original)', async () => {
    const first = await ctx.svc.create('userA', { id: 'thr_dup', title: 'First', temporary: false });
    const again = await ctx.svc.create('userA', { id: 'thr_dup', title: 'Second', temporary: false });
    expect(again).toEqual(first);
    expect(again.title).toBe('First');
    expect((await ctx.svc.list('userA')).length).toBe(1);
  });

  it('returns one stored winner when concurrent creates both observed absence', async () => {
    let release!: () => void;
    const bothRead = new Promise<void>(resolve => { release = resolve; });
    let reads = 0;
    const absent = async () => { reads += 1; if (reads === 2) release(); await bothRead; return null; };
    vi.spyOn(ctx.store, 'get').mockImplementationOnce(absent).mockImplementationOnce(absent);
    const [first, second] = await Promise.all([
      ctx.svc.create('userA', { id: 'shared-id', title: 'First', temporary: false }),
      ctx.svc.create('userA', { id: 'shared-id', title: 'Second', temporary: false }),
    ]);
    expect(first).toEqual(second);
    expect(await ctx.store.get('userA', 'shared-id')).toEqual(first);
  });

  it('does not overwrite a tombstone created after the initial absence observation', async () => {
    const first = await ctx.svc.create('userA', { id: 'same-id', title: 'First', temporary: false });
    await ctx.store.put({ ...first, deletedAt: 'deleted' });
    vi.spyOn(ctx.store, 'get').mockResolvedValueOnce(null);
    const result = await ctx.svc.create('userA', { id: 'same-id', title: 'Replacement', temporary: false });
    expect(result).toMatchObject({ title: 'First', deletedAt: 'deleted' });
  });

  it('fails closed if a concurrent create winner disappeared before readback', async () => {
    vi.spyOn(ctx.store, 'createIfAbsent').mockResolvedValue(null);
    await expect(ctx.svc.create('userA', { id: 'gone', title: 'New', temporary: false })).rejects.toMatchObject({ code: 'conflict' });
    expect(await ctx.store.get('userA', 'gone')).toBeNull();
  });
});

describe('ThreadService.get / list ownership', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('returns the caller’s own thread', async () => {
    const t = await ctx.svc.create('userA', { title: 'A', temporary: false });
    expect((await ctx.svc.get('userA', t.id)).id).toBe(t.id);
  });

  it('throws not_found for a missing thread', async () => {
    expect(await code(() => ctx.svc.get('userA', 'nope'))).toBe('not_found');
  });

  it('lists only the caller’s threads, newest first, excluding archived/deleted', async () => {
    const a1 = await ctx.svc.create('userA', { title: 'A1', temporary: false });
    const a2 = await ctx.svc.create('userA', { title: 'A2', temporary: false });
    await ctx.svc.create('userB', { title: 'B1', temporary: false });
    await ctx.svc.update('userA', a1.id, { archived: true });

    const list = await ctx.svc.list('userA');
    expect(list.map((t) => t.id)).toEqual([a2.id]);

    const withArchived = await ctx.svc.list('userA', { includeArchived: true });
    expect(withArchived.map((t) => t.id).sort()).toEqual([a1.id, a2.id].sort());
  });
});

describe('ThreadService IDOR — cross-user access fails closed', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('user B cannot read, update, or delete user A’s thread', async () => {
    const a = await ctx.svc.create('userA', { title: 'secret', temporary: false });

    expect(await code(() => ctx.svc.get('userB', a.id))).toBe('not_found');
    expect(await code(() => ctx.svc.update('userB', a.id, { title: 'hacked' }))).toBe('not_found');
    expect(await code(() => ctx.svc.softDelete('userB', a.id))).toBe('not_found');

    // A's thread is untouched.
    const still = await ctx.svc.get('userA', a.id);
    expect(still.title).toBe('secret');
    expect(still.deletedAt).toBeNull();
  });

  it('user B’s list never includes user A’s threads', async () => {
    await ctx.svc.create('userA', { title: 'A', temporary: false });
    expect(await ctx.svc.list('userB')).toEqual([]);
  });
});

describe('ThreadService.update / softDelete', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('applies a patch and bumps updatedAt but preserves createdAt', async () => {
    const t = await ctx.svc.create('userA', { title: 'A', temporary: false });
    const updated = await ctx.svc.update('userA', t.id, { pinned: true });
    expect(updated.pinned).toBe(true);
    expect(updated.createdAt).toBe(t.createdAt);
    expect(updated.updatedAt > t.updatedAt).toBe(true);
  });

  it('soft-deletes so the thread is no longer fetchable or listed', async () => {
    const t = await ctx.svc.create('userA', { title: 'A', temporary: false });
    await ctx.svc.softDelete('userA', t.id);
    expect(await code(() => ctx.svc.get('userA', t.id))).toBe('not_found');
    expect(await ctx.svc.list('userA')).toEqual([]);
  });

  it('does not restore a thread deleted before a pending edit commits', async () => {
    const record = await ctx.svc.create('userA', { title: 'Original', temporary: false });
    const write = ctx.store.putIfMatch.bind(ctx.store);
    vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async (next, etag) => {
      await ctx.svc.softDelete('userA', record.id);
      return write(next, etag);
    });
    await expect(ctx.svc.update('userA', record.id, { title: 'Stale edit' })).rejects.toMatchObject({ code: 'not_found' });
    expect((await ctx.store.get('userA', record.id))?.deletedAt).not.toBeNull();
  });

  it('preserves concurrent metadata when a patch retries', async () => {
    const record = await ctx.svc.create('userA', { title: 'Original', temporary: false });
    vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async () => {
      await ctx.store.put({ ...record, title: 'Renamed elsewhere', vectorStoreId: 'server-owned', files: [] });
      return null;
    });
    expect(await ctx.svc.update('userA', record.id, { pinned: true })).toMatchObject({ pinned: true, title: 'Renamed elsewhere', vectorStoreId: 'server-owned', files: [] });
  });

  it('preserves a concurrent edit when deletion retries', async () => {
    const record = await ctx.svc.create('userA', { title: 'Original', temporary: false });
    vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async () => {
      await ctx.store.put({ ...record, title: 'Renamed before deletion' });
      return null;
    });
    await ctx.svc.softDelete('userA', record.id);
    expect(await ctx.store.get('userA', record.id)).toMatchObject({ title: 'Renamed before deletion', deletedAt: expect.any(String) });
  });

  it('returns conflict after three unsuccessful patch writes', async () => {
    const record = await ctx.svc.create('userA', { title: 'Original', temporary: false });
    const write = vi.spyOn(ctx.store, 'putIfMatch').mockResolvedValue(null);
    await expect(ctx.svc.update('userA', record.id, { pinned: true })).rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledTimes(3);
  });

  it('stops retrying a mutation when the record physically disappears', async () => {
    const record = await ctx.svc.create('userA', { title: 'Original', temporary: false });
    const snapshot = await ctx.store.getForUpdate('userA', record.id);
    vi.spyOn(ctx.store, 'getForUpdate').mockResolvedValueOnce(snapshot).mockResolvedValue(null);
    const write = vi.spyOn(ctx.store, 'putIfMatch').mockResolvedValue(null);
    await expect(ctx.svc.update('userA', record.id, { title: 'Replacement' })).rejects.toMatchObject({ code: 'not_found' });
    expect(write).toHaveBeenCalledOnce();
  });
});
