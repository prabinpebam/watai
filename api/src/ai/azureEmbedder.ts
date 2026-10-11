import { validatedAiUrl } from './http';
import type { Embedder, EmbedCredentials } from '../ports/embedder';

export interface EmbedTextOptions {
  model: string;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
  signal?: AbortSignal;
}

/**
 * Single-text embedding via the Azure OpenAI v1 `/embeddings` endpoint. Throws on failure so each
 * caller chooses its own fail-open behavior: the read path falls back to an empty memory block; the
 * write path persists the record without a vector and lets backfill fill it later.
 */
export async function embedText(creds: EmbedCredentials, text: string, opts: EmbedTextOptions): Promise<number[]> {
  opts.signal?.throwIfAborted();
  const fetchImpl = opts.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const signal = opts.signal ? AbortSignal.any([ctrl.signal, opts.signal]) : ctrl.signal;
  const timer = setTimeout(() => ctrl.abort(), opts.timeoutMs ?? 10_000);
  try {
    const res = await fetchImpl(validatedAiUrl(creds.baseUrl, '/embeddings'), {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${creds.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: opts.model, input: text }),
      signal,
    });
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      throw new Error(`Embeddings request failed: ${res.status} ${body.slice(0, 300)}`.trim());
    }
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
    embed: (creds, text, options) => embedText(creds, text, { model, fetchImpl, signal: options?.signal }),
  };
}
