import { describe, it, expect, vi } from 'vitest';
import { tavilySearch, normalizeTavilyImages } from './tavily';

interface Call {
  url: string;
  init: RequestInit;
}

function recordingFetch(status: number, body: unknown): { fetchImpl: typeof fetch; calls: Call[] } {
  const calls: Call[] = [];
  const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
      text: async () => JSON.stringify(body),
    } as Response;
  });
  return { fetchImpl: fetchImpl as unknown as typeof fetch, calls };
}

describe('tavilySearch', () => {
  it('POSTs the query with the bearer key and returns results', async () => {
    const { fetchImpl, calls } = recordingFetch(200, {
      query: 'cats',
      answer: 'About cats.',
      results: [{ title: 'Cats', url: 'https://e.com', content: 'meow' }],
    });

    const r = await tavilySearch('cats', { key: 'tav-key', fetchImpl });

    expect(r.answer).toBe('About cats.');
    expect(r.results[0].url).toBe('https://e.com');
    expect(calls[0].url).toBe('https://api.tavily.com/search');
    expect((calls[0].init.headers as Record<string, string>).Authorization).toBe('Bearer tav-key');
    expect(JSON.parse(calls[0].init.body as string).query).toBe('cats');
  });

  it('throws unauthorized on a 401', async () => {
    const { fetchImpl } = recordingFetch(401, { detail: { error: 'bad key' } });
    await expect(tavilySearch('x', { key: 'tav-key', fetchImpl })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('throws rate_limited on a 429', async () => {
    const { fetchImpl } = recordingFetch(429, {});
    await expect(tavilySearch('x', { key: 'tav-key', fetchImpl })).rejects.toMatchObject({
      code: 'rate_limited',
    });
  });

  it('throws unauthorized when no key is configured', async () => {
    const { fetchImpl } = recordingFetch(200, {});
    await expect(tavilySearch('x', { key: '', fetchImpl })).rejects.toMatchObject({
      code: 'unauthorized',
    });
  });

  it('requests images when includeImages is set', async () => {
    const { fetchImpl, calls } = recordingFetch(200, { query: 'cats', results: [] });
    await tavilySearch('cats', { key: 'k', fetchImpl }, { includeImages: true, includeImageDescriptions: true });
    const body = JSON.parse(calls[0].init.body as string);
    expect(body.include_images).toBe(true);
    expect(body.include_image_descriptions).toBe(true);
  });
});

describe('normalizeTavilyImages', () => {
  it('returns [] for missing/!array input', () => {
    expect(normalizeTavilyImages(undefined)).toEqual([]);
  });

  it('maps a string[] of image URLs', () => {
    expect(normalizeTavilyImages(['https://a.com/1.jpg', 'https://b.com/2.png'])).toEqual([
      { url: 'https://a.com/1.jpg' },
      { url: 'https://b.com/2.png' },
    ]);
  });

  it('maps {url,description}[] and keeps the description', () => {
    expect(normalizeTavilyImages([{ url: 'https://a.com/1.jpg', description: 'a cat' }])).toEqual([
      { url: 'https://a.com/1.jpg', description: 'a cat' },
    ]);
  });

  it('drops non-http(s) and duplicate URLs and caps the count', () => {
    const out = normalizeTavilyImages(
      ['data:image/png;base64,AA', 'https://a.com/1.jpg', 'https://a.com/1.jpg', 'https://b.com/2.jpg', 'https://c.com/3.jpg'],
      2,
    );
    expect(out).toEqual([{ url: 'https://a.com/1.jpg' }, { url: 'https://b.com/2.jpg' }]);
  });
});
