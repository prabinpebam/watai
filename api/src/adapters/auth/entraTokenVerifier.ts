import { createRemoteJWKSet, jwtVerify, type JWTVerifyGetKey } from 'jose';
import { AppError } from '../../domain/errors';
import type { Claims } from '../../auth/identity';
import type { TokenVerifier } from '../../ports/tokenVerifier';

export interface EntraVerifierConfig {
  /** Expected `iss` claim, e.g. https://<tenant>.ciamlogin.com/<tenantId>/v2.0 */
  issuer: string;
  /** Expected `aud` claim — the API's application (client) id or app id URI. */
  audience: string;
  /** OpenID JWKS endpoint used to fetch signing keys. */
  jwksUri: string;
}

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`Missing required environment variable: ${name}`);
  return v;
}

/**
 * Validates Entra (External ID / CIAM) access tokens. Signature is checked against the
 * tenant JWKS (cached + rotated by jose), and issuer/audience/expiry are enforced. Only
 * RS256 is accepted. Any failure collapses to a generic `unauthorized` AppError so token
 * internals never leak to the caller.
 */
export class EntraTokenVerifier implements TokenVerifier {
  private readonly getKey: JWTVerifyGetKey;

  constructor(
    private readonly cfg: EntraVerifierConfig,
    getKey?: JWTVerifyGetKey,
  ) {
    this.getKey = getKey ?? createRemoteJWKSet(new URL(cfg.jwksUri));
  }

  async verify(token: string): Promise<Claims> {
    try {
      const { payload } = await jwtVerify(token, this.getKey, {
        issuer: this.cfg.issuer,
        audience: this.cfg.audience,
        algorithms: ['RS256'],
      });
      return payload as Claims;
    } catch {
      throw new AppError('unauthorized', 'Invalid or expired token.');
    }
  }
}

/** Build an EntraTokenVerifier from AUTH_ISSUER / AUTH_AUDIENCE / AUTH_JWKS_URI. */
export function entraVerifierFromEnv(getKey?: JWTVerifyGetKey): EntraTokenVerifier {
  return new EntraTokenVerifier(
    {
      issuer: requireEnv('AUTH_ISSUER'),
      audience: requireEnv('AUTH_AUDIENCE'),
      jwksUri: requireEnv('AUTH_JWKS_URI'),
    },
    getKey,
  );
}
