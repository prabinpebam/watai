import { identityFromClaims } from '../auth/identity';
import { parseSettingsPatch } from '../domain/settings';
import type { SettingsService } from '../application/settingsService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/** HTTP boundary for per-user settings. */
export function createSettingsController(settings: SettingsService) {
  return {
    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return settings.get(userId);
      }),

    patch: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return settings.update(userId, parseSettingsPatch(req.body));
      }),
  };
}
