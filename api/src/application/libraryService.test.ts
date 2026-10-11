import { describe, expect, it, vi } from 'vitest';
import type { LibraryItemRecord, LibraryListQuery } from '../domain/library';
import { libraryItemId } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';
import type { SasMinter } from '../ports/sasMinter';
import { libraryFixture } from '../test/libraryFixtures';
import { LibraryService, storageSummary } from './libraryService';
import { CosmosLibraryStore } from '../adapters/cosmos/libraryStore';

const listQuery: LibraryListQuery = { state: 'active', sort: 'newest', limit: 50 };

function dependencies(records = [libraryFixture({ id: 'one', kind: 'image', origin: 'library_upload', state: 'active' })]) {
  const store: LibraryStore = {
    get: vi.fn(async (_userId, id) => records.find((record) => record.id === id) ?? null),
    getForUpdate: vi.fn(async (userId, id) => {
      const record = records.find(item => item.userId === userId && item.id === id);
      return record ? { record, etag: 'fixture-etag' } : null;
    }),
    getByIngestionKey: vi.fn(),
    put: vi.fn(async (record) => record),
    createIfAbsent: vi.fn(async (record) => {
      if (records.some(existing => existing.userId === record.userId && existing.id === record.id)) return null;
      records.push(record);
      return record;
    }),
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
  it.each(['user-2/library/pending.pdf', 'user-1/other/pending.pdf', 'user-1/library/../pending.pdf', 'user-1\\library\\pending.pdf'])
    ('does not authorize verification of a wrongly bound upload blob: %s', async blobPath => {
      const hash = `sha256:${'a'.repeat(64)}`;
      const pending = libraryFixture({ id: 'pending', kind: 'pdf', origin: 'library_upload', state: 'pending',
        mime: 'application/pdf', bytes: 12, contentHash: hash, blobPath });
      const { store, minter } = dependencies([pending]);
      const fetchImpl = vi.fn(async () => new Response(null, {
        headers: { 'content-length': '12', 'content-type': 'application/pdf', 'x-ms-meta-contenthash': hash },
      }));
      await expect(new LibraryService(store, minter, Date.now, fetchImpl).completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash }))
        .rejects.toMatchObject({ code: 'conflict' });
      expect(minter.mint).not.toHaveBeenCalled();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(store.put).not.toHaveBeenCalled();
    });

  it.each([false, true])('bounds summary cache entries including pending reads: %s', async pendingFirst => {
    const { store, minter } = dependencies([]);
    let finishFirst!: (value: { records: LibraryItemRecord[] }) => void;
    if (pendingFirst) vi.mocked(store.aggregate).mockImplementationOnce(() => new Promise(resolve => { finishFirst = resolve; }));
    const service = new LibraryService(store, minter);
    const first = service.storage('owner-0');
    if (!pendingFirst) await first;
    for (let index = 1; index <= 256; index += 1) await service.storage(`owner-${index}`);
    if (pendingFirst) { finishFirst({ records: [] }); await first; }
    expect(store.aggregate).toHaveBeenCalledTimes(257);
    await service.storage('owner-256');
    expect(store.aggregate).toHaveBeenCalledTimes(257);
    await service.storage('owner-0');
    expect(store.aggregate).toHaveBeenCalledTimes(258);
  });

  it('does not evict another owner when replacing its own expired entry', async () => {
    const { store, minter } = dependencies([]);
    let now = 0;
    const service = new LibraryService(store, minter, () => now);
    await service.storage('owner-0');
    now = 1_000;
    for (let index = 1; index < 256; index += 1) await service.storage(`owner-${index}`);
    now = 300_001;
    await service.storage('owner-0');
    await service.storage('owner-1');
    expect(store.aggregate).toHaveBeenCalledTimes(257);
  });

  it.each([false, true])('cleans up failed summary reads without removing newer cache entries: %s', async newerRead => {
    const { store, minter } = dependencies();
    const active = libraryFixture({ id: 'current', kind: 'image', origin: 'library_upload', state: 'active' });
    let failOld!: (error: Error) => void;
    vi.mocked(store.aggregate).mockImplementationOnce(() => new Promise((_resolve, reject) => { failOld = reject; }))
      .mockResolvedValue({ records: [active] });
    const service = new LibraryService(store, minter);
    const failure = new Error('Synthetic aggregate failure');
    const oldRead = expect(service.storage('user-1')).rejects.toBe(failure);
    if (newerRead) expect(await service.storage('user-1')).toMatchObject({ activeCount: 1 });
    failOld(failure);
    await oldRead;
    expect(await service.storage('user-1')).toMatchObject({ activeCount: 1 });
    expect(await service.storage('user-1')).toMatchObject({ activeCount: 1 });
    expect(store.aggregate).toHaveBeenCalledTimes(2);
  });

  it.each([false, true])('does not repopulate an invalidated storage cache with a late read (fresh read first: %s)', async freshFirst => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const pending = libraryFixture({ id: 'pending', kind: 'pdf', origin: 'library_upload', state: 'pending',
      mime: 'application/pdf', bytes: 12, contentHash: hash, blobPath: 'user-1/library/pending.pdf' });
    const { store, minter } = dependencies([pending]);
    let finishOld!: (value: { records: LibraryItemRecord[] }) => void;
    vi.mocked(store.aggregate).mockImplementationOnce(() => new Promise(resolve => { finishOld = resolve; }))
      .mockResolvedValue({ records: [{ ...pending, state: 'active' }] });
    const fetchImpl = vi.fn(async () => new Response(null, {
      headers: { 'content-length': '12', 'content-type': 'application/pdf', 'x-ms-meta-contenthash': hash },
    }));
    const service = new LibraryService(store, minter, Date.now, fetchImpl);
    const oldRead = service.storage('user-1');
    await service.completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash });
    if (freshFirst) expect(await service.storage('user-1')).toMatchObject({ activeCount: 1 });
    finishOld({ records: [] });
    await oldRead;
    expect(await service.storage('user-1')).toMatchObject({ activeCount: 1 });
    expect(store.aggregate).toHaveBeenCalledTimes(2);
  });

  it('bounds upload verification and keeps a timed-out reservation pending', async () => {
    vi.useFakeTimers();
    const hash = `sha256:${'a'.repeat(64)}`;
    const pending = libraryFixture({ id: 'pending', kind: 'pdf', origin: 'library_upload', state: 'pending',
      mime: 'application/pdf', bytes: 12, contentHash: hash, blobPath: 'user-1/library/pending.pdf' });
    const { store, minter } = dependencies([pending]);
    let rejectRead!: (error: Error) => void;
    const fetchImpl = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      rejectRead = reject;
      options?.signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
    }));
    let failure: unknown;
    try {
      const work = new LibraryService(store, minter, Date.now, fetchImpl).completeUpload('user-1', 'pending', { bytes: 12, contentHash: hash })
        .catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(15001);
      const observed = failure;
      if (!observed) rejectRead(new Error('Fixture cleanup'));
      await work;
      expect(observed).toMatchObject({ code: 'conflict', message: 'Uploaded file verification could not be completed. Retry completion.' });
      expect(fetchImpl.mock.calls[0][1]).toMatchObject({ method: 'HEAD', redirect: 'error' });
      expect(fetchImpl.mock.calls[0][1]?.signal?.aborted).toBe(true);
      expect(store.put).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('keeps upload verification failures content-safe and does not activate the item', async () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const pending = libraryFixture({ id: 'pending', kind: 'pdf', origin: 'library_upload', state: 'pending',
      mime: 'application/pdf', bytes: 12, contentHash: hash, blobPath: 'user-1/library/pending.pdf' });
    const { store, minter } = dependencies([pending]);
    const fetchImpl = vi.fn(async () => { throw new Error('Private URL with sig=synthetic-secret'); });
    await expect(new LibraryService(store, minter, Date.now, fetchImpl).completeUpload('user-1', 'pending', { bytes: 12, contentHash: hash }))
      .rejects.toMatchObject({ code: 'conflict', message: 'Uploaded file verification could not be completed. Retry completion.' });
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(['bytes', 'hash'] as const)('does not acknowledge a different completion payload for an active upload: %s', async changed => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const active = libraryFixture({ id: 'one', kind: 'pdf', origin: 'library_upload', state: 'active', contentHash: hash });
    const { store, minter } = dependencies([active]);
    const fetchImpl = vi.fn();
    await expect(new LibraryService(store, minter, Date.now, fetchImpl).completeUpload('user-1', 'one', {
      bytes: changed === 'bytes' ? active.bytes + 1 : active.bytes,
      contentHash: changed === 'hash' ? `sha256:${'b'.repeat(64)}` : hash,
    })).rejects.toMatchObject({ code: 'validation' });
    expect(store.put).not.toHaveBeenCalled();
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(minter.mint).not.toHaveBeenCalled();
  });

  it('keeps completed-upload replay read-only', async () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const active = libraryFixture({ id: 'one', kind: 'pdf', origin: 'library_upload', state: 'active', contentHash: hash });
    const { store, minter } = dependencies([active]);
    const fetchImpl = vi.fn();
    const result = await new LibraryService(store, minter, Date.now, fetchImpl).completeUpload('user-1', 'one', { bytes: active.bytes, contentHash: hash });
    expect(result).toMatchObject({ id: 'one', state: 'active' });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(store.put).not.toHaveBeenCalled();
  });

  it.each(['purged', 'missing', 'changed', 'unchanged'] as const)('does not reactivate an upload reservation changed during blob verification: %s', async state => {
    const hash = `sha256:${'a'.repeat(64)}`;
    const pending = libraryFixture({ id: 'pending', kind: 'pdf', origin: 'library_upload', state: 'pending',
      mime: 'application/pdf', bytes: 12, contentHash: hash, blobPath: 'user-1/library/pending.pdf' });
    let current: (LibraryItemRecord & { _etag: string }) | undefined = { ...pending, _etag: 'original-etag' };
    let afterVerification: (LibraryItemRecord & { _etag: string }) | undefined = undefined;
    const upsert = vi.fn(async (record: LibraryItemRecord) => { current = { ...record, _etag: 'upserted' }; return { resource: current }; });
    const replace = vi.fn(async (record: LibraryItemRecord, options: { accessCondition: { condition: string } }) => {
      if (!current) throw { code: 404 };
      if (options.accessCondition.condition !== current._etag) throw { code: 412 };
      current = { ...record, _etag: 'replaced' };
      return { resource: current };
    });
    const store = new CosmosLibraryStore({ item: () => ({ read: async () => ({ resource: current ? { ...current } : undefined }), replace }), items: { upsert } } as never);
    const mint = vi.fn(async () => ({ url: 'https://blob.test/own', expiresAt: '2026' }));
    const fetchImpl = vi.fn(async () => {
      if (state === 'missing') current = undefined;
      if (state === 'purged') current = { ...pending, state: 'purged', _etag: 'purged-etag' };
      if (state === 'changed') current = { ...pending, name: 'Newer metadata', _etag: 'changed-etag' };
      afterVerification = current;
      return new Response(null, { headers: { 'content-length': '12', 'content-type': 'application/pdf', 'x-ms-meta-contenthash': hash } });
    });
    const work = new LibraryService(store, { mint }, Date.now, fetchImpl).completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash });
    if (state === 'unchanged') expect(await work).toMatchObject({ state: 'active' });
    else {
      await expect(work).rejects.toMatchObject({ code: 'conflict' });
      expect(current).toEqual(afterVerification);
    }
    expect(upsert).not.toHaveBeenCalled();
    expect(mint).toHaveBeenCalledTimes(state === 'unchanged' ? 2 : 1);
  });

  it('does not overwrite or issue a write grant for a colliding upload reservation', async () => {
    const ingestionKey = 'library_upload:collision';
    const existing = libraryFixture({ id: libraryItemId('user-1', ingestionKey), kind: 'pdf', origin: 'library_upload', state: 'purged', ingestionKey });
    const { store, minter } = dependencies([existing]);
    const service = new LibraryService(store, minter, Date.now, vi.fn(), () => 'collision');
    await expect(service.reserveUpload('user-1', {
      name: 'new.pdf', mime: 'application/pdf', bytes: 12, contentHash: `sha256:${'a'.repeat(64)}`,
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(store.put).not.toHaveBeenCalled();
    expect(minter.mint).not.toHaveBeenCalled();
    expect(await store.get('user-1', existing.id)).toEqual(existing);
  });

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
    const pending = (store.createIfAbsent as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(pending.blobPath).toMatch(/^user-1\/library\/lib-[a-f0-9]{32}\.pdf$/);
    (store.getForUpdate as ReturnType<typeof vi.fn>).mockResolvedValue({ record: pending, etag: 'fixture-etag' });
    const active = await service.completeUpload('user-1', pending.id, { bytes: 12, contentHash: hash });
    expect(active).toMatchObject({ id: pending.id, state: 'active', url: expect.stringContaining('?sig=secret') });
    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining(pending.blobPath), {
      method: 'HEAD', redirect: 'error', signal: expect.any(AbortSignal),
    });
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
