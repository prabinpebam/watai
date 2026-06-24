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

  it('encodes path ids and builds the messages query', async () => {
    const { fetchImpl, calls } = stubFetch([{ status: 200, body: { messages: [] } }]);
    const client = new WataiApiClient({ baseUrl, getToken: token, fetchImpl });

    await client.listMessages('a/b', { since: '2026-01-01T00:00:00Z', limit: 50 });

    expect(calls[0].url).toBe(
      'https://api.test/api/threads/a%2Fb/messages?since=2026-01-01T00%3A00%3A00Z&limit=50',
    );
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
    expect(appendBodyFromMessage(m)).toEqual({ id: 'm1', role: 'user', content: 'hi' });
  });
});
