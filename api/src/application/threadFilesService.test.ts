import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreadFilesService } from './threadFilesService';
import { ThreadService } from './threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import type { AoaiFiles, VectorFileStatus } from '../ai/files';
import type { ThreadRecord } from '../ports/threadStore';
import { libraryItemIdFor } from '../domain/library';

const PROVIDER_ENDPOINT = 'https://r.services.ai.azure.com';

function b64(s: string): string {
  return Buffer.from(s).toString('base64');
}

function fakeFiles() {
  const calls: string[] = [];
  let fileN = 0;
  let addStatus: VectorFileStatus = 'indexing';
  let pollStatus: VectorFileStatus = 'ready';
  const impl: AoaiFiles = {
    async uploadFile(_c, f) {
      calls.push(`upload:${f.filename}`);
      return { id: `file-${++fileN}`, bytes: f.bytes.byteLength };
    },
    async listFiles() {
      calls.push('listFiles');
      return [];
    },
    async createVectorStore(_c, name) {
      calls.push(`createVs:${name}`);
      return 'vs-1';
    },
    async addFile(_c, vs, fid) {
      calls.push(`add:${vs}:${fid}`);
      return addStatus;
    },
    async fileStatus(_c, vs, fid) {
      calls.push(`status:${vs}:${fid}`);
      return pollStatus;
    },
    async removeFile(_c, vs, fid) {
      calls.push(`remove:${vs}:${fid}`);
    },
    async deleteFile(_c, fid) {
      calls.push(`delFile:${fid}`);
    },
    async deleteVectorStore(_c, vs) {
      calls.push(`delVs:${vs}`);
    },
  };
  return {
    impl,
    calls,
    setAddStatus: (s: VectorFileStatus) => (addStatus = s),
    setPollStatus: (s: VectorFileStatus) => (pollStatus = s),
  };
}

function setup() {
  const store = new InMemoryThreadStore();
  let t = 0;
  const clock = { newId: () => 'id', now: () => `2026-06-27T00:00:${String(t++).padStart(2, '0')}Z` };
  const credentials = {
    getDecrypted: async () => ({ baseUrl: `${PROVIDER_ENDPOINT}/openai/v1`, key: 'k', models: { chat: 'gpt' } }),
  };
  const files = fakeFiles();
  const svc = new ThreadFilesService(store, credentials, files.impl, clock, {
    sleep: async () => {},
    pollMs: 0,
    maxPolls: 3,
    uploadOriginal: async (_userId, threadId, assetId, _bytes, contentType) => `${threadId}/${assetId}.${contentType}`,
  });
  return { store, svc, files, clock, credentials };
}

async function seedThread(store: InMemoryThreadStore, patch: Partial<ThreadRecord> = {}): Promise<void> {
  await store.put({
    id: 't1',
    userId: 'u',
    title: 'T',
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 0,
    createdAt: '2026-06-27T00:00:00Z',
    updatedAt: '2026-06-27T00:00:00Z',
    deletedAt: null,
    ...patch,
  });
}

