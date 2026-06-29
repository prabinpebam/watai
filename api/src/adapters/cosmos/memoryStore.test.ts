import { describe, expect, it } from 'vitest';
import { CosmosMemoryStore } from './memoryStore';

describe('CosmosMemoryStore', () => {
  it('lists memories without requiring a composite ORDER BY index', async () => {
    let queryText = '';
    const container = {
      items: {
        query: (spec: { query: string }) => {
          queryText = spec.query;
          return { fetchAll: async () => ({ resources: [] }) };
        },
      },
    };
    const store = new CosmosMemoryStore(container as never);

    await store.list('userA', { status: 'active', limit: 50 });

    expect(queryText).toContain('ORDER BY c.updatedAt DESC');
    expect(queryText).not.toContain('ORDER BY c.updatedAt DESC, c.id DESC');
  });

  it('strips Cosmos system metadata on get so strict re-validation on update/delete works', async () => {
    const stored = {
      id: 'm1', userId: 'userA', kind: 'fact', status: 'active', text: 'hi',
      _rid: 'abc', _self: 'dbs/x/colls/y/docs/z', _etag: '"0000-0000"', _attachments: 'attachments/', _ts: 1700000000,
    };
    const container = { item: () => ({ read: async () => ({ resource: stored }) }) };
    const store = new CosmosMemoryStore(container as never);

    const got = (await store.get('userA', 'm1')) as Record<string, unknown> | null;

    expect(got).toMatchObject({ id: 'm1', text: 'hi' });
    for (const key of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
      expect(got?.[key]).toBeUndefined();
    }
  });

  it('strips Cosmos system metadata from list results', async () => {
    const container = {
      items: {
        query: () => ({
          fetchAll: async () => ({ resources: [{ id: 'm1', userId: 'userA', updatedAt: 'x', _etag: '"1"', _rid: 'r' }] }),
        }),
      },
    };
    const store = new CosmosMemoryStore(container as never);

    const page = await store.list('userA', { status: 'active', limit: 50 });
    const first = page.memories[0] as Record<string, unknown>;

    expect(first.id).toBe('m1');
    expect(first._etag).toBeUndefined();
    expect(first._rid).toBeUndefined();
  });
});