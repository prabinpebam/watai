import { DefaultAzureCredential } from '@azure/identity';
import { KeyClient, CryptographyClient } from '@azure/keyvault-keys';
import type { KeyWrapper, WrappedKey } from '../../ports/keyWrapper';

const ALGORITHM = 'RSA-OAEP-256';
const CURRENT_KEY_TTL_MS = 5 * 60_000;

interface VersionedClient {
  client: CryptographyClient;
  keyId: string;
}

/**
 * Production KEK adapter: an Azure Key Vault RSA key wraps/unwraps the per-record DEK
 * (RSA-OAEP-256). The Functions app authenticates via Managed Identity, so no secret is
 * needed to reach the secret-wrapping key. `kekVersion` stores the exact versioned key id
 * used to wrap, so a rotated KEK can still unwrap older records.
 */
export class KeyVaultWrapper implements KeyWrapper {
  private readonly credential = new DefaultAzureCredential();
  private wrapClient: Promise<VersionedClient> | undefined;
  private expiresAt = 0;

  constructor(
    private readonly vaultUrl = process.env.KEY_VAULT_URI ?? '',
    private readonly keyName = process.env.CRED_KEK_NAME ?? 'watai-cred-kek',
  ) {}

  private validateKeyId(keyId: string | undefined): string {
    if (!keyId || !this.vaultUrl) throw new Error('A versioned credential wrapping key is required.');
    const vault = new URL(this.vaultUrl);
    const key = new URL(keyId);
    const segments = key.pathname.split('/');
    if (
      key.protocol !== 'https:' || key.origin !== vault.origin || key.username || key.password || key.search || key.hash ||
      segments.length !== 4 || segments[1] !== 'keys' || segments[2] !== this.keyName ||
      !/^[a-zA-Z0-9_-]+$/.test(segments[3])
    ) {
      throw new Error('Credential wrapping key must reference the configured vault, key and exact version.');
    }
    return key.href;
  }

  /** Crypto client bound to the *current* KEK version (used for wrapping). */
  private wrapper(): Promise<VersionedClient> {
    if (!this.wrapClient || Date.now() >= this.expiresAt) {
      if (!this.vaultUrl) throw new Error('KEY_VAULT_URI is not set.');
      const keyClient = new KeyClient(this.vaultUrl, this.credential);
      const pending = keyClient
        .getKey(this.keyName)
        .then((key) => {
          const keyId = this.validateKeyId(key.id);
          return { client: new CryptographyClient(keyId, this.credential), keyId };
        });
      this.wrapClient = pending;
      this.expiresAt = Date.now() + CURRENT_KEY_TTL_MS;
      void pending.catch(() => {
        if (this.wrapClient === pending) this.wrapClient = undefined;
      });
    }
    return this.wrapClient;
  }

  async wrapKey(dek: Buffer): Promise<WrappedKey> {
    for (let attempt = 0; attempt < 2; attempt += 1) {
      const pending = this.wrapper();
      const { client, keyId } = await pending;
      try {
        const res = await client.wrapKey(ALGORITHM, dek);
        const version = this.validateKeyId(res.keyID ?? keyId);
        if (version !== keyId) throw new Error('Wrapping response does not match the selected key version.');
        return { wrapped: Buffer.from(res.result).toString('base64'), kekVersion: version };
      } catch (error) {
        const status = (error as { statusCode?: number }).statusCode;
        if (![403, 404, 410].includes(status ?? 0)) throw error;
        if (this.wrapClient === pending) this.wrapClient = undefined;
        if (attempt !== 0) throw error;
      }
    }
    throw new Error('Credential wrapping retry limit exceeded.');
  }

  async unwrapKey(wrapped: string, kekVersion: string): Promise<Buffer> {
    // Bind to the exact versioned key id that wrapped this DEK (rotation-safe).
    const client = new CryptographyClient(this.validateKeyId(kekVersion), this.credential);
    const res = await client.unwrapKey(ALGORITHM, Buffer.from(wrapped, 'base64'));
    return Buffer.from(res.result);
  }
}