describe('ThreadFilesService', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));

  it('creates a thread vector store on first upload and records the file', async () => {
    await seedThread(ctx.store);
    const meta = await ctx.svc.upload('u', 't1', {
      name: 'doc.pdf',
      mime: 'application/pdf',
      dataBase64: b64('hello world'),
    });

    expect(meta.fileId).toBe('file-1');
    expect(meta.name).toBe('doc.pdf');
    expect(meta.blobPath).toBe('t1/file-1.application/pdf');
    expect(meta.libraryItemId).toBe(libraryItemIdFor('u', 'thread_document', 'file-1'));
    expect(meta.mime).toBe('application/pdf');
    expect(meta.status).toBe('ready');
    expect(meta).toMatchObject({ providerEndpoint: PROVIDER_ENDPOINT });
    expect(ctx.files.calls).toContain('createVs:thread:t1');
    expect(ctx.files.calls).toContain('add:vs-1:file-1');

    const thread = await ctx.store.get('u', 't1');
    expect(thread?.vectorStoreId).toBe('vs-1');
    expect(thread?.files).toEqual([meta]);
    await new ThreadService(ctx.store, ctx.clock).update('u', 't1', { title: 'Retitled' });
    expect(await ctx.store.get('u', 't1')).toMatchObject({ title: 'Retitled', vectorStoreId: 'vs-1', files: [meta] });
  });

  it('reuses the existing store on a second upload (no new store)', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    await ctx.svc.upload('u', 't1', { name: 'a.txt', mime: 'text/plain', dataBase64: b64('a') });

    expect(ctx.files.calls.filter((c) => c.startsWith('createVs')).length).toBe(0);
    expect(ctx.files.calls).toContain('add:vs-existing:file-1');
    expect((await ctx.store.get('u', 't1'))?.files?.length).toBe(1);
  });

  it('creates a fresh store rather than using unverified legacy provider bindings', async () => {
    const legacy = { fileId: 'legacy-file', name: 'legacy', bytes: 1, status: 'ready' as const, createdAt: 'old' };
    await seedThread(ctx.store, { vectorStoreId: 'legacy-store', files: [legacy] });
    await ctx.svc.upload('u', 't1', { name: 'new.txt', mime: 'text/plain', dataBase64: b64('new') });
    expect(ctx.files.calls).toContain('createVs:thread:t1');
    expect(ctx.files.calls).not.toContain('add:legacy-store:file-1');
    const thread = await ctx.store.get('u', 't1');
    expect(thread).toMatchObject({ vectorStoreId: 'vs-1', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    expect(thread?.files).toContainEqual(legacy);
  });

  it('keeps canonical Foundry/classic aliases in the same provider boundary', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    vi.spyOn(ctx.credentials, 'getDecrypted').mockResolvedValue({ baseUrl: 'https://r.cognitiveservices.azure.com', key: 'k', models: { chat: 'gpt' } });
    await ctx.svc.upload('u', 't1', { name: 'new.txt', mime: 'text/plain', dataBase64: b64('new') });
    expect(ctx.files.calls).not.toContain('createVs:thread:t1');
    expect(ctx.files.calls).toContain('add:vs-existing:file-1');
  });

  it('does not remotely delete legacy files whose provider endpoint is unverified', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'legacy', files: [{ fileId: 'legacy-file', name: 'legacy', bytes: 1, status: 'ready', createdAt: 'old' }] });
    const decrypt = vi.spyOn(ctx.credentials, 'getDecrypted');
    await ctx.svc.cleanup('u', 't1');
    await ctx.svc.remove('u', 't1', 'legacy-file');
    expect(ctx.files.calls).toEqual([]);
    expect(decrypt).not.toHaveBeenCalled();
    expect((await ctx.store.get('u', 't1'))?.files).toEqual([]);
  });

  it('does not send old provider references to a replacement endpoint', async () => {
    await seedThread(ctx.store);
    await ctx.svc.upload('u', 't1', { name: 'old.txt', mime: 'text/plain', dataBase64: b64('old') });
    ctx.files.calls.length = 0;
    vi.spyOn(ctx.credentials, 'getDecrypted').mockResolvedValue({ baseUrl: 'https://other.services.ai.azure.com/openai/v1', key: 'replacement', models: { chat: 'gpt' } });
    await ctx.svc.cleanup('u', 't1');
    await ctx.svc.remove('u', 't1', 'file-1');
    expect(ctx.files.calls).toEqual([]);
  });

  it('rejects an endpoint-only provider binding race before file activation', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    vi.spyOn(ctx.files.impl, 'fileStatus').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, vectorStoreEndpoint: 'https://other.services.ai.azure.com' });
      return 'ready';
    });
    await expect(ctx.svc.upload('u', 't1', { name: 'new.txt', mime: 'text/plain', dataBase64: b64('new') })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('rechecks endpoint provenance after an activation CAS collision', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    const write = vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, vectorStoreEndpoint: 'https://other.services.ai.azure.com' });
      return null;
    });
    await expect(ctx.svc.upload('u', 't1', { name: 'new.txt', mime: 'text/plain', dataBase64: b64('new') })).rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledOnce();
  });

  it('requires both provenance markers before unlinking from a provider store', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'foreign-store', vectorStoreEndpoint: 'https://other.services.ai.azure.com',
      files: [{ fileId: 'owned-file', providerEndpoint: PROVIDER_ENDPOINT, name: 'file', bytes: 1, status: 'ready', createdAt: 'now' }],
    });
    await ctx.svc.remove('u', 't1', 'owned-file');
    expect(ctx.files.calls).toEqual(['delFile:owned-file']);
    expect(await ctx.store.get('u', 't1')).toMatchObject({ files: [], vectorStoreId: undefined, vectorStoreEndpoint: undefined });
  });

  it('indexes an existing Library item without writing another original blob', async () => {
    await seedThread(ctx.store);
    let originalWrites = 0;
    const svc = new ThreadFilesService(ctx.store, ctx.credentials, ctx.files.impl, ctx.clock, {
      uploadOriginal: async () => { originalWrites++; return 'unexpected'; },
      resolveLibraryItem: async (_userId, itemId) => itemId === 'lib-doc'
        ? { name: 'Library.pdf', mime: 'application/pdf', bytes: new Uint8Array([1, 2, 3]) }
        : null,
      sleep: async () => {},
    });
    const meta = await svc.attachLibraryItem('u', 't1', 'lib-doc');
    expect(meta).toMatchObject({ libraryItemId: 'lib-doc', name: 'Library.pdf', mime: 'application/pdf' });
    expect(meta.blobPath).toBeUndefined();
    expect(originalWrites).toBe(0);
    expect(ctx.files.calls).toContain('upload:Library.pdf');
  });

  it('records a newly persisted thread original in Library exactly once', async () => {
    await seedThread(ctx.store);
    const recorded: Array<{ userId: string; file: { libraryItemId?: string; blobPath?: string } }> = [];
    const svc = new ThreadFilesService(ctx.store, ctx.credentials, ctx.files.impl, ctx.clock, {
      sleep: async () => {},
      uploadOriginal: async (_userId, _threadId, assetId) => `u/library/${libraryItemIdFor('u', 'thread_document', assetId)}.pdf`,
      recordLibraryItem: async ({ userId, file }) => { recorded.push({ userId, file }); },
    });
    const meta = await svc.upload('u', 't1', { name: 'doc.pdf', mime: 'application/pdf', dataBase64: b64('hello') });
    expect(recorded).toHaveLength(1);
    expect(recorded[0]).toMatchObject({ userId: 'u', file: { libraryItemId: meta.libraryItemId, blobPath: meta.blobPath } });
    expect(meta.blobPath).toContain('/library/');
  });

  it('polls indexing status until the file is ready', async () => {
    await seedThread(ctx.store);
    ctx.files.setAddStatus('indexing');
    ctx.files.setPollStatus('ready');
    const meta = await ctx.svc.upload('u', 't1', { name: 'a.txt', mime: 'text/plain', dataBase64: b64('a') });
    expect(meta.status).toBe('ready');
    expect(ctx.files.calls.some((c) => c.startsWith('status:'))).toBe(true);
  });

  it('does not resurrect a thread deleted while provider indexing was in flight', async () => {
    await seedThread(ctx.store);
    const uploadOriginal = vi.fn(async () => 'owner/blob.txt');
    const recordLibraryItem = vi.fn(async () => {});
    const svc = new ThreadFilesService(ctx.store, ctx.credentials, ctx.files.impl, ctx.clock, { uploadOriginal, recordLibraryItem, sleep: async () => {} });
    vi.spyOn(ctx.files.impl, 'fileStatus').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, deletedAt: 'deleted-during-indexing' });
      return 'ready';
    });
    await expect(svc.upload('u', 't1', { name: 'file.txt', mime: 'text/plain', dataBase64: b64('test') })).rejects.toMatchObject({ code: 'not_found' });
    expect((await ctx.store.get('u', 't1'))?.deletedAt).toBe('deleted-during-indexing');
    expect(uploadOriginal).not.toHaveBeenCalled();
    expect(recordLibraryItem).not.toHaveBeenCalled();
  });

  it('preserves a concurrent rename and file link when activating an indexed file', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing', vectorStoreEndpoint: PROVIDER_ENDPOINT });
    const other = { fileId: 'other-file', name: 'other', bytes: 1, status: 'ready' as const, createdAt: 'now' };
    vi.spyOn(ctx.files.impl, 'fileStatus').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, title: 'Renamed', files: [other] });
      return 'ready';
    });
    const file = await ctx.svc.upload('u', 't1', { name: 'file.txt', mime: 'text/plain', dataBase64: b64('test') });
    expect(await ctx.store.get('u', 't1')).toMatchObject({ title: 'Renamed', files: [other, file], vectorStoreId: 'vs-existing' });
  });

  it('rejects an upload when a concurrent operation changes the provider binding', async () => {
    await seedThread(ctx.store);
    vi.spyOn(ctx.files.impl, 'fileStatus').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, vectorStoreId: 'other-store' });
      return 'ready';
    });
    await expect(ctx.svc.upload('u', 't1', { name: 'file.txt', mime: 'text/plain', dataBase64: b64('test') })).rejects.toMatchObject({ code: 'conflict' });
    expect((await ctx.store.get('u', 't1'))?.vectorStoreId).toBe('other-store');
  });

  it('limits activation retries and never records Library when CAS is exhausted', async () => {
    await seedThread(ctx.store);
    const recordLibraryItem = vi.fn(async () => {});
    const write = vi.spyOn(ctx.store, 'putIfMatch').mockResolvedValue(null);
    const svc = new ThreadFilesService(ctx.store, ctx.credentials, ctx.files.impl, ctx.clock, {
      sleep: async () => {}, uploadOriginal: async () => 'owner/blob.txt', recordLibraryItem,
    });
    await expect(svc.upload('u', 't1', { name: 'file.txt', mime: 'text/plain', dataBase64: b64('test') })).rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledTimes(3);
    expect(recordLibraryItem).not.toHaveBeenCalled();
    expect(ctx.files.calls.filter(call => call.startsWith('upload:'))).toHaveLength(1);
  });

  it('rereads after an activation collision without repeating provider work', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing' });
    vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, title: 'Concurrent title' });
      return null;
    });
    await ctx.svc.upload('u', 't1', { name: 'file.txt', mime: 'text/plain', dataBase64: b64('test') });
    expect((await ctx.store.get('u', 't1'))?.title).toBe('Concurrent title');
    expect(ctx.files.calls.filter(call => call.startsWith('upload:'))).toHaveLength(1);
  });

  it('removes a file, and drops the store when the last document goes', async () => {
    await seedThread(ctx.store);
    await ctx.svc.upload('u', 't1', { name: 'a.txt', mime: 'text/plain', dataBase64: b64('a') });
    await ctx.svc.remove('u', 't1', 'file-1');

    expect(ctx.files.calls).toContain('remove:vs-1:file-1');
    expect(ctx.files.calls).toContain('delFile:file-1');
    expect(ctx.files.calls).toContain('delVs:vs-1');
    const thread = await ctx.store.get('u', 't1');
    expect(thread?.files).toEqual([]);
    expect(thread?.vectorStoreId).toBeUndefined();
  });

  it('unlinks before cleanup and never rewrites a thread deleted during provider cleanup', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-owned', vectorStoreEndpoint: PROVIDER_ENDPOINT, files: [{ fileId: 'owned', providerEndpoint: PROVIDER_ENDPOINT, name: 'owned', bytes: 1, status: 'ready', createdAt: 'now' }] });
    let wasUnlinked = false;
    vi.spyOn(ctx.files.impl, 'removeFile').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      wasUnlinked = current.files?.length === 0 && current.vectorStoreId === undefined;
      await ctx.store.put({ ...current, deletedAt: 'deleted-during-cleanup' });
    });
    await ctx.svc.remove('u', 't1', 'owned');
    expect(wasUnlinked).toBe(true);
    expect((await ctx.store.get('u', 't1'))?.deletedAt).toBe('deleted-during-cleanup');
  });

  it('keeps a vector store and concurrent file when unlink retries after another file was added', async () => {
    const owned = { fileId: 'owned', name: 'owned', bytes: 1, status: 'ready' as const, createdAt: 'now' };
    const added = { ...owned, fileId: 'concurrent' };
    await seedThread(ctx.store, { vectorStoreId: 'vs-owned', files: [owned] });
    vi.spyOn(ctx.store, 'putIfMatch').mockImplementationOnce(async () => {
      const current = (await ctx.store.get('u', 't1'))!;
      await ctx.store.put({ ...current, title: 'Concurrent edit', files: [owned, added] });
      return null;
    });
    await ctx.svc.remove('u', 't1', 'owned');
    expect(await ctx.store.get('u', 't1')).toMatchObject({ title: 'Concurrent edit', files: [added], vectorStoreId: 'vs-owned' });
    expect(ctx.files.calls).not.toContain('delVs:vs-owned');
  });

  it('does no credential or provider work if unlink conflicts are exhausted', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-owned', files: [{ fileId: 'owned', name: 'owned', bytes: 1, status: 'ready', createdAt: 'now' }] });
    const write = vi.spyOn(ctx.store, 'putIfMatch').mockResolvedValue(null);
    const decrypt = vi.spyOn(ctx.credentials, 'getDecrypted');
    await expect(ctx.svc.remove('u', 't1', 'owned')).rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledTimes(3);
    expect(decrypt).not.toHaveBeenCalled();
    expect(ctx.files.calls).toEqual([]);
  });

  it('rejects an unrelated provider file before credentials, deletion or thread mutation', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-owned', files: [{ fileId: 'owned-file', name: 'owned', bytes: 1, status: 'ready', createdAt: 'now' }] });
    const before = structuredClone(await ctx.store.get('u', 't1'));
    const decrypt = vi.spyOn(ctx.credentials, 'getDecrypted');
    await expect(ctx.svc.remove('u', 't1', 'somebody-elses-file')).rejects.toMatchObject({ code: 'not_found' });
    expect(decrypt).not.toHaveBeenCalled();
    expect(ctx.files.calls).toEqual([]);
    expect(await ctx.store.get('u', 't1')).toEqual(before);
  });

  it('does not delete an empty vector store in response to an unknown file id', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-owned', files: [] });
    await expect(ctx.svc.remove('u', 't1', 'unknown-file')).rejects.toMatchObject({ code: 'not_found' });
    expect(ctx.files.calls).toEqual([]);
    expect((await ctx.store.get('u', 't1'))?.vectorStoreId).toBe('vs-owned');
  });

  it('cleanup deletes the store and every file (best-effort on thread delete)', async () => {
    await seedThread(ctx.store, {
      vectorStoreId: 'vs-1',
      vectorStoreEndpoint: PROVIDER_ENDPOINT,
      files: [
        { fileId: 'file-1', providerEndpoint: PROVIDER_ENDPOINT, name: 'a', bytes: 1, status: 'ready', createdAt: 'x' },
        { fileId: 'file-2', providerEndpoint: PROVIDER_ENDPOINT, name: 'b', bytes: 2, status: 'ready', createdAt: 'x' },
      ],
    });
    await ctx.svc.cleanup('u', 't1');
    expect(ctx.files.calls).toContain('delVs:vs-1');
    expect(ctx.files.calls).toContain('delFile:file-1');
    expect(ctx.files.calls).toContain('delFile:file-2');
  });

  it('rejects an empty or oversized payload', async () => {
    await seedThread(ctx.store);
    await expect(ctx.svc.upload('u', 't1', { name: 'x', mime: 't', dataBase64: '' })).rejects.toThrow();
    const big = 'A'.repeat(4 * Math.ceil((25 * 1024 * 1024 + 1) / 3) - 1) + '=';
    const decode = vi.spyOn(Buffer, 'from');
    try {
      await expect(ctx.svc.upload('u', 't1', { name: 'x', mime: 't', dataBase64: big })).rejects.toThrow('25 MB');
      expect(decode.mock.calls.filter(arguments_ => (arguments_ as unknown[])[1] === 'base64').length).toBe(0);
    } finally {
      decode.mockRestore();
    }
    expect(ctx.files.calls).toEqual([]);
  });

  it.each(['%%%%', 'A', 'AA=A', 'A===', 'data:text/plain;base64,!!!!', `data:${'x'.repeat(200)};base64,QQ==`])('rejects malformed base64 before provider access: %s', async (dataBase64) => {
    await seedThread(ctx.store);
    const credentials = vi.spyOn(ctx.credentials, 'getDecrypted');
    await expect(ctx.svc.upload('u', 't1', {name:'invalid.txt',mime:'text/plain',dataBase64})).rejects.toMatchObject({code:'validation'});
    expect(credentials).not.toHaveBeenCalled();
    expect(ctx.files.calls).toEqual([]);
  });

  it('accepts ordinary base64 data URLs', async () => {
    await seedThread(ctx.store);
    const result = await ctx.svc.upload('u', 't1', {name:'file.txt',mime:'text/plain',dataBase64:'data:text/plain;base64,aGVsbG8='});
    expect(result.bytes).toBe(5);
  });

  it.each([25 * 1024 * 1024 - 1, 25 * 1024 * 1024])('accepts valid uploads up to the exact boundary: %s', async (bytes) => {
    await seedThread(ctx.store);
    const padding = (3 - bytes % 3) % 3;
    const dataBase64 = 'A'.repeat(4 * Math.ceil(bytes / 3) - padding) + '='.repeat(padding);
    const result = await ctx.svc.upload('u', 't1', {name:'boundary.txt',mime:'text/plain',dataBase64});
    expect(result.bytes).toBe(bytes);
  });

  it('404s when the thread does not exist', async () => {
    await expect(ctx.svc.list('u', 'missing')).rejects.toThrow();
  });
});
