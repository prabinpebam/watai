import { AppError } from '../domain/errors';

/** Verified token claims (signature/issuer/audience already checked by the host). */
export interface Claims {
  sub?: string;
  oid?: string;
  [key: string]: unknown;
}

export interface Identity {
  userId: string;
}

/**
 * Derive the caller's identity from validated claims. Prefers the Entra `oid`
 * (stable per-tenant object id) and falls back to `sub`. Identity is NEVER read
 * from the request body — only from the token (prevents IDOR via spoofed ids).
 */
export function identityFromClaims(claims: Claims): Identity {
  const userId = (claims.oid ?? claims.sub)?.toString().trim();
  if (!userId) {
    throw new AppError('unauthorized', 'Token is missing a subject claim.');
  }
  return { userId };
}
