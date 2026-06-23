import { aiFetch, loadConfig } from './http';
import { normalizeHttpError } from './errors';

export interface ImageParams {
  prompt: string;
  size?: string;
  n?: number;
  outputFormat?: 'png' | 'jpeg' | 'webp';
  outputCompression?: number;
  signal?: AbortSignal;
}

// POST <baseUrl>/images/generations { model, prompt, size, n, output_format, output_compression }
// -> { data: [{ b64_json }] }
export async function generateImage(p: ImageParams): Promise<Array<{ b64: string }>> {
  const { config } = await loadConfig();
  const body: Record<string, unknown> = {
    model: config.models.image,
    prompt: p.prompt,
    size: p.size ?? '1024x1024',
    n: p.n ?? 1,
    output_format: p.outputFormat ?? 'png',
    output_compression: p.outputCompression ?? 100,
  };
  const res = await aiFetch({ path: '/images/generations', body, signal: p.signal, timeoutMs: 180000 });
  if (!res.ok) throw await normalizeHttpError(res, 'image');
  const json = await res.json();
  return (json.data ?? []).map((d: { b64_json: string }) => ({ b64: d.b64_json }));
}

export function b64ToBlob(b64: string, mime = 'image/png'): Blob {
  const bytes = atob(b64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) arr[i] = bytes.charCodeAt(i);
  return new Blob([arr], { type: mime });
}
