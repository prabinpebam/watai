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
    this.cachedKey = { key, expiresAtMs: expiresOn.getTime() };
    return key;
  }

  async mint(args: {
    blobPath: string;
    op: 'read' | 'write';
    contentType?: string;
    ttlSeconds: number;
  }): Promise<SasGrant> {
    const now = Date.now();
    const startsOn = new Date(now - 5 * 60_000);
    const expiresOn = new Date(now + args.ttlSeconds * 1000);
    const key = await this.getDelegationKey();

    // Least privilege: write => create+write only; read => read only.
    const permissions =
      args.op === 'write' ? BlobSASPermissions.parse('cw') : BlobSASPermissions.parse('r');

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
