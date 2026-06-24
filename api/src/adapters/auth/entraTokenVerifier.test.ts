import { describe, it, expect, beforeAll } from 'vitest';
import {
  SignJWT,
  exportJWK,
  generateKeyPair,
  createLocalJWKSet,
  type JWTVerifyGetKey,
  type KeyLike,
} from 'jose';
import { EntraTokenVerifier } from './entraTokenVerifier';

const ISSUER = 'https://watai.ciamlogin.com/tenant-id/v2.0';
const AUDIENCE = 'api://watai';
const KID = 'test-key-1';

describe('EntraTokenVerifier', () => {
  let privateKey: KeyLike;
  let getKey: JWTVerifyGetKey;
  let verifier: EntraTokenVerifier;

  beforeAll(async () => {
    const kp = await generateKeyPair('RS256');
    privateKey = kp.privateKey;
    const jwk = await exportJWK(kp.publicKey);
    jwk.kid = KID;
    jwk.alg = 'RS256';
    getKey = createLocalJWKSet({ keys: [jwk] });
    verifier = new EntraTokenVerifier({ issuer: ISSUER, audience: AUDIENCE, jwksUri: 'https://unused.example' }, getKey);
  });

  async function sign(
    over: { iss?: string; aud?: string; expSeconds?: number; claims?: Record<string, unknown>; key?: KeyLike } = {},
  ): Promise<string> {
    const jwt = new SignJWT({ oid: 'user-123', ...over.claims })
      .setProtectedHeader({ alg: 'RS256', kid: KID })
      .setIssuedAt()
      .setIssuer(over.iss ?? ISSUER)
      .setAudience(over.aud ?? AUDIENCE)
      .setExpirationTime(over.expSeconds ?? Math.floor(Date.now() / 1000) + 3600);
    return jwt.sign(over.key ?? privateKey);
  }

  it('accepts a valid token and returns its claims', async () => {
    const claims = await verifier.verify(await sign());
    expect(claims.oid).toBe('user-123');
  });

  it('rejects an expired token', async () => {
    const token = await sign({ expSeconds: Math.floor(Date.now() / 1000) - 60 });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a wrong issuer', async () => {
    const token = await sign({ iss: 'https://evil.example.com/v2.0' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a wrong audience', async () => {
    const token = await sign({ aud: 'api://someone-else' });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a token signed by a different key', async () => {
    const other = await generateKeyPair('RS256');
    const token = await sign({ key: other.privateKey });
    await expect(verifier.verify(token)).rejects.toMatchObject({ code: 'unauthorized' });
  });

  it('rejects a malformed token', async () => {
    await expect(verifier.verify('not-a-jwt')).rejects.toMatchObject({ code: 'unauthorized' });
  });
});
