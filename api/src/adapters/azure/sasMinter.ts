import {
  BlobServiceClient,
  BlobSASPermissions,
  SASProtocol,
  generateBlobSASQueryParameters,
  type UserDelegationKey,
} from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { SasGrant, SasMinter } from '../../ports/sasMinter';

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/**
 * Mints short-lived, blob-scoped **user-delegation** SAS tokens (AAD-signed, no
 * account key ever leaves the server). The signing key is fetched via the managed
 * identity and cached for its lifetime. The client receives only a single-blob,
 * single-operation URL that expires in minutes.
 */
export class AzureSasMinter implements SasMinter {
  private readonly client: BlobServiceClient;
  private readonly accountName: string;
  private readonly container: string;
  private cachedKey?: { key: UserDelegationKey; expiresAtMs: number };

  constructor(opts?: { accountName?: string; container?: string; client?: BlobServiceClient }) {
    this.accountName = opts?.accountName ?? requireEnv('STORAGE_ACCOUNT');
    this.container = opts?.container ?? (process.env.MEDIA_CONTAINER ?? 'media');
    this.client =
      opts?.client ??
      new BlobServiceClient(`https://${this.accountName}.blob.core.windows.net`, new DefaultAzureCredential());
  }

  /** Fetch (and cache for ~1h) the AAD user-delegation key used to sign SAS tokens. */
  private async getDelegationKey(): Promise<UserDelegationKey> {
    const now = Date.now();
    if (this.cachedKey && this.cachedKey.expiresAtMs - 60_000 > now) {
      return this.cachedKey.key;
    }
    const startsOn = new Date(now - 5 * 60_000); // tolerate clock skew
    const expiresOn = new Date(now + 60 * 60_000); // 1h signing key, reused across mints
    const key = await this.client.getUserDelegationKey(startsOn, expiresOn);
    const validity = this.keyValidity(key, Date.now());
    this.cachedKey = { key, expiresAtMs: validity.expiresAtMs };
    return key;
  }

  private keyValidity(key: UserDelegationKey, now: number): { startsAtMs: number; expiresAtMs: number } {
    const startsAtMs = key.signedStartsOn instanceof Date ? key.signedStartsOn.getTime() : NaN;
    const expiresAtMs = key.signedExpiresOn instanceof Date ? key.signedExpiresOn.getTime() : NaN;
    if (!Number.isFinite(startsAtMs) || !Number.isFinite(expiresAtMs) ||
        startsAtMs >= expiresAtMs || startsAtMs > now || expiresAtMs <= now) {
      throw new Error('Storage returned an unusable signing-key validity interval.');
    }
    return { startsAtMs, expiresAtMs };
  }

  async mint(args: {
    blobPath: string;
    op: 'read' | 'write' | 'delete';
    contentType?: string;
    ttlSeconds: number;
  }): Promise<SasGrant> {
    const now = Date.now();
    const requestedExpiry = now + args.ttlSeconds * 1000;
    if (!Number.isFinite(args.ttlSeconds) || args.ttlSeconds <= 0 ||
        !Number.isFinite(new Date(requestedExpiry).getTime()) || Math.floor(requestedExpiry / 1000) * 1000 <= now) {
      throw new Error('SAS lifetime must have a finite positive usable expiry.');
    }
    const key = await this.getDelegationKey();
    const currentNow = Date.now();
    const validity = this.keyValidity(key, currentNow);
    const startsOn = new Date(Math.ceil(Math.max(now - 5 * 60_000, validity.startsAtMs) / 1000) * 1000);
    const expiresOn = new Date(Math.floor(Math.min(requestedExpiry, validity.expiresAtMs) / 1000) * 1000);
    if (startsOn.getTime() > currentNow || expiresOn.getTime() <= Math.max(currentNow, startsOn.getTime())) {
      throw new Error('No usable signed interval remains for this asset grant.');
    }

    // Least privilege: write => create+write only; delete => delete only; read => read only.
    const permissions =
      args.op === 'write'
        ? BlobSASPermissions.parse('cw')
        : args.op === 'delete'
          ? BlobSASPermissions.parse('d')
          : BlobSASPermissions.parse('r');

    const sas = generateBlobSASQueryParameters(
      {
        containerName: this.container,
        blobName: args.blobPath,
        permissions,
        startsOn,
        expiresOn,
        protocol: SASProtocol.Https,
        // rsct only affects read responses; for write the client sets Content-Type itself.
        contentType: args.op === 'read' ? args.contentType : undefined,
      },
      key,
      this.accountName,
    ).toString();

    const encodedPath = args.blobPath.split('/').map(encodeURIComponent).join('/');
    const url = `https://${this.accountName}.blob.core.windows.net/${this.container}/${encodedPath}?${sas}`;
    return { url, expiresAt: expiresOn.toISOString() };
  }
}
