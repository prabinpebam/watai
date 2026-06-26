import { identityFromClaims } from '../auth/identity';
import type { SignalRSender } from '../adapters/azure/signalr';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for SignalR negotiation. Returns the connection info (service url + a short-lived
 * access token carrying the caller's user id) so the client can connect and receive pushes scoped
 * to itself. When realtime push isn't configured, returns an empty url and the client falls back
 * to sync polling. Identity always comes from the validated token claims.
 */
export function createNegotiateController(signalr: SignalRSender | null) {
  return {
    negotiate: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return signalr ? signalr.negotiate(userId) : { url: '', accessToken: '' };
      }),
  };
}
