/** Server-side thread document (mirrors the Cosmos `threads` container, partition key /userId). */
export interface ThreadRecord {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  messageCount: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export interface ListOptions {
  includeArchived?: boolean;
  /** Include soft-deleted tombstones (used by sync delta pulls, not normal lists). */
  includeDeleted?: boolean;
  /** Delta cursor: return only rows with `updatedAt` strictly greater than this. */
  since?: string;
}

/**
 * Persistence port for threads. Implementations are partition-scoped by `userId`
 * (Cosmos partition key /userId), so a query in one user's partition can never see
 * another user's documents — IDOR is prevented structurally.
 */
export interface ThreadStore {
  get(userId: string, id: string): Promise<ThreadRecord | null>;
  list(userId: string, opts?: ListOptions): Promise<ThreadRecord[]>;
  put(record: ThreadRecord): Promise<ThreadRecord>;
}
