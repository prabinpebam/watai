// Image generation (server-side port of the browser `ai/image.ts`). The caller passes the
// vault-resolved baseUrl + key + image model. Returns the raw base64 PNG(s); the worker uploads
// the bytes to Blob Storage and attaches the blob path to the assistant message.
import { aiFetch } from './http';
import { normalizeHttpError } from './errors';

export interface ImageGenParams {
  baseUrl: string;
  key: string;
  model: string;
  prompt: string;
  size?: string;
  quality?: 'low' | 'medium' | 'high';
  outputFormat?: 'png' | 'jpeg' | 'webp';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
}

// POST <baseUrl>/images/generations { model, prompt, size, n, output_format } -> { data: [{ b64_json }] }
export async function generateImage(p: ImageGenParams): Promise<Array<{ b64: string }>> {
  const body: Record<string, unknown> = {
    model: p.model,
    prompt: p.prompt,
    size: p.size ?? '1024x1024',
    n: 1,
    output_format: p.outputFormat ?? 'png',
    ...(p.quality ? { quality: p.quality } : {}),
  };
  const res = await aiFetch({
    baseUrl: p.baseUrl,
    key: p.key,
    path: '/images/generations',
    body,
    signal: p.signal,
    timeoutMs: 180_000,
    fetchImpl: p.fetchImpl,
  });
  if (!res.ok) throw await normalizeHttpError(res, 'image');
  const json = (await res.json()) as { data?: Array<{ b64_json?: string }> };
  return (json.data ?? [])
    .filter((d): d is { b64_json: string } => typeof d.b64_json === 'string')
    .map((d) => ({ b64: d.b64_json }));
}
