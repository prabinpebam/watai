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
    put: vi.fn(async (record) => record),
    list: vi.fn(async () => ({ items: records, totalApprox: records.length })),
    aggregate: vi.fn(async () => ({ records, reconciledAt: '2026-07-19T12:00:00.000Z' })),
    getMany: vi.fn(async (_userId, ids) => records.filter((record) => ids.includes(record.id))),
    findDerived: vi.fn(async (_userId, itemId) => ({
      items: records.filter((record) => record.image?.referenceItemIds?.includes(itemId) || record.artifact?.sourceItemIds?.includes(itemId)),
    })),
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

  it('returns forward references in captured order and reverse-derived items', async () => {
    const refOne = libraryFixture({ id: 'ref-1', kind: 'image', origin: 'chat_upload', state: 'active' });
    const refTwo = libraryFixture({ id: 'ref-2', kind: 'image', origin: 'chat_upload', state: 'active' });
    const source = libraryFixture({
      id: 'source', kind: 'image', origin: 'chat_generated_image', state: 'active',
      image: { referenceItemIds: ['ref-2', 'ref-1'], provenanceComplete: true },
    });
    const derived = libraryFixture({
      id: 'derived', kind: 'pdf', origin: 'code_artifact', state: 'active',
      artifact: { sourceItemIds: ['source'], provenanceComplete: true },
    });
    const { store, minter } = dependencies([source, refOne, refTwo, derived]);
    const service = new LibraryService(store, minter);
    const forward = await service.lineage('user-1', 'source', { direction: 'references', limit: 50 });
    const reverse = await service.lineage('user-1', 'source', { direction: 'derived', limit: 50 });
    expect(forward.items.map((item) => item.id)).toEqual(['ref-2', 'ref-1']);
    expect(reverse.items.map((item) => item.id)).toEqual(['derived']);
  });

  it('reserves an account-level write SAS and activates only after matching blob properties', async () => {
    const { store, minter } = dependencies([]);
    const hash = `sha256:${'a'.repeat(64)}`;
    const fetchImpl = vi.fn(async () => new Response(null, {
      status: 200,
      headers: { 'content-length': '12', 'content-type': 'application/pdf', 'x-ms-meta-contenthash': hash },
    })) as unknown as typeof fetch;
    const service = new LibraryService(store, minter, () => Date.parse('2026-07-19T12:00:00.000Z'), fetchImpl, () => 'upload-1');
    const reservation = await service.reserveUpload('user-1', { name: 'brief.pdf', mime: 'application/pdf', bytes: 12, contentHash: hash });
    expect(reservation.item).toMatchObject({ state: 'pending', name: 'brief.pdf' });
    expect(reservation.item).not.toHaveProperty('blobPath');
    expect(reservation.upload.headers).toMatchObject({ 'x-ms-blob-type': 'BlockBlob', 'x-ms-meta-contenthash': hash });
    const pending = (store.put as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(pending.blobPath).toMatch(/^user-1\/library\/lib-[a-f0-9]{32}\.pdf$/);
    (store.get as ReturnType<typeof vi.fn>).mockResolvedValue(pending);
    const active = await service.completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash });
    expect(active).toMatchObject({ id: pending.id, state: 'active', url: expect.stringContaining('?sig=secret') });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(pending.blobPath), { method: 'HEAD' });
  });

  it('keeps a reservation pending when observed blob properties differ', async () => {
    const hash = `sha256:${'b'.repeat(64)}`;
    const pending = libraryFixture({
      id: 'pending-upload', kind: 'pdf', origin: 'library_upload', state: 'pending',
      blobPath: 'user-1/library/pending-upload.pdf', bytes: 12, contentHash: hash,
    });
    const { store, minter } = dependencies([pending]);
    const fetchImpl = vi.fn(async () => new Response(null, { status: 200, headers: { 'content-length': '11', 'content-type': 'application/pdf', 'x-ms-meta-contenthash': hash } })) as unknown as typeof fetch;
    const service = new LibraryService(store, minter, Date.now, fetchImpl);
    await expect(service.completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash })).rejects.toMatchObject({ code: 'conflict' });
    expect(store.put).not.toHaveBeenCalled();
  });
});

describe('storageSummary', () => {
  it('excludes non-active lifecycle states', () => {
    const pending = libraryFixture({ id: 'pending', kind: 'image', origin: 'library_upload', state: 'pending', bytes: 999 });
    expect(storageSummary([pending])).toMatchObject({ activeBytes: 0, trashedBytes: 0, activeCount: 0, trashedCount: 0 });
  });
});
