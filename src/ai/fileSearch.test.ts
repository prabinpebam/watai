import { describe, it, expect, vi } from 'vitest';
import {
  uploadFile,
  createVectorStore,
  addFileToStore,
  pollIndex,
  listStoreFiles,
  removeFileFromStore,
  deleteVectorStore,
} from './fileSearch';
import type { AiRequest } from './http';

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return {
    ok,
    status,
    json: async () => body,
    text: async () => JSON.stringify(body),
  } as Response;
}

const getConfig = async () => ({ baseUrl: 'https://r.services.ai.azure.com' }) as never;

/** A fake aiFetch that records each request and returns scripted responses. */
function fakeRequest(responder: Response[] | (() => Response)) {
  const calls: AiRequest[] = [];
  let i = 0;
  const fn = vi.fn(async (req: AiRequest) => {
    calls.push(req);
    return typeof responder === 'function' ? responder() : (responder[i++] ?? responder[responder.length - 1]);
  });
  return { fn, calls };
}

describe('fileSearch vector-store client', () => {
  it('uploads a file (multipart) and returns its id', async () => {
    const { fn, calls } = fakeRequest([jsonRes({ id: 'file_1' })]);
    const id = await uploadFile(new Blob(['hi']), 'a.txt', { request: fn, getConfig });
    expect(id).toBe('file_1');
    expect(calls[0]?.path).toBe('/files');
    expect(calls[0]?.form).toBeInstanceOf(FormData);
  });

  it('creates a vector store and returns its id', async () => {
    const { fn, calls } = fakeRequest([jsonRes({ id: 'vs_1' })]);
    const id = await createVectorStore('kb', { request: fn, getConfig });
    expect(id).toBe('vs_1');
    expect(calls[0]?.path).toBe('/vector_stores');
    expect(calls[0]?.body).toEqual({ name: 'kb' });
  });

  it('adds a file to a store via the sub-path url override', async () => {
    const { fn, calls } = fakeRequest([jsonRes({ id: 'file_1', status: 'in_progress' })]);
    await addFileToStore('vs_1', 'file_1', { request: fn, getConfig });
    expect(calls[0]?.url).toContain('/vector_stores/vs_1/files');
    expect(calls[0]?.body).toEqual({ file_id: 'file_1' });
  });

  it('polls (GET) until the file is indexed', async () => {
    const statuses = ['in_progress', 'in_progress', 'completed'];
    let i = 0;
    const { fn, calls } = fakeRequest(() => jsonRes({ id: 'file_1', status: statuses[i++] }));
    const sleep = vi.fn(async () => {});
    const done = await pollIndex('vs_1', 'file_1', { request: fn, getConfig, sleep, maxAttempts: 5 });
    expect(done).toBe(true);
    expect(calls[0]?.method).toBe('GET');
    expect(fn).toHaveBeenCalledTimes(3);
  });

  it('returns false when indexing fails', async () => {
    const { fn } = fakeRequest(() => jsonRes({ status: 'failed' }));
    const done = await pollIndex('vs_1', 'file_1', {
      request: fn,
      getConfig,
      sleep: async () => {},
      maxAttempts: 3,
    });
    expect(done).toBe(false);
  });

  it('lists store files (GET) with their status', async () => {
    const { fn, calls } = fakeRequest([
      jsonRes({ data: [{ id: 'file_1', status: 'completed' }, { id: 'file_2', status: 'in_progress' }] }),
    ]);
    const files = await listStoreFiles('vs_1', { request: fn, getConfig });
    expect(files).toEqual([
      { id: 'file_1', status: 'completed' },
      { id: 'file_2', status: 'in_progress' },
    ]);
    expect(calls[0]?.method).toBe('GET');
    expect(calls[0]?.url).toContain('/vector_stores/vs_1/files');
  });

  it('removes a file from a store (DELETE)', async () => {
    const { fn, calls } = fakeRequest([jsonRes({ deleted: true })]);
    await removeFileFromStore('vs_1', 'file_1', { request: fn, getConfig });
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toContain('/vector_stores/vs_1/files/file_1');
  });

  it('deletes a whole vector store (DELETE)', async () => {
    const { fn, calls } = fakeRequest([jsonRes({ deleted: true })]);
    await deleteVectorStore('vs_1', { request: fn, getConfig });
    expect(calls[0]?.method).toBe('DELETE');
    expect(calls[0]?.url).toMatch(/\/vector_stores\/vs_1$/);
  });
});
