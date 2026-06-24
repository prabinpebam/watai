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

  it('returns only changes strictly after the cursor', async () => {
    const a1 = await ctx.svc.create('userA', { title: 'A1', temporary: false });
    const cursor = a1.updatedAt;
    const a2 = await ctx.svc.create('userA', { title: 'A2', temporary: false });

    const delta = await ctx.svc.listChanges('userA', cursor);
    expect(delta.map((t) => t.id)).toEqual([a2.id]);
  });

  it('never leaks another user’s changes (IDOR)', async () => {
    await ctx.svc.create('userA', { title: 'A', temporary: false });
    expect(await ctx.svc.listChanges('userB')).toEqual([]);
  });
});
