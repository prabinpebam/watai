import { randomBytes, createCipheriv, createDecipheriv } from 'node:crypto';
import type { KeyWrapper } from '../ports/keyWrapper';

/**
 * Envelope-encrypted secret: the plaintext is AES-256-GCM encrypted under a fresh random
 * data-encryption key (DEK), and the DEK itself is wrapped by the KEK (via a {@link KeyWrapper}).
 * Only this shape is persisted — never the plaintext, never the bare DEK.
 */
export interface SealedSecret {
  /** base64 ciphertext. */
  ct: string;
  /** base64 12-byte GCM nonce. */
  iv: string;
  /** base64 GCM authentication tag. */
  tag: string;
  /** base64 KEK-wrapped DEK. */
  wrappedDek: string;
  /** KEK version that wrapped the DEK. */
  kekVersion: string;
}

const ALGO = 'aes-256-gcm';

/** Seal a secret: AES-256-GCM under a fresh random DEK, then wrap the DEK with the KEK. */
export async function sealSecret(plaintext: string, wrapper: KeyWrapper): Promise<SealedSecret> {
  const dek = randomBytes(32);
  const iv = randomBytes(12);
  try {
    const cipher = createCipheriv(ALGO, dek, iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    const { wrapped, kekVersion } = await wrapper.wrapKey(dek);
    return {
      ct: ct.toString('base64'),
      iv: iv.toString('base64'),
      tag: tag.toString('base64'),
      wrappedDek: wrapped,
      kekVersion,
    };
  } finally {
    dek.fill(0);
  }
}

/** Open a sealed secret. Throws if the ciphertext or tag was tampered with (GCM verify). */
export async function openSecret(sealed: SealedSecret, wrapper: KeyWrapper): Promise<string> {
  const dek = await wrapper.unwrapKey(sealed.wrappedDek, sealed.kekVersion);
  try {
    const decipher = createDecipheriv(ALGO, dek, Buffer.from(sealed.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(sealed.tag, 'base64'));
    const pt = Buffer.concat([
      decipher.update(Buffer.from(sealed.ct, 'base64')),
      decipher.final(),
    ]);
    return pt.toString('utf8');
  } finally {
    dek.fill(0);
  }
}

/** Last-4 hint shown in the UI so a user can recognise which key is stored (never the key). */
export function keyHint(secret: string): string {
  const tail = secret.trim().slice(-4);
  return tail ? `…${tail}` : '…';
}
