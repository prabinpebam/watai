import { describe, it, expect, vi } from 'vitest';
import { CloudError, WataiApiClient } from './apiClient';
import {
  appendBodyFromMessage,
  messageFromRecord,
  threadFromRecord,
  updateBodyFromPatch,
  type MessageRecord,
  type ThreadRecord,
} from './types';
import type { Message, Thread } from '../../lib/types';

interface Call {
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/**
 * Build a fetch stub that records calls and replies with the queued responses.
 * Returns a minimal response-like object (status/ok/text) rather than a real
 * `Response`, whose constructor rejects null-body statuses like 204.
 */
function stubFetch(responses: Array<{ status: number; body?: unknown }>) {
  const calls: Call[] = [];
  let i = 0;
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({
      url,
      method: init.method ?? 'GET',
      headers: (init.headers as Record<string, string>) ?? {},
      body: init.body ? JSON.parse(init.body as string) : undefined,
    });
    const r = responses[i++] ?? { status: 200, body: {} };
    return {
      status: r.status,
      ok: r.status >= 200 && r.status < 300,
      text: async () => (r.body === undefined ? '' : JSON.stringify(r.body)),
    } as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

const baseUrl = 'https://api.test/api';
const token = async () => 'tok-123';

describe('WataiApiClient', () => {
  it('sends the bearer token and parses the threads envelope', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { threads: [{ id: 't1' }] } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const threads = await client.listThreads({ includeArchived: true, since: '2026-01-01T00:00:00Z' });

    expect(threads).toEqual([{ id: 't1' }]);
    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe(
      'https://api.test/api/threads?includeArchived=true&since=2026-01-01T00%3A00%3A00Z',
    );
    expect(calls[0].headers.Authorization).toBe('Bearer tok-123');
  });

  it('omits the query string when no list options are given', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { threads: [] } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.listThreads();

    expect(calls[0].url).toBe('https://api.test/api/threads');
  });

  it('includes includeDeleted in the query when requested', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { threads: [] } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.listThreads({ includeArchived: true, includeDeleted: true });

    expect(calls[0].url).toBe('https://api.test/api/threads?includeArchived=true&includeDeleted=true');
  });

