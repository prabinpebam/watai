import { describe, it, expect } from 'vitest';
import { authenticate } from './authenticate';
import { AppError } from '../domain/errors';
import type { Claims } from '../auth/identity';
import type { TokenVerifier } from '../ports/tokenVerifier';

function fakeVerifier(claims: Claims = { oid: 'u1' }): TokenVerifier {
  return {
    async verify(token: string): Promise<Claims> {
      if (token === 'good') return claims;
      throw new AppError('unauthorized', 'bad token');
    },
  };
}

describe('authenticate', () => {
  it('returns claims for a valid Bearer token', async () => {
    const claims = await authenticate('Bearer good', fakeVerifier());
    expect(claims.oid).toBe('u1');
  });

  it('is case-insensitive on the scheme', async () => {
    const claims = await authenticate('bearer good', fakeVerifier());
    expect(claims.oid).toBe('u1');
  });

  it('rejects a missing header', async () => {
    await expect(authenticate(undefined, fakeVerifier())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a non-bearer scheme', async () => {
    await expect(authenticate('Basic abc123', fakeVerifier())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a whitespace-only token', async () => {
    await expect(authenticate('Bearer     ', fakeVerifier())).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('propagates verifier rejection (invalid token)', async () => {
    await expect(authenticate('Bearer bad', fakeVerifier())).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
