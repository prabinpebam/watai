import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadFilesService } from './threadFilesService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import type { AoaiFiles, VectorFileStatus } from '../ai/files';
import type { ThreadRecord } from '../ports/threadStore';

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
    getDecrypted: async () => ({ baseUrl: 'https://r/openai/v1', key: 'k', models: { chat: 'gpt' } }),
  };
  const files = fakeFiles();
  const svc = new ThreadFilesService(store, credentials, files.impl, clock, {
    sleep: async () => {},
    pollMs: 0,
    maxPolls: 3,
  });
  return { store, svc, files, clock };
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
    expect(meta.status).toBe('ready');
    expect(ctx.files.calls).toContain('createVs:thread:t1');
    expect(ctx.files.calls).toContain('add:vs-1:file-1');

    const thread = await ctx.store.get('u', 't1');
    expect(thread?.vectorStoreId).toBe('vs-1');
    expect(thread?.files).toEqual([meta]);
  });

  it('reuses the existing store on a second upload (no new store)', async () => {
    await seedThread(ctx.store, { vectorStoreId: 'vs-existing' });
    await ctx.svc.upload('u', 't1', { name: 'a.txt', mime: 'text/plain', dataBase64: b64('a') });

    expect(ctx.files.calls.filter((c) => c.startsWith('createVs')).length).toBe(0);
    expect(ctx.files.calls).toContain('add:vs-existing:file-1');
    expect((await ctx.store.get('u', 't1'))?.files?.length).toBe(1);
  });

  it('polls indexing status until the file is ready', async () => {
    await seedThread(ctx.store);
    ctx.files.setAddStatus('indexing');
    ctx.files.setPollStatus('ready');
    const meta = await ctx.svc.upload('u', 't1', { name: 'a.txt', mime: 'text/plain', dataBase64: b64('a') });
    expect(meta.status).toBe('ready');
    expect(ctx.files.calls.some((c) => c.startsWith('status:'))).toBe(true);
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

  it('cleanup deletes the store and every file (best-effort on thread delete)', async () => {
    await seedThread(ctx.store, {
      vectorStoreId: 'vs-1',
      files: [
        { fileId: 'file-1', name: 'a', bytes: 1, status: 'ready', createdAt: 'x' },
        { fileId: 'file-2', name: 'b', bytes: 2, status: 'ready', createdAt: 'x' },
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
    const big = b64('x'.repeat(26 * 1024 * 1024));
    await expect(ctx.svc.upload('u', 't1', { name: 'x', mime: 't', dataBase64: big })).rejects.toThrow();
  });

  it('404s when the thread does not exist', async () => {
    await expect(ctx.svc.list('u', 'missing')).rejects.toThrow();
  });
});