  it('encodes Library filters and reads detail and storage routes', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { items: [], cursor: 'next' } },
      { status: 200, body: { id: 'item/1', state: 'active' } },
      { status: 200, body: { activeBytes: 0, trashedBytes: 0 } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.listLibrary({ q: 'quarterly plan', kind: ['pdf', 'document'], origin: 'uploaded', starred: true, sort: 'largest', limit: 25 });
    await client.getLibraryItem('item/1');
    await client.getLibraryStorage();

    expect(calls.map((call) => call.url)).toEqual([
      'https://api.test/api/library?q=quarterly+plan&kind=pdf%2Cdocument&origin=uploaded&starred=true&sort=largest&limit=25',
      'https://api.test/api/library/item%2F1',
      'https://api.test/api/library/storage',
    ]);
  });

  it('throws unauthorized without ever calling fetch when there is no token', async () => {
    const { fetchImpl } = stubFetch([]);
    const client = new WataiApiClient({ baseUrl, getToken: async () => null, fetchImpl });

    await expect(client.listThreads()).rejects.toMatchObject({
      name: 'CloudError',
      code: 'unauthorized',
    });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('POSTs a JSON body with content-type on create', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 201, body: { id: 't9', title: 'Hi' } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const rec = await client.createThread({ title: 'Hi' });

    expect(rec).toMatchObject({ id: 't9', title: 'Hi' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].headers['Content-Type']).toBe('application/json');
    expect(calls[0].body).toEqual({ title: 'Hi' });
  });

  it('returns undefined for 204 responses (delete)', async () => {
    const { fetchImpl } = stubFetch([{ status: 204 }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await expect(client.deleteThread('t1')).resolves.toBeUndefined();
  });

  it('maps the error envelope to a CloudError with code and status', async () => {
    const { fetchImpl } = stubFetch([
      { status: 404, body: { error: { code: 'not_found', message: 'Thread not found.' } } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await expect(client.getThread('nope')).rejects.toMatchObject({
      code: 'not_found',
      status: 404,
      message: 'Thread not found.',
    });
  });

  it('wraps fetch failures as a retryable network error', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('Failed to fetch');
    }) as unknown as typeof fetch;
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    let err: CloudError | undefined;
    try {
      await client.listThreads();
    } catch (e) {
      err = e as CloudError;
    }
    expect(err).toBeInstanceOf(CloudError);
    expect(err?.code).toBe('network');
    expect(err?.retryable).toBe(true);
  });

  it('treats 4xx validation as non-retryable but 5xx as retryable', async () => {
    expect(new CloudError('validation', 'x', 400).retryable).toBe(false);
    expect(new CloudError('internal', 'x', 503).retryable).toBe(true);
    expect(new CloudError('rate_limited', 'x', 429).retryable).toBe(true);
  });

  it('treats auth/access errors as retryable so ops are not dropped (invite access is dynamic)', () => {
    expect(new CloudError('unauthorized', 'x', 401).retryable).toBe(true);
    expect(new CloudError('forbidden', 'x', 403).retryable).toBe(true);
  });

  it('encodes path ids and builds the messages query', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { messages: [] } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.listMessages('a/b', { since: '2026-01-01T00:00:00Z', limit: 50 });

    expect(calls[0].url).toBe(
      'https://api.test/api/threads/a%2Fb/messages?since=2026-01-01T00%3A00%3A00Z&limit=50',
    );
  });

  it('acquires the run lock with a POST body', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { thread: { id: 't1' }, lock: { deviceId: 'd1', deviceLabel: 'Chrome on Windows' } } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const out = await client.acquireThreadLock('t1', { deviceId: 'd1', deviceLabel: 'Chrome on Windows' });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/lock');
    expect(calls[0].body).toEqual({ deviceId: 'd1', deviceLabel: 'Chrome on Windows' });
    expect(out.lock.deviceLabel).toBe('Chrome on Windows');
  });

  it('reads the run lock via GET', async () => {
    const lock = { deviceId: 'd1', deviceLabel: 'Chrome on Windows', acquiredAt: 'a', heartbeatAt: 'b' };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { lock } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const out = await client.getThreadLock('t1');

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/lock');
    expect(out).toEqual(lock);
  });

  it('releases the run lock via DELETE with the deviceId in the query', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { thread: { id: 't1' } } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.releaseThreadLock('t1', 'd1');

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/lock?deviceId=d1');
  });

  it('lists, creates, patches, and deletes memories', async () => {
    const memory = {
      id: 'mem_1',
      userId: 'u',
      kind: 'preference',
      status: 'active',
      text: 'User prefers short plans.',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
      confidence: 1,
      salience: 0.7,
      pinned: false,
      sensitive: false,
      visibility: 'normal',
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      useCount: 0,
    };
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { memories: [memory], cursor: 'next' } },
      { status: 201, body: memory },
      { status: 200, body: { ...memory, status: 'suppressed' } },
      { status: 204 },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await expect(client.listMemory({ q: 'short plans', limit: 10 })).resolves.toEqual({ memories: [memory], cursor: 'next' });
    await client.createMemory({ text: 'User prefers short plans.', kind: 'preference' });
    await client.patchMemory('mem_1', { status: 'suppressed' });
    await client.deleteMemory('mem_1');

    expect(calls.map((c) => `${c.method} ${c.url}`)).toEqual([
      'GET https://api.test/api/memory?q=short+plans&limit=10',
      'POST https://api.test/api/memory',
      'PATCH https://api.test/api/memory/mem_1',
      'DELETE https://api.test/api/memory/mem_1',
    ]);
    expect(calls[1].body).toEqual({ text: 'User prefers short plans.', kind: 'preference' });
    expect(calls[2].body).toEqual({ status: 'suppressed' });
  });

  it('GETs the structured memory profile', async () => {
    const profile = {
      schemaVersion: 1,
      userId: 'u',
      updatedAt: '2026-01-01T00:00:00Z',
      evidenceCount: 1,
      profile: {
        user: { details: {}, family: { spouse: [], children: [], pets: [] }, preferences: { communication: [], engineering: [], design: [], tools: [], other: [] }, interests: { media: [], hobbies: [], other: [] } },
        work: { projects: [], repositories: [], deployments: [], currentFocus: [] },
        avoidances: [],
      },
      temporal: { today: { items: [] }, week: { items: [] }, month: { items: [] } },
    };
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: profile }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await expect(client.getMemoryProfile()).resolves.toEqual(profile);
    expect(calls[0].url).toBe('https://api.test/api/memory/profile');
  });

  it('carries the error details (lock holder) on a 409 conflict', async () => {
    const holder = { deviceId: 'd2', deviceLabel: 'Safari on iPhone', acquiredAt: 'a', heartbeatAt: 'b' };
    const { fetchImpl } = stubFetch([
      { status: 409, body: { error: { code: 'conflict', message: 'busy', details: { lock: holder } } } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    let err: CloudError | undefined;
    try {
      await client.acquireThreadLock('t1', { deviceId: 'd1', deviceLabel: 'Chrome' });
    } catch (e) {
      err = e as CloudError;
    }
    expect(err?.code).toBe('conflict');
    expect((err?.details as { lock: typeof holder }).lock.deviceLabel).toBe('Safari on iPhone');
  });

  it('GETs the credential status', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { configured: true, keyHint: '1234', tavilyConfigured: false } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const status = await client.getCredentialStatus();

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://api.test/api/credentials');
    expect(status).toMatchObject({ configured: true, keyHint: '1234' });
  });

  it('PUTs credentials and returns non-secret status (key never echoed)', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { configured: true, models: { chat: 'gpt' }, keyHint: 'cdef', tavilyConfigured: false } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const status = await client.putCredentials({
      baseUrl: 'my-res',
      models: { chat: 'gpt' },
      key: 'sk-secret',
    });

    expect(calls[0].method).toBe('PUT');
    expect(calls[0].url).toBe('https://api.test/api/credentials');
    expect(calls[0].body).toEqual({ baseUrl: 'my-res', models: { chat: 'gpt' }, key: 'sk-secret' });
    expect(status.configured).toBe(true);
    expect(status).not.toHaveProperty('key');
  });

  it('DELETEs credentials (204)', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 204 }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await expect(client.deleteCredentials()).resolves.toBeUndefined();
    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://api.test/api/credentials');
  });

  it('submits a run and returns the 202 acknowledgement', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 202, body: { runId: 'r1', assistantMessageId: 'm2', status: 'queued' } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const out = await client.submitRun('t1', { text: 'hi', clientMessageId: 'm1' });

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/runs');
    expect(calls[0].body).toEqual({ text: 'hi', clientMessageId: 'm1' });
    expect(out).toEqual({ runId: 'r1', assistantMessageId: 'm2', status: 'queued' });
  });

  it('gets a run by id (path ids encoded)', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { id: 'r1', status: 'running' } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const run = await client.getRun('t1', 'r1');

    expect(calls[0].method).toBe('GET');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/runs/r1');
    expect(run.status).toBe('running');
  });

  it('lists active runs from the envelope', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { runs: [{ id: 'r1', status: 'queued' }] } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const runs = await client.listActiveRuns('t1');

    expect(calls[0].url).toBe('https://api.test/api/threads/t1/runs');
    expect(runs).toEqual([{ id: 'r1', status: 'queued' }]);
  });

  it('cancels a run via DELETE', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { id: 'r1', status: 'canceled' } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const run = await client.cancelRun('t1', 'r1');

    expect(calls[0].method).toBe('DELETE');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/runs/r1');
    expect(run.status).toBe('canceled');
  });

  it('negotiates realtime via POST', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 200, body: { url: 'https://sig/client/?hub=watai', accessToken: 'rt-tok' } },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const info = await client.negotiate();

    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.test/api/negotiate');
    expect(info).toEqual({ url: 'https://sig/client/?hub=watai', accessToken: 'rt-tok' });
  });

  it('uploads, lists, and deletes thread files', async () => {
    const { fetchImpl, calls } = stubFetch([
      { status: 201, body: { fileId: 'f1', name: 'a.pdf', bytes: 10, status: 'ready', createdAt: 't' } },
      { status: 200, body: { files: [{ fileId: 'f1', name: 'a.pdf', bytes: 10, status: 'ready', createdAt: 't' }] } },
      { status: 204 },
    ]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    const up = await client.uploadThreadFile('t1', { name: 'a.pdf', mime: 'application/pdf', dataBase64: 'AAA' });
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url).toBe('https://api.test/api/threads/t1/files');
    expect(calls[0].body).toEqual({ name: 'a.pdf', mime: 'application/pdf', dataBase64: 'AAA' });
    expect(up.fileId).toBe('f1');

    const list = await client.listThreadFiles('t1');
    expect(calls[1].url).toBe('https://api.test/api/threads/t1/files');
    expect(list).toHaveLength(1);

    await client.deleteThreadFile('t1', 'f1');
    expect(calls[2].method).toBe('DELETE');
    expect(calls[2].url).toBe('https://api.test/api/threads/t1/files/f1');
  });
});

