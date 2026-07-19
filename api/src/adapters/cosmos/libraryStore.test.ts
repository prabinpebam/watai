import type { Container } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import { libraryFixture } from '../../test/libraryFixtures';
import { CosmosLibraryStore } from './libraryStore';

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
        return { fetchAll: async () => ({ resources: records }) };
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
});
