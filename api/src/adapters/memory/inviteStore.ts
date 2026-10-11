import { normalizeEmail } from '../../domain/invite';
import type { InvitationPrincipal, InviteRecord, InviteStore } from '../../ports/inviteStore';

/** In-memory InviteStore for unit tests and local dev. */
export class InMemoryInviteStore implements InviteStore {
  private byEmail = new Map<string, InviteRecord>();

  async get(email: string): Promise<InviteRecord | null> {
    const record = this.byEmail.get(normalizeEmail(email));
    return record ? structuredClone(record) : null;
  }

  async getByPrincipal(principal: InvitationPrincipal): Promise<InviteRecord | null> {
    if (!principal.issuer.trim() || !principal.objectId.trim()) return null;
    const record = [...this.byEmail.values()].find(invite => invite.principal?.issuer === principal.issuer && invite.principal?.objectId === principal.objectId);
    return record ? structuredClone(record) : null;
  }

  async redeem(email: string, principal: InvitationPrincipal, redeemedAt: string): Promise<InviteRecord | null> {
    if (!principal.issuer.trim() || !principal.objectId.trim()) return null;
    const key = normalizeEmail(email);
    const record = this.byEmail.get(key);
    if (!record) return null;
    if (record.principal) {
      return record.principal.issuer === principal.issuer && record.principal.objectId === principal.objectId ? structuredClone(record) : null;
    }
    const bound = { ...record, principal: { ...principal }, redeemedAt };
    this.byEmail.set(key, bound);
    return structuredClone(bound);
  }

  async list(): Promise<InviteRecord[]> {
    return structuredClone([...this.byEmail.values()]);
  }

  async put(record: InviteRecord): Promise<InviteRecord> {
    const email = normalizeEmail(record.email);
    const existing = this.byEmail.get(email);
    if (existing) return structuredClone(existing);
    const stored = { email, invitedBy: record.invitedBy, createdAt: record.createdAt };
    this.byEmail.set(email, stored);
    return { ...stored };
  }

  async remove(email: string): Promise<void> {
    this.byEmail.delete(normalizeEmail(email));
  }
}
