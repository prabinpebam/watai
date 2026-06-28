import { emailFromClaims } from '../auth/identity';
import type { MemoryModelService } from '../application/memoryModelService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

/**
 * Admin-only server configuration. The admin gate is enforced by the route authorizer,
 * so these handlers assume the caller is already the admin. Currently exposes the
 * server-decided memory model used for background extraction.
 */
export function createAdminConfigController(memoryModel: MemoryModelService) {
  return {
    getMemoryModel: (_req: ApiRequest): Promise<HttpResult> => respond(200, () => memoryModel.getConfig()),

    setMemoryModel: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, () => memoryModel.setModels(req.body, emailFromClaims(req.claims) ?? 'admin')),
  };
}
