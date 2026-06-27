import type { SasMinter } from '../../ports/sasMinter';
import type { SkillBlobStore } from '../../ports/skillBlobStore';

const ZIP_MIME = 'application/zip';
const TTL = 300;

/**
 * SkillBlobStore backed by short-lived user-delegation SAS URLs (same pattern as image/artifact
 * uploads): the server mints a single-blob, single-op URL and PUT/GET/DELETEs the bytes itself. No
 * storage account key is ever used. Lives in the shared media container alongside other blobs.
 */
export class SasSkillBlobStore implements SkillBlobStore {
  constructor(
    private readonly minter: SasMinter,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async put(blobPath: string, bytes: Uint8Array): Promise<void> {
    const { url } = await this.minter.mint({ blobPath, op: 'write', contentType: ZIP_MIME, ttlSeconds: TTL });
    const res = await this.fetchImpl(url, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': ZIP_MIME },
      body: bytes as unknown as RequestInit['body'],
    });
    if (!res.ok) throw new Error(`Skill upload failed (${res.status}).`);
  }

  async get(blobPath: string): Promise<Uint8Array> {
    const { url } = await this.minter.mint({ blobPath, op: 'read', ttlSeconds: TTL });
    const res = await this.fetchImpl(url);
    if (!res.ok) throw new Error(`Skill fetch failed (${res.status}).`);
    return new Uint8Array(await res.arrayBuffer());
  }

  async remove(blobPath: string): Promise<void> {
    const { url } = await this.minter.mint({ blobPath, op: 'delete', ttlSeconds: TTL });
    const res = await this.fetchImpl(url, { method: 'DELETE' });
    if (!res.ok && res.status !== 404) throw new Error(`Skill delete failed (${res.status}).`);
  }

  async readUrl(blobPath: string): Promise<string> {
    const { url } = await this.minter.mint({ blobPath, op: 'read', contentType: ZIP_MIME, ttlSeconds: TTL });
    return url;
  }
}
