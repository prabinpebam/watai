import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CosmosThreadStore } from './threadStore';
import { getCosmosDatabase } from './cosmosClient';
import type { ThreadRecord } from '../../ports/threadStore';

// Only runs when pointed at a real Cosmos account (skipped in the normal offline suite).
const RUN = !!process.env.COSMOS_ENDPOINT;

function rec(userId: string, id: string, over: Partial<ThreadRecord> = {}): ThreadRecord {
  return {
    id,
    userId,
    title: id,
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    ...over,
  };
}

describe.runIf(RUN)('CosmosThreadStore (integration)', () => {
  let store: CosmosThreadStore;
  const userA = `it-a-${Date.now()}`;
  const userB = `it-b-${Date.now()}`;
  const created: { userId: string; id: string }[] = [];

  beforeAll(() => {
    store = new CosmosThreadStore();
  });

  afterAll(async () => {
    const c = getCosmosDatabase().container('threads');
    for (const { userId, id } of created) {
      await c.item(id, userId).delete().catch(() => undefined);
    }
  });

  it('put + get round-trips within the owner partition', async () => {
    created.push({ userId: userA, id: 't1' });
    await store.put(rec(userA, 't1', { updatedAt: '2026-01-01T00:00:01Z' }));
    const got = await store.get(userA, 't1');
    expect(got?.title).toBe('t1');
  });

  it('cross-user get returns null (IDOR fails closed)', async () => {
    expect(await store.get(userB, 't1')).toBeNull();
  });

  it('list excludes archived/deleted newest-first; includeDeleted surfaces tombstones', async () => {
    created.push({ userId: userA, id: 't2' }, { userId: userA, id: 't3' }, { userId: userA, id: 't4' });
    await store.put(rec(userA, 't2', { updatedAt: '2026-01-01T00:00:02Z' }));
    await store.put(rec(userA, 't3', { archived: true, updatedAt: '2026-01-01T00:00:03Z' }));
    await store.put(rec(userA, 't4', { deletedAt: '2026-01-01T00:00:04Z', updatedAt: '2026-01-01T00:00:04Z' }));

    const ids = (await store.list(userA)).map((t) => t.id);
    expect(ids).toContain('t1');
    expect(ids).toContain('t2');
    expect(ids).not.toContain('t3');
    expect(ids).not.toContain('t4');
    expect(ids.indexOf('t2')).toBeLessThan(ids.indexOf('t1'));

    const changes = (await store.list(userA, { includeArchived: true, includeDeleted: true })).map((t) => t.id);
    expect(changes).toContain('t4');
  });
});
