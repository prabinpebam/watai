import { identityFromClaims } from '../auth/identity';
import { parseCreateThread, parseUpdateThread } from '../domain/thread';
import type { ThreadService } from '../application/threadService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for thread endpoints. Identity always comes from the validated token
 * claims (never the body/params), validation runs before the service, and every error
 * flows through the shared envelope mapper.
 */
export function createThreadsController(threads: ThreadService) {
  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return {
          threads: await threads.list(userId, {
            includeArchived: req.query?.includeArchived === 'true',
            since: req.query?.since,
          }),
        };
      }),

    create: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        return threads.create(userId, parseCreateThread(req.body));
      }),

    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return threads.get(userId, req.params!.id);
      }),

    patch: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return threads.update(userId, req.params!.id, parseUpdateThread(req.body));
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        const { userId } = identityFromClaims(req.claims);
        await threads.softDelete(userId, req.params!.id);
      }),
  };
}
