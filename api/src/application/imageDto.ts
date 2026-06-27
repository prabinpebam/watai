import type { SasMinter } from '../ports/sasMinter';
import type { ImageGenRecord } from '../ports/imageStore';

/** An image record enriched with a short-lived read URL (present only when `ready`). */
export interface ImageDTO extends ImageGenRecord {
  url?: string;
}

const READ_TTL_SECONDS = 3600;

function contentTypeFor(format: ImageGenRecord['outputFormat']): string {
  return format === 'jpeg' ? 'image/jpeg' : format === 'webp' ? 'image/webp' : 'image/png';
}

/**
 * Enrich a record with a read-SAS `url` for its blob (only when `ready`). The url is ephemeral
 * (never persisted); the client re-fetches when it expires. Best-effort: on a minting failure the
 * record is returned without a url rather than failing the whole response.
 */
export async function toImageDto(minter: SasMinter, rec: ImageGenRecord): Promise<ImageDTO> {
  if (rec.status !== 'ready' || !rec.blobPath) return rec;
  try {
    const { url } = await minter.mint({
      blobPath: rec.blobPath,
      op: 'read',
      contentType: contentTypeFor(rec.outputFormat),
      ttlSeconds: READ_TTL_SECONDS,
    });
    return { ...rec, url };
  } catch {
    return rec;
  }
}
