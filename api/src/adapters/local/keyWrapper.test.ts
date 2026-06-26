import { describe, it, expect } from 'vitest';
import { LocalKeyWrapper } from './keyWrapper';
import { sealSecret, openSecret } from '../../domain/crypto';

const master = Buffer.alloc(32, 7).toString('base64');

describe('LocalKeyWrapper', () => {
  it('seals and opens a secret end-to-end', async () => {
    const w = new LocalKeyWrapper(master);
    const sealed = await sealSecret('sk-local-test-1234', w);
    expect(sealed.kekVersion).toBe('local');
    expect(await openSecret(sealed, w)).toBe('sk-local-test-1234');
  });

  it('rejects a master key that is not 32 bytes', () => {
    expect(() => new LocalKeyWrapper(Buffer.alloc(16).toString('base64'))).toThrow();
    expect(() => new LocalKeyWrapper(undefined)).toThrow();
  });

  it('fails to unwrap a tampered blob (GCM)', async () => {
    const w = new LocalKeyWrapper(master);
    const sealed = await sealSecret('x', w);
    const bad = Buffer.from(sealed.wrappedDek, 'base64');
    bad[29] ^= 0xff; // flip a ciphertext byte
    await expect(openSecret({ ...sealed, wrappedDek: bad.toString('base64') }, w)).rejects.toThrow();
  });
});
