import { normalizeEmail } from '../../domain/invite';
import type { InviteRecord, InviteStore } from '../../ports/inviteStore';

/** In-memory InviteStore for unit tests and local dev. */
export class InMemoryInviteStore implements InviteStore {
  private byEmail = new Map<string, InviteRecord>();

  async get(email: string): Promise<InviteRecord | null> {
    return this.byEmail.get(normalizeEmail(email)) ?? null;
  }

  async list(): Promise<InviteRecord[]> {
    return [...this.byEmail.values()];
  }

  async put(record: InviteRecord): Promise<InviteRecord> {
    const email = normalizeEmail(record.email);
    const stored = { ...record, email };
    this.byEmail.set(email, stored);
    return stored;
  }

  async remove(email: string): Promise<void> {
    this.byEmail.delete(normalizeEmail(email));
  }
}
