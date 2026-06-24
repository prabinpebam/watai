import { AppError } from '../domain/errors';
import { emailFromClaims, type Claims } from '../auth/identity';
import type { InviteStore } from '../ports/inviteStore';

/**
 * Decides who may use the app. Access is invite-only: the configured admin is always
 * allowed and can manage the allowlist; everyone else must be on it. Identity/email
 * always come from the validated token, never the request body.
 */
export class AccessService {
  constructor(
    private readonly invites: InviteStore,
    private readonly adminEmail: string,
  ) {}

  isAdmin(email?: string): boolean {
    return !!email && !!this.adminEmail && email.toLowerCase() === this.adminEmail.toLowerCase();
  }

  async isInvited(email?: string): Promise<boolean> {
    if (!email) return false;
    if (this.isAdmin(email)) return true;
    return (await this.invites.get(email)) !== null;
  }

  /** Authorizer for data routes: the caller must be the admin or an invited user. */
  async requireInvited(claims: Claims): Promise<void> {
    if (!(await this.isInvited(emailFromClaims(claims)))) {
      throw new AppError('forbidden', 'You are not on the invite list. Ask the admin for access.');
    }
  }

  /** Authorizer for invite-management routes: the caller must be the admin. */
  async requireAdmin(claims: Claims): Promise<void> {
    if (!this.isAdmin(emailFromClaims(claims))) {
      throw new AppError('forbidden', 'Admin access required.');
    }
  }
}
