import type { Container } from '@azure/cosmos';
import { describe, expect, it, vi } from 'vitest';
import { libraryFixture } from '../../test/libraryFixtures';
import { CosmosLibraryStore } from './libraryStore';
import { LibraryService } from '../../application/libraryService';

function fakeContainer(records: unknown[], reads: Record<string, unknown> = {}) {
  const partitions: unknown[] = [];
  const container = {
    item: (id: string, partitionKey: string) => ({
      read: async () => {
        partitions.push(partitionKey);
        const resource = reads[id];
        if (!resource) throw { code: 404 };
        return { resource };
      },
      replace: async (record: unknown) => ({ resource: record }),
    }),
    items: {
      query: (_query: unknown, options: { partitionKey?: string }) => {
        partitions.push(options.partitionKey);
        return {
          fetchAll: async () => ({ resources: records }),
          fetchNext: async () => ({ resources: records }),
        };
      },
      upsert: async (record: unknown) => ({ resource: record }),
    },
  } as unknown as Container;
  return { container, partitions };
}

const query = {
  state: 'active' as const,
  sort: 'newest' as const,
  limit: 2,
};

describe('CosmosLibraryStore', () => {
  it.each([
    'not-json',
    Buffer.from(JSON.stringify({ sort: 'name', value: 'title', id: 'one' })).toString('base64url'),
    Buffer.from(JSON.stringify({ sort: 'newest', value: '2026', id: 1 })).toString('base64url'),
  ])('rejects invalid cursors before querying Cosmos: %s', async cursor => {
    const queryItems = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [] }) });
    const store = new CosmosLibraryStore({ items: { query: queryItems } } as never);
    await expect(store.list('user-1', { ...query, cursor })).rejects.toMatchObject({ code: 'validation' });
    expect(queryItems).not.toHaveBeenCalled();
  });

  it('pushes non-text filters into parameterized owner-scoped queries', async () => {
    const queryItems = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [] }) });
    const store = new CosmosLibraryStore({ items: { query: queryItems } } as never);
    const threadId = "thread-' OR true";
    await store.list('user-1', {
      ...query, kinds: ['pdf'], origins: ['chat_upload'], originGroup: 'uploaded',
      threadId, starred: true, minBytes: 10, maxBytes: 20,
      createdAfter: '2026-01-01T00:00:00.000Z', createdBefore: '2026-12-01T00:00:00.000Z',
    });
    const [statement, options] = queryItems.mock.calls[0];
    for (const predicate of [
      'c.userId = @userId', 'c.state = @state', 'ARRAY_CONTAINS(@kinds, c.kind)',
      'ARRAY_CONTAINS(@origins, c.origin)', 'ARRAY_CONTAINS(@groupOrigins, c.origin)',
      'c.source.threadId = @threadId', 'c.userMetadata.starred = @starred',
      'c.bytes >= @minBytes', 'c.bytes <= @maxBytes',
      'c.createdAt > @createdAfter', 'c.createdAt < @createdBefore',
    ]) expect(statement.query).toContain(predicate);
    expect(statement.query).not.toContain(threadId);
    expect(Object.fromEntries(statement.parameters.map((parameter: { name: string; value: unknown }) => [parameter.name, parameter.value])))
      .toEqual({ '@userId': 'user-1', '@state': 'active', '@kinds': ['pdf'], '@origins': ['chat_upload'],
        '@groupOrigins': ['chat_upload', 'library_upload', 'thread_document'], '@threadId': threadId,
        '@starred': true, '@minBytes': 10, '@maxBytes': 20,
        '@createdAfter': '2026-01-01T00:00:00.000Z', '@createdBefore': '2026-12-01T00:00:00.000Z' });
    expect(options).toEqual({ partitionKey: 'user-1' });
  });

  it('preserves default-false starring and generated-origin membership in query filters', async () => {
    const queryItems = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [] }) });
    const store = new CosmosLibraryStore({ items: { query: queryItems } } as never);
    await store.list('user-1', { ...query, starred: false, originGroup: 'generated', minBytes: 0 });
    const statement = queryItems.mock.calls[0][0];
    expect(statement.query).toContain('(NOT IS_DEFINED(c.userMetadata.starred) OR IS_NULL(c.userMetadata.starred) OR c.userMetadata.starred = @starred)');
    expect(statement.parameters).toContainEqual({ name: '@starred', value: false });
    expect(statement.parameters).toContainEqual({ name: '@minBytes', value: 0 });
    expect(statement.parameters).toContainEqual({ name: '@groupOrigins', value: ['chat_generated_image', 'studio_generated_image', 'code_artifact'] });
    await store.list('user-1', query);
    expect(queryItems.mock.calls[1][0].query).not.toContain('starred');
  });

  it.each([undefined, '', ' ', 'opaque-etag'])('requires a nonblank ETag for versioned reads: %s', async etag => {
    const record = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const store = new CosmosLibraryStore(fakeContainer([], { one: { ...record, _etag: etag } }).container);
    if (etag === 'opaque-etag') expect(await store.getForUpdate('user-1', 'one')).toEqual({ record, etag });
    else await expect(store.getForUpdate('user-1', 'one')).rejects.toThrow('Library update requires a Cosmos ETag.');
  });

  it.each([404, 409, 412, 500])('never retries a conditional Library replacement through upsert: %s', async code => {
    const record = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const replace = vi.fn().mockRejectedValue({ code });
    const upsert = vi.fn();
    const store = new CosmosLibraryStore({ item: () => ({ replace }), items: { upsert } } as never);
    await expect(store.put(record, 'expected-etag')).rejects.toMatchObject({ code: code === 500 ? 500 : 'conflict' });
    expect(replace).toHaveBeenCalledWith(record, { accessCondition: { type: 'IfMatch', condition: 'expected-etag' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['', ' '])('rejects blank update tokens before any write: %j', async etag => {
    const record = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const replace = vi.fn();
    const upsert = vi.fn();
    const store = new CosmosLibraryStore({ item: () => ({ replace }), items: { upsert } } as never);
    await expect(store.put(record, etag)).rejects.toThrow('Library update requires a Cosmos ETag.');
    expect(replace).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('rejects unrequested IDs returned by a batch lookup', async () => {
    const item = libraryFixture({ id: 'other', kind: 'image', origin: 'library_upload', state: 'active' });
    const store = new CosmosLibraryStore(fakeContainer([item]).container);
    await expect(store.getMany('user-1', ['requested'])).rejects.toThrow('Library result binding failed.');
  });

  it.each(['identical', 'changed'] as const)('does not expose duplicate or contradictory collection records: %s', async state => {
    const item = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const duplicate = { ...item, ...(state === 'changed' ? { name: 'Changed title', updatedAt: '2026-07-20T00:00:00Z' } : {}) };
    const store = new CosmosLibraryStore(fakeContainer([item, duplicate]).container);
    const mint = vi.fn(async () => ({ url: 'https://blob.test/own', expiresAt: '2026' }));
    const result = new LibraryService(store, { mint }).list('user-1', query);
    if (state === 'changed') {
      await expect(result).rejects.toThrow('Library result binding failed.');
      expect(mint).not.toHaveBeenCalled();
    } else {
      expect((await result).items).toHaveLength(1);
      expect(mint).toHaveBeenCalledOnce();
    }
  });

  it.each(['foreign-owner', 'wrong-id'] as const)('rejects a mismatched point read before granting storage access: %s', async state => {
    const item = libraryFixture({ id: state === 'wrong-id' ? 'other' : 'one', kind: 'image', origin: 'library_upload', state: 'active',
      userId: state === 'foreign-owner' ? 'user-2' : 'user-1',
      blobPath: state === 'foreign-owner' ? 'user-2/library/image.png' : 'user-1/library/image.png',
    });
    const { container } = fakeContainer([], { one: item });
    const store = new CosmosLibraryStore(container);
    const mint = vi.fn(async () => ({ url: 'https://blob.test/private', expiresAt: '2026' }));
    await expect(new LibraryService(store, { mint }).get('user-1', 'one')).rejects.toMatchObject({ code: 'not_found' });
    expect(mint).not.toHaveBeenCalled();
    expect(await store.get('user-1', 'one')).toBeNull();
    expect(await store.getForUpdate('user-1', 'one')).toBeNull();
  });

  it.each(['valid', 'foreign-owner', 'wrong-key'] as const)('checks ingestion-key lookup ownership and identity: %s', async state => {
    const item = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active',
      userId: state === 'foreign-owner' ? 'user-2' : 'user-1', ingestionKey: state === 'wrong-key' ? 'other-key' : 'expected-key',
    });
    const result = await new CosmosLibraryStore(fakeContainer([item]).container).getByIngestionKey('user-1', 'expected-key');
    expect(result).toEqual(state === 'valid' ? item : null);
  });

  it.each(['list', 'aggregate', 'many', 'derived', 'service-list'] as const)('rejects contaminated %s results wholly before DTO/grant processing', async method => {
    const own = libraryFixture({ id: 'own', kind: 'image', origin: 'library_upload', state: 'active' });
    const foreign = libraryFixture({ id: 'foreign', kind: 'image', origin: 'library_upload', state: 'active',
      userId: 'user-2', blobPath: 'user-2/library/private.png' });
    const store = new CosmosLibraryStore(fakeContainer([own, foreign]).container);
    const mint = vi.fn(async () => ({ url: 'https://blob.test/private', expiresAt: '2026' }));
    const result = method === 'list' ? store.list('user-1', query) :
      method === 'aggregate' ? store.aggregate('user-1') : method === 'many' ? store.getMany('user-1', ['own', 'foreign']) :
      method === 'derived' ? store.findDerived('user-1', 'source', undefined, 50) : new LibraryService(store, { mint }).list('user-1', query);
    await expect(result).rejects.toThrow('Library owner binding failed.');
    expect(mint).not.toHaveBeenCalled();
  });

  it('creates new records without overwriting collisions or falling back to upsert', async () => {
    const record = libraryFixture({ id: 'artifact', kind: 'pdf', origin: 'code_artifact', state: 'active' });
    const create = vi.fn().mockResolvedValue({ resource: { ...record, _etag: 'created-etag' } });
    const upsert = vi.fn();
    const store = new CosmosLibraryStore({ items: { create, upsert } } as unknown as Container);
    expect(await store.createIfAbsent(record)).toEqual(record);
    create.mockRejectedValueOnce({ code: 409 });
    expect(await store.createIfAbsent(record)).toBeNull();
    create.mockRejectedValueOnce({ code: 500 });
    await expect(store.createIfAbsent(record)).rejects.toMatchObject({ code: 500 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it('gets only through the caller owner partition and strips Cosmos fields', async () => {
    const item = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const { container, partitions } = fakeContainer([], { one: { ...item, _etag: 'secret', _ts: 1 } });
    const store = new CosmosLibraryStore(container);
    await expect(store.get('user-1', 'one')).resolves.toEqual(item);
    expect(partitions).toEqual(['user-1']);
    await expect(store.get('user-1', 'missing')).resolves.toBeNull();
  });

  it('filters, sorts, and paginates deterministically inside the owner partition', async () => {
    const records = [
      libraryFixture({ id: 'a', kind: 'pdf', origin: 'chat_upload', state: 'active', name: 'Alpha.pdf', createdAt: '2026-07-01T00:00:00.000Z' }),
      libraryFixture({ id: 'b', kind: 'pdf', origin: 'thread_document', state: 'active', name: 'Beta.pdf', createdAt: '2026-07-03T00:00:00.000Z' }),
      libraryFixture({ id: 'c', kind: 'image', origin: 'chat_generated_image', state: 'active', name: 'Gamma.png', createdAt: '2026-07-02T00:00:00.000Z' }),
      libraryFixture({ id: 'trash', kind: 'pdf', origin: 'chat_upload', state: 'trashed' }),
    ];
    const { container, partitions } = fakeContainer(records);
    const store = new CosmosLibraryStore(container);
    const first = await store.list('user-1', query);
    expect(first.items.map((item) => item.id)).toEqual(['b', 'c']);
    expect(first.totalApprox).toBe(3);
    expect(first.cursor).toBeTruthy();
    const second = await store.list('user-1', { ...query, cursor: first.cursor });
    expect(second.items.map((item) => item.id)).toEqual(['a']);
    expect(partitions).toEqual(['user-1', 'user-1']);
  });

  it('supports type, origin-group, thread, size, star, and text filters', async () => {
    const match = libraryFixture({
      id: 'match',
      kind: 'pdf',
      origin: 'chat_upload',
      state: 'active',
      name: 'Budget.pdf',
      bytes: 2048,
      userMetadata: { starred: true, title: 'Quarterly plan' },
    });
    const { container } = fakeContainer([
      match,
      libraryFixture({ id: 'other', kind: 'image', origin: 'chat_generated_image', state: 'active' }),
    ]);
    const result = await new CosmosLibraryStore(container).list('user-1', {
      ...query,
      q: 'quarterly',
      kinds: ['pdf'],
      originGroup: 'uploaded',
      threadId: 'thread-1',
      starred: true,
      minBytes: 1024,
      maxBytes: 4096,
    });
    expect(result.items).toEqual([match]);
  });

  it('rejects a cursor issued for a different sort', async () => {
    const item = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const { container } = fakeContainer([item]);
    const store = new CosmosLibraryStore(container);
    const first = await store.list('user-1', { ...query, limit: 1 });
    const withSecond = fakeContainer([item, libraryFixture({ id: 'two', kind: 'image', origin: 'library_upload', state: 'active' })]);
    const page = await new CosmosLibraryStore(withSecond.container).list('user-1', { ...query, limit: 1 });
    await expect(store.list('user-1', { ...query, sort: 'name', cursor: page.cursor })).rejects.toMatchObject({ code: 'validation' });
    expect(first.cursor).toBeUndefined();
  });

  it('keeps batch-reference and reverse-lineage reads inside the owner partition', async () => {
    const item = libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' });
    const { container, partitions } = fakeContainer([item]);
    const store = new CosmosLibraryStore(container);
    await expect(store.getMany('user-1', ['one'])).resolves.toEqual([item]);
    await expect(store.findDerived('user-1', 'one', undefined, 50)).resolves.toMatchObject({ items: [item] });
    expect(partitions).toEqual(['user-1', 'user-1']);
  });
});
