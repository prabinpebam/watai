import { identityFromClaims } from '../auth/identity';
import type { CredentialService } from '../application/credentialService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * HTTP boundary for the credential vault. Identity always comes from the validated token
 * claims. `PUT` accepts a key and returns **status only** (the key is encrypted on the way in
 * and never echoed); `GET` returns non-secret status; `DELETE` wipes the vault doc.
 */
export function createCredentialsController(credentials: CredentialService) {
  return {
    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return credentials.getStatus(userId);
      }),

    put: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return credentials.save(userId, req.body);
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        const { userId } = identityFromClaims(req.claims);
        await credentials.delete(userId);
      }),
  };
}
