import { identityFromClaims } from '../auth/identity';
import {
  parseCreateMemory,
  parseMemoryImport,
  parseMemoryListQuery,
  parseMemoryRebuild,
  parsePatchMemory,
  parsePutMemorySummary,
} from '../domain/memory';
import type { MemoryService } from '../application/memoryService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

export function createMemoryController(memory: MemoryService) {
  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.list(userId, parseMemoryListQuery(req.query ?? {}));
      }),

    profile: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.profile(userId);
      }),

    create: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.createManual(userId, parseCreateMemory(req.body));
      }),

    patch: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.patch(userId, req.params!.memoryId, parsePatchMemory(req.body));
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        const { userId } = identityFromClaims(req.claims);
        await memory.delete(userId, req.params!.memoryId);
      }),

    getSummary: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return { summary: await memory.getSummary(userId) };
      }),

    putSummary: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.putSummary(userId, parsePutMemorySummary(req.body));
      }),

    export: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.export(userId);
      }),

    import: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return memory.import(userId, parseMemoryImport(req.body));
      }),

    rebuild: (req: ApiRequest): Promise<HttpResult> =>
      respond(202, async () => {
        parseMemoryRebuild(req.body);
        return { status: 'queued' as const };
      }),
  };
}