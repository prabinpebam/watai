// Image generation (server-side port of the browser `ai/image.ts`). The caller passes the
// vault-resolved baseUrl + key + image model. Returns the raw base64 image(s); the worker uploads
// the bytes to Blob Storage. `editImage` powers remix (image-to-image) via /images/edits.
import { aiFetch } from './http';
import { normalizeHttpError } from './errors';

export interface ImageResult {
  b64: string;
  revisedPrompt?: string;
}

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

export interface ImageEditParams extends ImageGenParams {
  /** Primary source image (backward-compatible path used by Image Studio). */
  image: Uint8Array;
  /** MIME type of `image` (default image/png). */
  imageContentType?: string;
  /** Optional complete source list for multi-reference chat edits. Order communicates priority. */
  images?: Array<{
    bytes: Uint8Array;
    /** MIME type of `bytes` (default image/png). */
    contentType?: string;
  }>;
}

interface RawImageData {
  data?: Array<{ b64_json?: string; revised_prompt?: string }>;
}

function parseImages(json: RawImageData): ImageResult[] {
  return (json.data ?? [])
    .filter((d): d is { b64_json: string; revised_prompt?: string } => typeof d.b64_json === 'string')
    .map((d) => ({ b64: d.b64_json, ...(d.revised_prompt ? { revisedPrompt: d.revised_prompt } : {}) }));
}

function extForType(ct: string): string {
  return ct === 'image/jpeg' ? 'jpg' : ct === 'image/webp' ? 'webp' : 'png';
}

// POST <baseUrl>/images/generations { model, prompt, size, n, output_format } -> { data: [{ b64_json }] }
export async function generateImage(p: ImageGenParams): Promise<ImageResult[]> {
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
  return parseImages((await res.json()) as RawImageData);
}

// POST <baseUrl>/images/edits (multipart: model, prompt, image, size, n) -> { data: [{ b64_json }] }
export async function editImage(p: ImageEditParams): Promise<ImageResult[]> {
  const images = p.images?.length
    ? p.images
    : [{ bytes: p.image, contentType: p.imageContentType }];
  const form = new FormData();
  form.append('model', p.model);
  form.append('prompt', p.prompt);
  form.append('size', p.size ?? '1024x1024');
  form.append('n', '1');
  if (p.quality) form.append('quality', p.quality);
  images.forEach((image, index) => {
    const ct = image.contentType ?? 'image/png';
    // The Image API uses `image` for one reference and `image[]` for multiple references.
    form.append(
      images.length === 1 ? 'image' : 'image[]',
      new Blob([image.bytes], { type: ct }),
      `source-${index + 1}.${extForType(ct)}`,
    );
  });
  const res = await aiFetch({
    baseUrl: p.baseUrl,
    key: p.key,
    path: '/images/edits',
    body: form,
    signal: p.signal,
    timeoutMs: 180_000,
    fetchImpl: p.fetchImpl,
  });
  if (!res.ok) throw await normalizeHttpError(res, 'image');
  return parseImages((await res.json()) as RawImageData);
}
