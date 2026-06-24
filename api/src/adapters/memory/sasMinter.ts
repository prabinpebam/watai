import type { SasGrant, SasMinter } from '../../ports/sasMinter';

/** Deterministic-ish fake SAS minter for unit tests and local dev (no real Azure). */
export class FakeSasMinter implements SasMinter {
  async mint(args: { blobPath: string; op: 'read' | 'write'; ttlSeconds: number }): Promise<SasGrant> {
    const expiresAt = new Date(Date.now() + args.ttlSeconds * 1000).toISOString();
    return {
      url: `https://blob.test/media/${args.blobPath}?op=${args.op}&sig=fake`,
      expiresAt,
    };
  }
}
