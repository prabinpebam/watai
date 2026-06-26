import { DefaultAzureCredential } from '@azure/identity';
import { KeyClient, CryptographyClient } from '@azure/keyvault-keys';
import type { KeyWrapper, WrappedKey } from '../../ports/keyWrapper';

const ALGORITHM = 'RSA-OAEP-256';

/**
 * Production KEK adapter: an Azure Key Vault RSA key wraps/unwraps the per-record DEK
 * (RSA-OAEP-256). The Functions app authenticates via Managed Identity, so no secret is
 * needed to reach the secret-wrapping key. `kekVersion` stores the exact versioned key id
 * used to wrap, so a rotated KEK can still unwrap older records.
 */
export class KeyVaultWrapper implements KeyWrapper {
  private readonly credential = new DefaultAzureCredential();
  private wrapClient: Promise<CryptographyClient> | undefined;

  constructor(
    private readonly vaultUrl = process.env.KEY_VAULT_URI ?? '',
    private readonly keyName = process.env.CRED_KEK_NAME ?? 'watai-cred-kek',
  ) {}

  /** Crypto client bound to the *current* KEK version (used for wrapping). */
  private wrapper(): Promise<CryptographyClient> {
    if (!this.wrapClient) {
      if (!this.vaultUrl) throw new Error('KEY_VAULT_URI is not set.');
      const keyClient = new KeyClient(this.vaultUrl, this.credential);
      this.wrapClient = keyClient
        .getKey(this.keyName)
        .then((k) => new CryptographyClient(k.id!, this.credential));
    }
    return this.wrapClient;
  }

  async wrapKey(dek: Buffer): Promise<WrappedKey> {
    const client = await this.wrapper();
    const res = await client.wrapKey(ALGORITHM, dek);
    return { wrapped: Buffer.from(res.result).toString('base64'), kekVersion: res.keyID ?? this.keyName };
  }

  async unwrapKey(wrapped: string, kekVersion: string): Promise<Buffer> {
    // Bind to the exact versioned key id that wrapped this DEK (rotation-safe).
    const client = new CryptographyClient(kekVersion, this.credential);
    const res = await client.unwrapKey(ALGORITHM, Buffer.from(wrapped, 'base64'));
    return Buffer.from(res.result);
  }
}
