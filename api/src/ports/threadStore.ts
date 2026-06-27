import type { ThreadLock } from '../domain/threadLock';

/** A document uploaded into the thread's vector store (thread-scoped file search). */
export interface ThreadFileMeta {
  /** Azure OpenAI file id (also the vector-store file id) — the delete key. */
  fileId: string;
  name: string;
  bytes: number;
  status: 'indexing' | 'ready' | 'error';
  createdAt: string;
}

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
  /** Vector store id holding the thread's uploaded documents (thread-scoped file search). */
  vectorStoreId?: string;
  /** Documents uploaded into this thread's knowledge base. */
  files?: ThreadFileMeta[];
  /** Active run lock (set while a device generates a reply); null/absent when free. */
  lock?: ThreadLock | null;
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

/**
 * Atomic compare-and-set used by the run-lock flow. `getForUpdate` reads the record together
 * with a concurrency token (the Cosmos `_etag`); `putIfMatch` writes only if that token is
 * still current, returning null when another writer won the race. This makes "check the lock,
 * then take it" a single atomic step, so two devices can never both acquire the same thread.
 */
export interface ThreadLockStore {
  getForUpdate(userId: string, id: string): Promise<{ record: ThreadRecord; etag: string } | null>;
  putIfMatch(record: ThreadRecord, etag: string): Promise<ThreadRecord | null>;
}
