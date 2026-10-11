import { describe, expect, it, vi } from 'vitest';
import { azureEmbedder, embedText } from './azureEmbedder';

function mockFetch(body: unknown, ok = true, status = ok ? 200 : 500): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

const creds = { baseUrl: 'https://x.services.ai.azure.com', key: 'k' };

describe('azureEmbedder', () => {
  it('rejects an already-aborted embedding before transport', async () => {
    const controller = new AbortController();
    controller.abort();
    const fetchImpl = vi.fn(mockFetch({ data: [{ embedding: [1, 2] }] }));
    await expect(embedText(creds, 'Synthetic', { model: 'm', fetchImpl, signal: controller.signal })).rejects.toThrow();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('propagates caller abort and releases the embedding deadline', async () => {
    vi.useFakeTimers();
    try {
      const controller = new AbortController();
      let fetchSignal: AbortSignal | undefined;
      const fetchImpl = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        fetchSignal = options?.signal ?? undefined;
        fetchSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const rejection = expect(embedText(creds, 'Synthetic', { model: 'm', fetchImpl, signal: controller.signal })).rejects.toThrow();
      controller.abort();
      const immediatelyAborted = fetchSignal?.aborted;
      await vi.advanceTimersByTimeAsync(10_001);
      await rejection;
      expect(immediatelyAborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('returns the embedding vector from the v1 response', async () => {
    const embedder = azureEmbedder('text-embedding-3-small', mockFetch({ data: [{ embedding: [0.1, 0.2, 0.3] }] }));
    expect(embedder.model).toBe('text-embedding-3-small');
    expect(await embedder.embed(creds, 'hello')).toEqual([0.1, 0.2, 0.3]);
  });

  it('throws on a non-2xx response', async () => {
    await expect(embedText(creds, 'hi', { model: 'm', fetchImpl: mockFetch({}, false) })).rejects.toThrow();
  });

  it('throws when the response carries no vector', async () => {
    await expect(embedText(creds, 'hi', { model: 'm', fetchImpl: mockFetch({ data: [] }) })).rejects.toThrow();
  });

  it.each(['http://x.services.ai.azure.com', 'https://attacker.invalid'])('rejects unsafe embedding destinations before fetch: %s', async (baseUrl) => {
    const fetchImpl = vi.fn(mockFetch({data:[{embedding:[0.1]}]}));
    await expect(embedText({...creds,baseUrl},'text',{model:'model',fetchImpl})).rejects.toMatchObject({code:'validation'});
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('disables embedding redirects', async () => {
    const fetchImpl = vi.fn(mockFetch({data:[{embedding:[0.1]}]}));
    await embedText(creds,'text',{model:'model',fetchImpl});
    expect(fetchImpl).toHaveBeenCalledWith('https://x.services.ai.azure.com/openai/v1/embeddings',expect.objectContaining({redirect:'error'}));
  });
});
