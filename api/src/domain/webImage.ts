// SSRF guard for server-side image fetching. The browser cannot read cross-origin image bytes
// (CORS), so the server fetches a web image URL on the user's behalf — which means we must refuse
// internal/metadata targets. Pure + unit-tested; the network fetch lives in webImageService.
import { AppError } from './errors';

/** True for hosts that must never be fetched server-side: loopback, RFC-1918 private ranges,
 *  link-local (incl. the 169.254.169.254 cloud metadata IP), IPv6 loopback/link-local/ULA,
 *  `localhost`, `*.local`, and bare `metadata*` names. */
export function isPrivateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[/, '').replace(/\]$/, ''); // strip IPv6 brackets
  if (!h) return true;
  if (h === 'localhost' || h === 'metadata' || h.startsWith('metadata.') || h.endsWith('.local')) return true;
  // IPv4 loopback / unspecified / private / link-local
  if (h === '0.0.0.0' || /^127\./.test(h)) return true;
  if (/^10\./.test(h)) return true;
  if (/^192\.168\./.test(h)) return true;
  if (/^169\.254\./.test(h)) return true; // link-local, includes 169.254.169.254 metadata
  if (/^172\.(1[6-9]|2\d|3[01])\./.test(h)) return true; // 172.16.0.0/12
  // IPv6 loopback / link-local / unique-local
  if (h === '::1') return true;
  if (/^fe80:/.test(h)) return true;
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true; // fc00::/7
  return false;
}

/** Validate a URL is safe to fetch as an image: http(s) only, no embedded credentials, and not an
 *  internal/metadata host. Returns the parsed URL or throws a typed validation error. Re-run on every
 *  redirect hop. */
export function assertFetchableImageUrl(raw: string): URL {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new AppError('validation', 'Invalid image URL.');
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new AppError('validation', 'Only http(s) image URLs are allowed.');
  }
  if (url.username || url.password) {
    throw new AppError('validation', 'Credentials are not allowed in the image URL.');
  }
  if (isPrivateHost(url.hostname)) {
    throw new AppError('validation', 'That image host is not allowed.');
  }
  return url;
}
