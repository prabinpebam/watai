import { describe, it, expect, vi } from 'vitest';
import { tavilySearch, tavilyUsage } from './tavily';

function jsonRes(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body, text: async () => JSON.stringify(body) } as Response;
}

const getKey = async () => 'tvly-test';

describe('tavily client', () => {
  it('searches with Bearer auth + basic depth and returns results', async () => {
    const fetchImpl = vi.fn(
      async () =>
        jsonRes({
          query: 'q',
          answer: 'A',
          results: [{ title: 'T', url: 'https://x.com', content: 'c', favicon: 'https://x.com/f.ico' }],
        }) as Response,
    );
    const r = await tavilySearch('messi', { topic: 'news' }, { fetchImpl, getKey });
    expect(r.results[0].url).toBe('https://x.com');
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/search');
    expect(init.method).toBe('POST');
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer tvly-test');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ query: 'messi', search_depth: 'basic', include_answer: true, topic: 'news' });
  });

  it('throws unauthorized when no key is configured', async () => {
    await expect(tavilySearch('q', {}, { getKey: async () => null })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('maps 401 to unauthorized and 429 to rate_limited', async () => {
    const k401 = vi.fn(async () => jsonRes({ detail: { error: 'bad key' } }, false, 401) as Response);
    await expect(tavilySearch('q', {}, { fetchImpl: k401, getKey })).rejects.toMatchObject({
      code: 'unauthorized',
    });
    const k429 = vi.fn(async () => jsonRes({ detail: { error: 'slow down' } }, false, 429) as Response);
    await expect(tavilySearch('q', {}, { fetchImpl: k429, getKey })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('fetches usage via GET', async () => {
    const fetchImpl = vi.fn(async () => jsonRes({ key: { usage: 12, limit: 1000 } }) as Response);
    const u = await tavilyUsage({ fetchImpl, getKey });
    expect(u.key.usage).toBe(12);
    const [url, init] = fetchImpl.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe('https://api.tavily.com/usage');
    expect(init.method).toBe('GET');
  });
});
