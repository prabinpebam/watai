import { emailFromClaims } from '../auth/identity';
import type { AccessService } from '../application/accessService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * Reports the caller's access status so the SPA can route correctly (show the admin
 * invite view, the app, or a "not invited" screen). Requires auth but not an invite,
 * so a non-invited user can learn they need access.
 */
export function createMeController(access: AccessService) {
  return {
    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const email = emailFromClaims(req.claims);
        return {
          email: email ?? null,
          isAdmin: access.isAdmin(req.claims),
          isInvited: await access.isInvited(req.claims),
        };
      }),
  };
}
