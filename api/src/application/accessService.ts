import { AppError } from '../domain/errors';
import { emailFromClaims, type Claims } from '../auth/identity';
import type { InviteStore } from '../ports/inviteStore';

/**
 * Decides who may use the app. Access is invite-only: the configured admin is always
 * allowed and can manage the allowlist; everyone else must be on it. Identity/email
 * always come from the validated token, never the request body.
 *
 * The admin is matched by the token's `oid` (stable object id, present in every token)
 * OR by email. The oid match is the reliable one — the email claim can be absent for
 * federated/external accounts whose directory `mail` attribute is empty.
 */
export class AccessService {
  private readonly invites: InviteStore;
  private readonly adminEmail: string;
  private readonly adminOids: Set<string>;

  constructor(invites: InviteStore, adminEmail: string, adminOids: string[] = []) {
    this.invites = invites;
    this.adminEmail = adminEmail.trim().toLowerCase();
    this.adminOids = new Set(adminOids.map((o) => o.trim().toLowerCase()).filter(Boolean));
  }

  isAdmin(claims: Claims): boolean {
    const oid = typeof claims.oid === 'string' ? claims.oid.trim().toLowerCase() : undefined;
    if (oid && this.adminOids.has(oid)) return true;
    const email = emailFromClaims(claims);
    return !!email && !!this.adminEmail && email === this.adminEmail;
  }

  async isInvited(claims: Claims): Promise<boolean> {
    if (this.isAdmin(claims)) return true;
    const email = emailFromClaims(claims);
    if (!email) return false;
    return (await this.invites.get(email)) !== null;
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
