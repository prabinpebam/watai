import { AppError } from '../domain/errors';

/** Verified token claims (signature/issuer/audience already checked by the host). */
export interface Claims {
  sub?: string;
  oid?: string;
  email?: string;
  preferred_username?: string;
  emails?: string[];
  [key: string]: unknown;
}

export interface Identity {
  userId: string;
  email?: string;
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
  const email = emailFromClaims(claims);
  return email ? { userId, email } : { userId };
}

/** Extract the caller's email from common Entra/CIAM claim shapes (lowercased). */
export function emailFromClaims(claims: Claims): string | undefined {
  const raw =
    claims.email ??
    claims.preferred_username ??
    (Array.isArray(claims.emails) ? claims.emails[0] : undefined);
  const email = typeof raw === 'string' ? raw.trim().toLowerCase() : undefined;
  return email || undefined;
}
