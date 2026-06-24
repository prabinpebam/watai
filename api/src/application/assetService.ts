import { AppError } from '../domain/errors';
import { extForContentType, type SasRequestInput } from '../domain/asset';
import type { SasMinter } from '../ports/sasMinter';
import type { ThreadStore } from '../ports/threadStore';

export interface SasResult {
  blobPath: string;
  url: string;
  expiresAt: string;
}

/**
 * Mints scoped SAS for asset upload/download. Ownership is enforced via the parent
 * thread, and the blob path is always rooted at the caller's own prefix
 * (`{userId}/{threadId}/{assetId}.{ext}`), so a user can only ever touch their own blobs.
 */
export class AssetService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly minter: SasMinter,
    private readonly ttlSeconds = 300,
  ) {}

  async requestSas(userId: string, input: SasRequestInput): Promise<SasResult> {
    const thread = await this.threadStore.get(userId, input.threadId);
    if (!thread || thread.deletedAt) {
      throw new AppError('not_found', 'Thread not found.');
    }
    const ext = extForContentType(input.contentType);
    const blobPath = `${userId}/${input.threadId}/${input.assetId}.${ext}`;
    const grant = await this.minter.mint({
      blobPath,
      op: input.op,
      contentType: input.contentType,
      ttlSeconds: this.ttlSeconds,
    });
    return { blobPath, url: grant.url, expiresAt: grant.expiresAt };
  }
}
