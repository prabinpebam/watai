import { identityFromClaims } from '../auth/identity';
import { AppError } from '../domain/errors';
import type { WebImageService } from '../application/webImageService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for fetching a web image's bytes on the server (the browser can't read cross-origin
 * image bytes due to CORS). The client posts a URL; we return the bytes so it can attach the image
 * through the normal upload pipeline. Invite-gated; the service is SSRF-guarded + size/time-bounded.
 */
export function createWebController(svc: WebImageService) {
  return {
    fetchImage: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        identityFromClaims(req.claims); // require an authenticated user
        const url = String((req.body as { url?: unknown })?.url ?? '').trim();
        if (!url) throw new AppError('validation', 'A url is required.');
        return svc.fetch(url);
      }),
  };
}
