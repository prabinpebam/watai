import { identityFromClaims } from '../auth/identity';
import { parseRevisionedSettingsPatch } from '../domain/settings';
import type { SettingsService } from '../application/settingsService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/** HTTP boundary for per-user settings. */
export function createSettingsController(settings: SettingsService) {
  return {
    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return settings.getSnapshot(userId);
      }),

    patch: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const update = parseRevisionedSettingsPatch(req.body);
        return settings.update(userId, update.patch, update.expectedRevision);
      }),
  };
}
