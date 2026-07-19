import type { LibraryService } from '../application/libraryService';
import { identityFromClaims } from '../auth/identity';
import { parseLibraryLineageQuery, parseLibraryListQuery, parseLibraryUpload, parseLibraryUploadComplete } from '../domain/library';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

export function createLibraryController(library: LibraryService) {
  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return library.list(userId, parseLibraryListQuery(req.query ?? {}));
      }),

    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return library.get(userId, req.params!.id);
      }),

    storage: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return library.storage(userId);
      }),

    lineage: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return library.lineage(userId, req.params!.id, parseLibraryLineageQuery(req.query ?? {}));
      }),

    reserveUpload: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        return library.reserveUpload(userId, parseLibraryUpload(req.body));
      }),

    completeUpload: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return { item: await library.completeUpload(userId, req.params!.id, parseLibraryUploadComplete(req.body)) };
      }),
  };
}
