// Server-side image fetcher used by the "Use this web image" flow. The browser can't read
// cross-origin image bytes (CORS), so it asks the server to fetch a URL and hand back the bytes,
// which the client then attaches through the normal upload pipeline. SSRF-guarded, size/time-bounded,
// image-only. Returns typed validation errors (mapped to 400) with user-safe messages.
import { AppError } from '../domain/errors';
import { assertFetchableImageUrl } from '../domain/webImage';

const DEFAULT_MAX_BYTES = 12 * 1024 * 1024; // 12 MB
const DEFAULT_TIMEOUT_MS = 10_000;
const MAX_REDIRECTS = 3;
const ALLOWED_MIME = /^image\/(png|jpe?g|webp|gif)$/i;

export interface WebImageResult {
  dataBase64: string;
  mime: string;
  bytes: number;
}

export interface WebImageServiceOpts {
  fetchImpl?: typeof fetch;
  maxBytes?: number;
  timeoutMs?: number;
}

export class WebImageService {
  constructor(private readonly opts: WebImageServiceOpts = {}) {}

  async fetch(rawUrl: string): Promise<WebImageResult> {
    const fetchImpl = this.opts.fetchImpl ?? fetch;
    const maxBytes = this.opts.maxBytes ?? DEFAULT_MAX_BYTES;
    let url = assertFetchableImageUrl(rawUrl); // throws on internal/non-http(s) hosts

    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
    try {
      let res: Response | undefined;
      for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
        res = await fetchImpl(url.toString(), { redirect: 'manual', signal: ctrl.signal, headers: { Accept: 'image/*' } });
        if (res.status < 300 || res.status >= 400) break;
        const location = res.headers.get('location');
        if (!location) throw new AppError('validation', 'The image redirected without a destination.');
        url = assertFetchableImageUrl(new URL(location, url).toString()); // re-validate every hop
      }
      if (!res) throw new AppError('validation', 'Could not fetch the image.');
      if (res.status >= 300 && res.status < 400) throw new AppError('validation', 'The image URL redirected too many times.');
      if (!res.ok) throw new AppError('validation', `The image could not be fetched (${res.status}).`);

      const mime = (res.headers.get('content-type') ?? '').split(';')[0].trim().toLowerCase();
      if (!ALLOWED_MIME.test(mime)) {
        throw new AppError('validation', 'That URL is not a supported image (png, jpeg, webp, or gif).');
      }
      const declaredLen = Number(res.headers.get('content-length') ?? '');
      if (Number.isFinite(declaredLen) && declaredLen > maxBytes) {
        throw new AppError('validation', 'That image is too large (max 12 MB).');
      }
      const bytes = new Uint8Array(await res.arrayBuffer());
      if (bytes.byteLength > maxBytes) throw new AppError('validation', 'That image is too large (max 12 MB).');
      if (!bytes.byteLength) throw new AppError('validation', 'The image was empty.');

      return { dataBase64: Buffer.from(bytes).toString('base64'), mime, bytes: bytes.byteLength };
    } catch (e) {
      if (e instanceof AppError) throw e;
      if ((e as { name?: string })?.name === 'AbortError') throw new AppError('validation', 'The image request timed out.');
      throw new AppError('validation', 'Could not fetch the image.');
    } finally {
      clearTimeout(timer);
    }
  }
}