describe('cloud mappers', () => {
  const threadRec: ThreadRecord = {
    id: 't1',
    userId: 'u1',
    title: 'Hello',
    pinned: true,
    archived: false,
    temporary: false,
    messageCount: 2,
    lastMessagePreview: 'hi there',
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-02T00:00:00Z',
    deletedAt: null,
  };

  it('threadFromRecord strips userId and preserves the rest', () => {
    const t = threadFromRecord(threadRec);
    expect(t).toEqual<Thread>({
      id: 't1',
      title: 'Hello',
      pinned: true,
      archived: false,
      temporary: false,
      messageCount: 2,
      lastMessagePreview: 'hi there',
      lock: null,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-02T00:00:00Z',
      deletedAt: null,
    });
    expect('userId' in t).toBe(false);
  });

  it('threadFromRecord omits lastMessagePreview when absent', () => {
    const { lastMessagePreview: _omit, ...rest } = threadRec;
    void _omit;
    const t = threadFromRecord(rest as ThreadRecord);
    expect('lastMessagePreview' in t).toBe(false);
  });

  it('updateBodyFromPatch keeps only title/pinned/archived', () => {
    const body = updateBodyFromPatch({
      title: 'New',
      pinned: true,
      archived: true,
      messageCount: 99,
      lastMessagePreview: 'x',
      model: 'gpt',
    } as Partial<Thread>);
    expect(body).toEqual({ title: 'New', pinned: true, archived: true });
  });

  it('messageFromRecord drops server-only fields', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u1',
      role: 'assistant',
      content: 'hello',
      model: 'gpt-5',
      status: 'complete',
      createdAt: '2026-01-01T00:00:00Z',
      deletedAt: null,
    };
    const m = messageFromRecord(rec);
    expect(m).toEqual<Message>({
      id: 'm1',
      threadId: 't1',
      role: 'assistant',
      content: 'hello',
      status: 'complete',
      model: 'gpt-5',
      createdAt: '2026-01-01T00:00:00Z',
    });
    expect('userId' in m).toBe(false);
    expect('deletedAt' in m).toBe(false);
  });

  it('appendBodyFromMessage strips UI-ephemeral fields', () => {
    const m: Message = {
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'hi',
      status: 'sending',
      createdAt: '2026-01-01T00:00:00Z',
      attachments: [{ id: 'a', kind: 'image', mime: 'image/png', bytes: 1 }],
      usage: { promptTokens: 3 },
    };
    expect(appendBodyFromMessage(m)).toEqual({
      id: 'm1',
      role: 'user',
      content: 'hi',
      orderAt: '2026-01-01T00:00:00Z',
    });
  });

  it('messageFromRecord orders by the preserved orderAt, not the server append createdAt', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u',
      role: 'assistant',
      content: 'a',
      status: 'complete',
      createdAt: '2026-01-01T00:00:30Z',
      orderAt: '2026-01-01T00:00:00Z',
      deletedAt: null,
    };
    expect(messageFromRecord(rec).createdAt).toBe('2026-01-01T00:00:00Z');
  });

  it('messageFromRecord surfaces memoryRefs used by the assistant response', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u',
      role: 'assistant',
      content: 'Use rg-watai-dev.',
      status: 'complete',
      createdAt: '2026-01-01T00:00:30Z',
      deletedAt: null,
      memoryRefs: [
        {
          memoryId: 'mem_1',
          kind: 'project_context',
          text: 'User deploys Watai to rg-watai-dev.',
          sourceThreadId: 'thr_1',
          sourceMessageId: 'msg_1',
          score: 0.91,
        },
      ],
    };
    expect(messageFromRecord(rec).memoryRefs).toEqual([
      {
        memoryId: 'mem_1',
        kind: 'project_context',
        text: 'User deploys Watai to rg-watai-dev.',
        sourceThreadId: 'thr_1',
        sourceMessageId: 'msg_1',
        score: 0.91,
      },
    ]);
  });

  it('appendBodyFromMessage syncs full citations and tool result previews', () => {
    const m: Message = {
      id: 'm1',
      threadId: 't1',
      role: 'assistant',
      content: 'a',
      status: 'complete',
      createdAt: '2026-01-01T00:00:00Z',
      toolCalls: [
        { id: 'tc1', kind: 'code_interpreter', status: 'done', summary: 'Ran code', resultPreview: 'print(1)\n1' },
      ],
      citations: [
        {
          source: 'web',
          url: 'https://a.com/',
          title: 'A',
          content: 'the raw snippet',
          favicon: 'https://a.com/f.ico',
          bingQueryUrl: 'https://bing/q',
        },
      ],
    };
    const body = appendBodyFromMessage(m);
    expect(body.toolCalls).toEqual([
      { id: 'tc1', kind: 'code_interpreter', status: 'done', summary: 'Ran code', resultPreview: 'print(1)\n1' },
    ]);
    expect(body.citations).toEqual([
      {
        source: 'web',
        url: 'https://a.com/',
        title: 'A',
        content: 'the raw snippet',
        favicon: 'https://a.com/f.ico',
        bingQueryUrl: 'https://bing/q',
      },
    ]);
  });

  it('updateBodyFromPatch passes through vectorStoreId', () => {
    expect(updateBodyFromPatch({ vectorStoreId: 'vs_1' } as Partial<Thread>)).toEqual({
      vectorStoreId: 'vs_1',
    });
  });

  it('threadFromRecord surfaces vectorStoreId', () => {
    const r: ThreadRecord = {
      id: 't',
      userId: 'u',
      title: 'T',
      pinned: false,
      archived: false,
      temporary: false,
      messageCount: 0,
      createdAt: 'x',
      updatedAt: 'x',
      deletedAt: null,
      vectorStoreId: 'vs_1',
    };
    expect(threadFromRecord(r).vectorStoreId).toBe('vs_1');
  });

  it('appendBodyFromMessage syncs uploaded attachments and skips local-only ones', () => {
    const m: Message = {
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'see',
      status: 'complete',
      createdAt: '2026-01-01T00:00:00Z',
      attachments: [
        { id: 'a1', kind: 'image', blobPath: 'u/t1/a1.png', mime: 'image/png', bytes: 10, name: 'p.png', width: 4, height: 4 },
        { id: 'a2', kind: 'file', localBlobKey: 'k', mime: 'application/pdf', bytes: 20, name: 'd.pdf' },
      ],
    };
    expect(appendBodyFromMessage(m).attachments).toEqual([
      { id: 'a1', kind: 'image', blobPath: 'u/t1/a1.png', mime: 'image/png', bytes: 10, name: 'p.png', width: 4, height: 4 },
    ]);
  });

  it('round-trips webImages through messageFromRecord and appendBodyFromMessage', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u',
      role: 'assistant',
      content: 'images',
      status: 'complete',
      createdAt: 'x',
      deletedAt: null,
      webImages: [
        { id: 'w1', url: 'https://img.example/a.jpg', description: 'a cat' },
        { id: 'w2', url: 'https://img.example/b.png' },
      ],
    };
    const m = messageFromRecord(rec);
    expect(m.webImages).toEqual([
      { id: 'w1', url: 'https://img.example/a.jpg', description: 'a cat' },
      { id: 'w2', url: 'https://img.example/b.png' },
    ]);
    expect(appendBodyFromMessage(m).webImages).toEqual([
      { id: 'w1', url: 'https://img.example/a.jpg', description: 'a cat' },
      { id: 'w2', url: 'https://img.example/b.png' },
    ]);
  });

  it('messageFromRecord surfaces synced attachments (resolved later via SAS)', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u',
      role: 'user',
      content: 'x',
      status: 'complete',
      createdAt: 'x',
      deletedAt: null,
      attachments: [{ id: 'a1', kind: 'file', blobPath: 'u/t1/a1.pdf', mime: 'application/pdf', bytes: 9, name: 'd.pdf' }],
    };
    expect(messageFromRecord(rec).attachments).toEqual([
      { id: 'a1', kind: 'file', blobPath: 'u/t1/a1.pdf', mime: 'application/pdf', bytes: 9, name: 'd.pdf' },
    ]);
  });

  it('messageFromRecord surfaces generated artifacts (resolved later via SAS)', () => {
    const rec: MessageRecord = {
      id: 'm1',
      threadId: 't1',
      userId: 'u',
      role: 'assistant',
      content: 'Here is your report.',
      status: 'complete',
      createdAt: 'x',
      deletedAt: null,
      toolCalls: [{ id: 'ci1', kind: 'code_interpreter', status: 'done', artifactIds: ['art1'] }],
      artifacts: [
        {
          id: 'art1',
          name: 'Acme-Report.pdf',
          mime: 'application/pdf',
          kind: 'pdf',
          bytes: 4528,
          blobPath: 'u/t1/art1.pdf',
          sourceToolCallId: 'ci1',
          createdAt: '2026-01-01T00:00:00Z',
        },
      ],
    };
    const m = messageFromRecord(rec);
    expect(m.artifacts).toEqual([
      {
        id: 'art1',
        name: 'Acme-Report.pdf',
        mime: 'application/pdf',
        kind: 'pdf',
        bytes: 4528,
        blobPath: 'u/t1/art1.pdf',
        sourceToolCallId: 'ci1',
        createdAt: '2026-01-01T00:00:00Z',
      },
    ]);
    expect(m.toolCalls?.[0].artifactIds).toEqual(['art1']);
  });
});
