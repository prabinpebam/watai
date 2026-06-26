import { describe, it, expect } from 'vitest';
import { sealSecret, openSecret, keyHint } from './crypto';
import type { KeyWrapper } from '../ports/keyWrapper';

/** Identity wrapper for tests: "wraps" by base64-encoding the DEK (no real KEK needed). */
const idWrapper: KeyWrapper = {
  async wrapKey(dek) {
    return { wrapped: dek.toString('base64'), kekVersion: 'test' };
  },
  async unwrapKey(wrapped) {
    return Buffer.from(wrapped, 'base64');
  },
};

describe('envelope crypto', () => {
  it('round-trips a secret and never stores the plaintext', async () => {
    const sealed = await sealSecret('sk-supersecret-key-1234', idWrapper);
    expect(sealed.ct).not.toContain('supersecret');
    expect(sealed.kekVersion).toBe('test');
    expect(await openSecret(sealed, idWrapper)).toBe('sk-supersecret-key-1234');
  });

  it('uses a fresh DEK + IV each time (same input → different ciphertext)', async () => {
    const a = await sealSecret('same-input', idWrapper);
    const b = await sealSecret('same-input', idWrapper);
    expect(a.ct === b.ct && a.iv === b.iv).toBe(false);
  });

  it('detects tampering via the GCM auth tag', async () => {
    const sealed = await sealSecret('immutable', idWrapper);
    const tampered = { ...sealed, ct: Buffer.from('evil-bytes').toString('base64') };
    await expect(openSecret(tampered, idWrapper)).rejects.toThrow();
  });

  it('round-trips unicode and long secrets', async () => {
    const s = '🔐-ключ-' + 'x'.repeat(2000);
    expect(await openSecret(await sealSecret(s, idWrapper), idWrapper)).toBe(s);
  });
});

describe('keyHint', () => {
  it('returns the last 4 characters', () => {
    expect(keyHint('abcd1234efgh5678')).toBe('…5678');
  });
  it('handles short/empty input', () => {
    expect(keyHint('')).toBe('…');
  });
});
