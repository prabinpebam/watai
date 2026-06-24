import { emailFromClaims } from '../auth/identity';
import { parseCreateInvite } from '../domain/invite';
import type { InviteStore } from '../ports/inviteStore';
import type { ServiceClock } from '../application/threadService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * Admin-only invite management. The admin gate is enforced by the route authorizer,
 * so these handlers assume the caller is already the admin.
 */
export function createInvitesController(invites: InviteStore, clock: ServiceClock) {
  return {
    list: (_req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => ({ invites: await invites.list() })),

    create: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { email } = parseCreateInvite(req.body);
        return invites.put({
          email,
          invitedBy: emailFromClaims(req.claims) ?? 'admin',
          createdAt: clock.now(),
        });
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        await invites.remove(req.params!.email);
      }),
  };
}
