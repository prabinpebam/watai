import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadService } from './threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';

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

describe('ThreadService.listChanges (delta pull)', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('includes archived and soft-deleted tombstones (unlike list)', async () => {
    const a1 = await ctx.svc.create('userA', { title: 'A1', temporary: false });
    const a2 = await ctx.svc.create('userA', { title: 'A2', temporary: false });
    await ctx.svc.update('userA', a2.id, { archived: true });
    await ctx.svc.softDelete('userA', a1.id);

    const changes = await ctx.svc.listChanges('userA');
    const ids = changes.map((t) => t.id).sort();
    expect(ids).toEqual([a1.id, a2.id].sort());

    const deletedTombstone = changes.find((t) => t.id === a1.id)!;
    expect(deletedTombstone.deletedAt).not.toBeNull();
    const archived = changes.find((t) => t.id === a2.id)!;
    expect(archived.archived).toBe(true);

    // The normal list still hides both.
    expect(await ctx.svc.list('userA')).toEqual([]);
  });

  it('replays the cursor boundary and returns later changes', async () => {
    const a1 = await ctx.svc.create('userA', { title: 'A1', temporary: false });
    const cursor = a1.updatedAt;
    const a2 = await ctx.svc.create('userA', { title: 'A2', temporary: false });

    const delta = await ctx.svc.listChanges('userA', cursor);
    expect(delta.map((t) => t.id)).toEqual([a2.id, a1.id]);
  });

  it('replays records at the cursor timestamp so delayed equal-time changes converge', async () => {
    await ctx.store.put({
      id: 'same-time-a', userId: 'userA', title: 'A', pinned: false, archived: false, temporary: false,
      messageCount: 0, createdAt: '2026-01-01T00:00:05Z', updatedAt: '2026-01-01T00:00:05Z', deletedAt: null,
    });
    await ctx.store.put({
      id: 'same-time-b', userId: 'userA', title: 'B', pinned: false, archived: false, temporary: false,
      messageCount: 0, createdAt: '2026-01-01T00:00:05Z', updatedAt: '2026-01-01T00:00:05Z', deletedAt: null,
    });
    expect((await ctx.svc.listChanges('userA', '2026-01-01T00:00:05Z')).map((thread) => thread.id).sort())
      .toEqual(['same-time-a', 'same-time-b']);
  });

  it('rejects a malformed cursor with an explicit full-resync instruction', async () => {
    await expect(ctx.svc.listChanges('userA', 'not-a-time')).rejects.toMatchObject({
      code: 'validation', details: { resyncRequired: true },
    });
  });

  it('never leaks another user’s changes (IDOR)', async () => {
    await ctx.svc.create('userA', { title: 'A', temporary: false });
    expect(await ctx.svc.listChanges('userB')).toEqual([]);
  });
});
