import { describe, it, expect, beforeEach } from 'vitest';
import { createThreadsController } from './threadsController';
import { ThreadService } from '../application/threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';

function makeController() {
  const store = new InMemoryThreadStore();
  let n = 0;
  let t = 0;
  const threads = new ThreadService(store, {
    newId: () => `thr_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  });
  return createThreadsController(threads);
}

describe('threadsController', () => {
  let ctrl: ReturnType<typeof makeController>;
  beforeEach(() => (ctrl = makeController()));

  it('POST creates a thread → 201 with the record', async () => {
    const res = await ctrl.create({ claims: { sub: 'userA' }, body: { title: 'Hi' } });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ title: 'Hi', userId: 'userA' });
  });

  it('rejects an unauthenticated request → 401 envelope', async () => {
    const res = await ctrl.list({ claims: {} });
    expect(res.status).toBe(401);
    expect((res.body as any).error.code).toBe('unauthorized');
  });

  it('maps validation failures → 400 envelope', async () => {
    const res = await ctrl.create({ claims: { sub: 'userA' }, body: { title: '' } });
    expect(res.status).toBe(400);
    expect((res.body as any).error.code).toBe('validation');
  });

  it('maps cross-user access → 404 envelope (IDOR fails closed)', async () => {
    const created = await ctrl.create({ claims: { sub: 'userA' }, body: { title: 'secret' } });
    const id = (created.body as any).id;
    const res = await ctrl.get({ claims: { sub: 'userB' }, params: { id } });
    expect(res.status).toBe(404);
    expect((res.body as any).error.code).toBe('not_found');
  });

  it('GET lists the caller’s threads → 200', async () => {
    await ctrl.create({ claims: { sub: 'userA' }, body: { title: 'A' } });
    const res = await ctrl.list({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect((res.body as any).threads).toHaveLength(1);
  });

  it('PATCH updates → 200, DELETE soft-deletes → 204', async () => {
    const created = await ctrl.create({ claims: { sub: 'userA' }, body: { title: 'A' } });
    const id = (created.body as any).id;

    const patched = await ctrl.patch({ claims: { sub: 'userA' }, params: { id }, body: { pinned: true } });
    expect(patched.status).toBe(200);
    expect((patched.body as any).pinned).toBe(true);

    const removed = await ctrl.remove({ claims: { sub: 'userA' }, params: { id } });
    expect(removed.status).toBe(204);
    expect(removed.body).toBeUndefined();
  });

  it('GET with includeDeleted=true returns soft-deleted tombstones (for sync pull)', async () => {
    const created = await ctrl.create({ claims: { sub: 'userA' }, body: { title: 'A' } });
    const id = (created.body as any).id;
    await ctrl.remove({ claims: { sub: 'userA' }, params: { id } });

    const without = await ctrl.list({ claims: { sub: 'userA' } });
    expect((without.body as any).threads).toHaveLength(0);

    const withDeleted = await ctrl.list({ claims: { sub: 'userA' }, query: { includeDeleted: 'true' } });
    const threads = (withDeleted.body as any).threads;
    expect(threads).toHaveLength(1);
    expect(threads[0].id).toBe(id);
    expect(threads[0].deletedAt).not.toBeNull();
  });
});
