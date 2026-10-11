export interface InvitationPrincipal {
  issuer: string;
  objectId: string;
}

/** An invitation whose verified redemption binds an immutable principal. */
export interface InviteRecord {
  /** Lowercased email — the stable id. */
  email: string;
  /** Email of the admin who created the invite. */
  invitedBy: string;
  createdAt: string;
  principal?: InvitationPrincipal;
  redeemedAt?: string;
}

export interface InviteStore {
  get(email: string): Promise<InviteRecord | null>;
  getByPrincipal(principal: InvitationPrincipal): Promise<InviteRecord | null>;
  redeem(email: string, principal: InvitationPrincipal, redeemedAt: string): Promise<InviteRecord | null>;
  list(): Promise<InviteRecord[]>;
  put(record: InviteRecord): Promise<InviteRecord>;
  remove(email: string): Promise<void>;
}
