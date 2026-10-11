import { AppError } from '../domain/errors';
import { emailFromClaims, type Claims } from '../auth/identity';
import type { InviteStore } from '../ports/inviteStore';

/**
 * Decides who may use the app. Access is invite-only: the configured admin is always
 * allowed and can manage the allowlist; everyone else must be on it. Identity/email
 * always come from the validated token, never the request body.
 *
 * Admin authority requires a configured immutable token object id.
 */
export class AccessService {
  private readonly invites: InviteStore;
  private readonly adminOids: Set<string>;

  constructor(invites: InviteStore, _adminEmail: string, adminOids: string[] = []) {
    this.invites = invites;
    this.adminOids = new Set(adminOids.map((oid) => oid.trim().toLowerCase()).filter(Boolean));
  }

  isAdmin(claims: Claims): boolean {
    const oid = typeof claims.oid === 'string' ? claims.oid.trim().toLowerCase() : undefined;
    return !!oid && this.adminOids.has(oid);
  }

  async isInvited(claims: Claims): Promise<boolean> {
    if (this.isAdmin(claims)) return true;
    const issuer = typeof claims.iss === 'string' ? claims.iss.trim() : '';
    const objectId = typeof claims.oid === 'string' ? claims.oid.trim().toLowerCase() : '';
    if (!issuer || !objectId) return false;
    const principal = { issuer, objectId };
    if (await this.invites.getByPrincipal(principal)) return true;
    if (claims.email_verified !== true || typeof claims.email !== 'string') return false;
    const email = emailFromClaims({ email: claims.email });
    if (!email) return false;
    return (await this.invites.redeem(email, principal, new Date().toISOString())) !== null;
  }

  /** Authorizer for data routes: the caller must be the admin or an invited user. */
  async requireInvited(claims: Claims): Promise<void> {
    if (!(await this.isInvited(claims))) {
      throw new AppError('forbidden', 'You are not on the invite list. Ask the admin for access.');
    }
  }

  /** Authorizer for invite-management routes: the caller must be the admin. */
  async requireAdmin(claims: Claims): Promise<void> {
    if (!this.isAdmin(claims)) {
      throw new AppError('forbidden', 'Admin access required.');
    }
  }
}
