import { identityFromClaims } from '../auth/identity';
import { AppError } from '../domain/errors';
import type { ThreadFilesService, ThreadFileUpload } from '../application/threadFilesService';
import type { SignalRSender } from '../adapters/azure/signalr';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

function parseUpload(body: unknown): ThreadFileUpload {
  const b = (body ?? {}) as Record<string, unknown>;
  const dataBase64 = typeof b.dataBase64 === 'string' ? b.dataBase64 : '';
  if (!dataBase64) throw new AppError('validation', 'A base64 file payload is required.');
  return {
    name: typeof b.name === 'string' ? b.name : '',
    mime: typeof b.mime === 'string' ? b.mime : '',
    dataBase64,
  };
}

/**
 * HTTP boundary for a thread's knowledge base (uploaded documents → file search). Identity comes
 * from the validated token claims; the thread id (and file id) come from the route.
 */
export function createThreadFilesController(svc: ThreadFilesService, signalr?: SignalRSender | null) {
  const pushThreadFiles = async (userId: string, threadId: string): Promise<void> => {
    if (!signalr) return;
    const files = await svc.list(userId, threadId).catch(() => undefined);
    await signalr.sendToUser(userId, 'thread', { thread: { id: threadId, ...(files ? { files } : {}) } }).catch(() => undefined);
  };

  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return { files: await svc.list(userId, req.params!.id) };
      }),

    upload: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        const file = await svc.upload(userId, req.params!.id, parseUpload(req.body));
        await pushThreadFiles(userId, req.params!.id);
        return file;
      }),

    attachLibrary: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { userId } = identityFromClaims(req.claims);
        const itemId = typeof (req.body as { itemId?: unknown } | undefined)?.itemId === 'string'
          ? String((req.body as { itemId: string }).itemId)
          : '';
        if (!itemId) throw new AppError('validation', 'A Library item id is required.');
        const file = await svc.attachLibraryItem(userId, req.params!.id, itemId);
        await pushThreadFiles(userId, req.params!.id);
        return file;
      }),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        const { userId } = identityFromClaims(req.claims);
        await svc.remove(userId, req.params!.id, req.params!.fileId);
        await pushThreadFiles(userId, req.params!.id);
      }),
  };
}
