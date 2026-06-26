import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import type { KeyWrapper, WrappedKey } from '../../ports/keyWrapper';

/**
 * Local/dev KEK adapter: AES-256-GCM wrap of the DEK under a master key supplied via
 * `CRED_MASTER_KEY` (base64-encoded 32 bytes). For local `func start` and tests only —
 * production uses {@link KeyVaultWrapper}. The wrapped blob is `iv(12) | tag(16) | ct`.
 */
export class LocalKeyWrapper implements KeyWrapper {
  private readonly master: Buffer;

  constructor(masterB64: string | undefined = process.env.CRED_MASTER_KEY) {
    if (!masterB64) throw new Error('CRED_MASTER_KEY is not set (base64 32-byte key).');
    this.master = Buffer.from(masterB64, 'base64');
    if (this.master.length !== 32) {
      throw new Error('CRED_MASTER_KEY must decode to exactly 32 bytes.');
    }
  }

  async wrapKey(dek: Buffer): Promise<WrappedKey> {
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.master, iv);
    const ct = Buffer.concat([cipher.update(dek), cipher.final()]);
    const tag = cipher.getAuthTag();
    return { wrapped: Buffer.concat([iv, tag, ct]).toString('base64'), kekVersion: 'local' };
  }

  async unwrapKey(wrapped: string): Promise<Buffer> {
    const buf = Buffer.from(wrapped, 'base64');
    const iv = buf.subarray(0, 12);
    const tag = buf.subarray(12, 28);
    const ct = buf.subarray(28);
    const decipher = createDecipheriv('aes-256-gcm', this.master, iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]);
  }
}
