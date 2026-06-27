import { identityFromClaims } from '../auth/identity';
import { AppError } from '../domain/errors';
import type { SkillCatalogService } from '../application/skillCatalogService';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

function userId(req: ApiRequest): string {
  return identityFromClaims(req.claims).userId;
}

/** Parse the `{ filename, dataBase64 }` upload envelope into raw zip bytes. */
function parseUpload(body: unknown): { filename: string; bytes: Uint8Array } {
  const b = body as { filename?: unknown; dataBase64?: unknown } | undefined;
  const filename = typeof b?.filename === 'string' ? b.filename.trim() : '';
  const dataBase64 = typeof b?.dataBase64 === 'string' ? b.dataBase64 : '';
  if (!filename || !dataBase64) {
    throw new AppError('validation', 'Provide a skill zip as { filename, dataBase64 }.');
  }
  const bytes = new Uint8Array(Buffer.from(dataBase64, 'base64'));
  if (bytes.byteLength === 0) throw new AppError('validation', 'The uploaded file is empty.');
  return { filename, bytes };
}

function parseEnabled(body: unknown): boolean {
  const b = body as { enabled?: unknown } | undefined;
  if (typeof b?.enabled !== 'boolean') throw new AppError('validation', 'Provide { enabled: boolean }.');
  return b.enabled;
}

/**
 * User-scoped skills CRUD (`/api/skills`). The catalog combines service-provided default skills
 * (toggle-off) with the user's uploaded skills (full CRUD). All identity comes from the verified
 * token — never the body — so a caller can only touch their own skills.
 */
export function createSkillsController(skills: SkillCatalogService) {
  return {
    list: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => ({ skills: await skills.list(userId(req)) })),

    get: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => skills.getDetail(userId(req), req.params!.id)),

    download: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => skills.download(userId(req), req.params!.id)),

    create: (req: ApiRequest): Promise<HttpResult> =>
      respond(201, async () => {
        const { filename, bytes } = parseUpload(req.body);
        return skills.upload(userId(req), filename, bytes);
      }),

    replace: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { filename, bytes } = parseUpload(req.body);
        return skills.replace(userId(req), req.params!.id, filename, bytes);
      }),

    setEnabled: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => skills.setEnabled(userId(req), req.params!.id, parseEnabled(req.body))),

    remove: (req: ApiRequest): Promise<HttpResult> =>
      respond(204, async () => {
        await skills.remove(userId(req), req.params!.id);
      }),
  };
}
