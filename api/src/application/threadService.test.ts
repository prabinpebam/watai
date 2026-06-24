import { describe, it, expect, beforeEach } from 'vitest';
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
});
