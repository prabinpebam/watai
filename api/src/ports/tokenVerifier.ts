import type { Claims } from '../auth/identity';

/**
 * Verifies a raw bearer token (signature, issuer, audience, expiry) and returns its
 * claims. The real adapter checks against the Entra JWKS; tests inject a fake.
 */
export interface TokenVerifier {
  verify(token: string): Promise<Claims>;
}
