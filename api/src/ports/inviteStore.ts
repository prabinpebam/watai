/** An allowlisted email permitted to use the app (Cosmos `invites` container). */
export interface InviteRecord {
  /** Lowercased email — the stable id. */
  email: string;
  /** Email of the admin who created the invite. */
  invitedBy: string;
  createdAt: string;
}

export interface InviteStore {
  get(email: string): Promise<InviteRecord | null>;
  list(): Promise<InviteRecord[]>;
  put(record: InviteRecord): Promise<InviteRecord>;
  remove(email: string): Promise<void>;
}
