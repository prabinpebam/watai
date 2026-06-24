import { identityFromClaims } from '../auth/identity';
import { parseSasRequest } from '../domain/asset';
import type { AssetService } from '../application/assetService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/** HTTP boundary for minting scoped, short-lived asset SAS URLs. */
export function createAssetsController(assets: AssetService) {
  return {
    requestSas: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return assets.requestSas(userId, parseSasRequest(req.body));
      }),
  };
}
