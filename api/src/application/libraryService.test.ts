import { describe, expect, it, vi } from 'vitest';
import type { LibraryListQuery } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';
import type { SasMinter } from '../ports/sasMinter';
import { libraryFixture } from '../test/libraryFixtures';
import { LibraryService, storageSummary } from './libraryService';

const listQuery: LibraryListQuery = { state: 'active', sort: 'newest', limit: 50 };

function dependencies(records = [libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' })]) {
  const store: LibraryStore = {
    get: vi.fn(async (_userId, id) => records.find((record) => record.id === id) ?? null),
    getByIngestionKey: vi.fn(),
    put: vi.fn(),
    list: vi.fn(async () => ({ items: records, totalApprox: records.length })),
    aggregate: vi.fn(async () => ({ records, reconciledAt: '2026-07-19T12:00:00.000Z' })),
  };
  const minter: SasMinter = {
    mint: vi.fn(async ({ blobPath }) => ({ url: `https://blob.test/${blobPath}?sig=secret`, expiresAt: '2026-07-19T13:00:00.000Z' })),
  };
  return { store, minter };
}

describe('LibraryService', () => {
  it('lists safe DTOs with fresh read grants and no ownership/idempotency fields', async () => {
    const { store, minter } = dependencies();
    const result = await new LibraryService(store, minter).list('user-1', listQuery);
    expect(result.items[0]).toMatchObject({ id: 'one', url: expect.stringContaining('?sig=secret') });
    expect(result.items[0]).not.toHaveProperty('userId');
    expect(result.items[0]).not.toHaveProperty('ingestionKey');
    expect(store.list).toHaveBeenCalledWith('user-1', listQuery);
  });

  it('returns retained purged tombstones and hides their storage internals', async () => {
    const purged = libraryFixture({ id: 'gone', kind: 'image', origin: 'library_upload', state: 'purged' });
    const { store, minter } = dependencies([purged]);
    const result = await new LibraryService(store, minter).get('user-1', 'gone');
    expect(result).toMatchObject({ id: 'gone', state: 'purged' });
    expect(result).not.toHaveProperty('blobPath');
    expect(result).not.toHaveProperty('url');
  });

  it('does not reveal whether another owner has an item', async () => {
    const { store, minter } = dependencies([]);
    await expect(new LibraryService(store, minter).get('user-1', 'someone-elses-id')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('counts primary and derivative bytes and caches storage for five minutes', async () => {
    const active = libraryFixture({
      id: 'active', kind: 'image', origin: 'chat_upload', state: 'active', bytes: 100,
      contentHash: `sha256:${'a'.repeat(64)}`,
      derivatives: [{ kind: 'thumbnail', blobPath: 'thumb-a', mime: 'image/webp', bytes: 20, width: 100, height: 100 }],
    });
    const duplicate = libraryFixture({ id: 'duplicate', kind: 'image', origin: 'chat_upload', state: 'active', bytes: 30, contentHash: `sha256:${'a'.repeat(64)}` });
    const trashed = libraryFixture({ id: 'trash', kind: 'pdf', origin: 'thread_document', state: 'trashed', bytes: 50 });
    const { store, minter } = dependencies([active, duplicate, trashed]);
    let now = 1_000;
    const service = new LibraryService(store, minter, () => now);
    const first = await service.storage('user-1');
    const second = await service.storage('user-1');
    expect(first).toMatchObject({ activeBytes: 150, trashedBytes: 50, activeCount: 2, trashedCount: 1, duplicateGroups: 1 });
    expect(second).toBe(first);
    expect(store.aggregate).toHaveBeenCalledTimes(1);
    now += 5 * 60_000 + 1;
    await service.storage('user-1');
    expect(store.aggregate).toHaveBeenCalledTimes(2);
  });
});

describe('storageSummary', () => {
  it('excludes non-active lifecycle states', () => {
    const pending = libraryFixture({ id: 'pending', kind: 'image', origin: 'library_upload', state: 'pending', bytes: 999 });
    expect(storageSummary([pending])).toMatchObject({ activeBytes: 0, trashedBytes: 0, activeCount: 0, trashedCount: 0 });
  });
});
