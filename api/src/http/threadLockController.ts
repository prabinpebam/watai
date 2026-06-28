import { identityFromClaims } from '../auth/identity';
import { AppError } from '../domain/errors';
import { parseLockRequest } from '../domain/threadLock';
import type { ThreadLockService } from '../application/threadLockService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for the per-thread run lock. Identity always comes from the validated token
 * claims; the device id/label come from the request (acquire) or query (release). Conflicts
 * surface as the shared 409 envelope, carrying the current holder in `details.lock` so the UI
 * can explain who is responding.
 */
export function createThreadLockController(locks: ThreadLockService) {
  return {
    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return locks.get(userId, req.params!.id);
      }),

    acquire: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return locks.acquire(userId, req.params!.id, parseLockRequest(req.body));
      }),

    release: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const deviceId = req.query?.deviceId;
        if (!deviceId) throw new AppError('validation', 'deviceId is required.');
        return { thread: await locks.release(userId, req.params!.id, deviceId) };
      }),
  };
}
