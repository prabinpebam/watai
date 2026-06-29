import { v1Url } from './chat';
import type { Embedder, EmbedCredentials } from '../ports/embedder';

export interface EmbedTextOptions {
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Single-text embedding via the Azure OpenAI v1 `/embeddings` endpoint. Throws on failure so each
 * caller chooses its own fail-open behavior: the read path falls back to an empty memory block; the
 * write path persists the record without a vector and lets backfill fill it later.
 */
export async function embedText(creds: EmbedCredentials, text: string, opts: EmbedTextOptions): Promise<number[]> {
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(v1Url(creds.baseUrl, '/embeddings'), {
      method: 'POST',
      headers: { Authorization: `Bearer ${creds.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model, input: text }),
      signal: ctrl.signal,
    });
    if (!res.ok) throw new Error(`Embeddings request failed: ${res.status}`);
    const json = (await res.json()) as { data?: Array<{ embedding?: number[] }> };
    const vector = json.data?.[0]?.embedding;
    if (!vector || !vector.length) throw new Error('Embeddings response contained no vector.');
    return vector;
  } finally {
    clearTimeout(timer);
  }
}

/** A model-pinned {@link Embedder} bound to a deployment name; credentials are supplied per call. */
export function azureEmbedder(model: string, fetchImpl?: typeof fetch): Embedder {
  return {
    model,
    embed: (creds, text) => embedText(creds, text, { model, fetchImpl }),
  };
}
