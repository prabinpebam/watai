import { AppError } from '../domain/errors';
import type { Claims } from '../auth/identity';
import type { TokenVerifier } from '../ports/tokenVerifier';

const BEARER = /^Bearer\s+(.+)$/i;

/**
 * Extract the bearer token from an Authorization header and verify it, returning the
 * validated claims. Identity is later derived from these claims (never the body), so this
 * is the single choke point where an unauthenticated request is rejected with 401.
 */
export async function authenticate(
  authHeader: string | undefined | null,
  verifier: TokenVerifier,
): Promise<Claims> {
  const token = authHeader?.match(BEARER)?.[1]?.trim();
  if (!token) {
    throw new AppError('unauthorized', 'Missing or malformed Authorization header.');
  }
  return verifier.verify(token);
}
