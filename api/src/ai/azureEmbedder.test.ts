import { describe, expect, it } from 'vitest';
import { azureEmbedder, embedText } from './azureEmbedder';

function mockFetch(body: unknown, ok = true, status = ok ? 200 : 500): typeof fetch {
  return (async () => ({ ok, status, json: async () => body })) as unknown as typeof fetch;
}

const creds = { baseUrl: 'https://x.services.ai.azure.com', key: 'k' };

describe('azureEmbedder', () => {
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
});
