import { identityFromClaims } from '../auth/identity';
import type { ImageService } from '../application/imageService';
import type { ImageListOptions } from '../ports/imageStore';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for the image studio. `create` returns `202` immediately (the client may
 * disconnect); generation continues server-side in the queue worker. Identity always comes from
 * the validated token claims.
 */
export function createImagesController(images: ImageService) {
  return {
    create: (req: ApiRequest): Promise<HttpResult> =>
      respond(202, async () => {
        const { userId } = identityFromClaims(req.claims);
        return { images: await images.create(userId, req.body) };
      }),

    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const q = req.query ?? {};
        const options: ImageListOptions = {
          ...(q.q ? { q: q.q } : {}),
          ...(q.size ? { size: q.size } : {}),
          ...(q.sort === 'oldest' ? { sort: 'oldest' } : {}),
          ...(q.cursor ? { cursor: q.cursor } : {}),
          ...(q.limit ? { limit: Number.parseInt(q.limit, 10) } : {}),
        };
        return images.list(userId, options);
      }),

    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return images.get(userId, req.params!.id);
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        const { userId } = identityFromClaims(req.claims);
        await images.remove(userId, req.params!.id);
        return undefined;
      }),
  };
}
