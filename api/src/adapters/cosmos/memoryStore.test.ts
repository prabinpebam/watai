import { describe, expect, it } from 'vitest';
import { CosmosMemoryStore } from './memoryStore';
import type { MemoryRecord } from '../../domain/memory';

describe('CosmosMemoryStore', () => {
  it('lists memories without requiring a composite ORDER BY index', async () => {
    let queryText = '';
    const container = {
      items: {
        query: (spec: { query: string }) => {
          queryText = spec.query;
          return { fetchNext: async () => ({ resources: [] }) };
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
          fetchNext: async () => ({ resources: [{ id: 'm1', userId: 'userA', updatedAt: 'x', _etag: '"1"', _rid: 'r' }] }),
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

  it('atomically stores a deleted record plus payload-free source exclusion', async () => {
    let resources: Array<Record<string, unknown>> = [];
    let query = '';
    let parameters: Array<{ name: string; value: unknown }> = [];
    const container = {
      items: {
        batch: async (operations: Array<{ resourceBody: Record<string, unknown> }>) => {
          resources = operations.map((operation) => operation.resourceBody);
          return { result: operations.map(() => ({ statusCode: 200 })) };
        },
        query: (spec: { query: string; parameters: Array<{ name: string; value: unknown }> }) => {
          query = spec.query;
          parameters = spec.parameters;
          return { fetchAll: async () => ({ resources: [{ id: 'exclusion' }] }) };
        },
      },
    };
    const store = new CosmosMemoryStore(container as never);
    const sourceRefs: MemoryRecord['sourceRefs'] = [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026' }];
    const record = {
      id: 'm1', userId: 'userA', kind: 'fact', status: 'deleted', text: 'forgotten payload',
      sourceRefs,
    } as never;
    await store.exclude(record, {
      id: 'memory-exclusion-m1', userId: 'userA', memoryId: 'm1', sourceHash: 'hash',
      sourceKeys: ['message:t1:u1:'], excludedAt: '2026',
    });
    expect(resources).toHaveLength(2);
    expect(resources[1]).toMatchObject({ recordType: 'memory-exclusion', sourceKeys: ['message:t1:u1:'] });
    expect(resources[1]).not.toHaveProperty('text');
    await expect(store.isExcluded('userA', 'other', sourceRefs)).resolves.toBe(true);
    expect(query).toContain('ARRAY_CONTAINS');
    expect(parameters).toContainEqual({ name: '@sourceKey0', value: 'message:t1:u1:' });
  });

  it('passes opaque continuation tokens through so equal timestamps cannot be cursor-filtered away', async () => {
    const seen: Array<{ token?: string; max?: number }> = [];
    const pages = [
      { resources: Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, userId: 'userA', updatedAt: 'same' })), continuationToken: 'page-2' },
      { resources: [{ id: 'm100', userId: 'userA', updatedAt: 'same' }] },
    ];
    const container = { items: { query: (_spec: unknown, options: { continuationToken?: string; maxItemCount?: number }) => ({
      fetchNext: async () => {
        seen.push({ token: options.continuationToken, max: options.maxItemCount });
        return pages[options.continuationToken ? 1 : 0];
      },
    }) } };
    const store = new CosmosMemoryStore(container as never);
    const first = await store.list('userA', { limit: 100 });
    const second = await store.list('userA', { limit: 100, cursor: first.cursor });
    expect([...first.memories, ...second.memories]).toHaveLength(101);
    expect(seen).toEqual([{ token: undefined, max: 100 }, { token: 'page-2', max: 100 }]);
  });
});