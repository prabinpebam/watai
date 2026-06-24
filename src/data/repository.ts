import type { Id, ImageRef, Message, Settings, Thread, MemoryItem } from '../lib/types';

export interface SearchHit {
  thread: Thread;
  messageId: Id;
  snippet: string;
}

export interface Repository {
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]>;
  getThread(id: Id): Promise<Thread | null>;
  createThread(init?: Partial<Thread>): Promise<Thread>;
  updateThread(id: Id, patch: Partial<Thread>): Promise<Thread>;
  deleteThread(id: Id): Promise<void>;

  listMessages(threadId: Id): Promise<Message[]>;
  appendMessage(m: Message): Promise<Message>;
  updateMessage(id: Id, patch: Partial<Message>): Promise<Message>;
  deleteMessage(id: Id): Promise<void>;

  putBlob(key: string, blob: Blob): Promise<void>;
  getBlobUrl(key: string): Promise<string>;
  /** Resolve a displayable URL for a generated/attached image, fetching from the cloud
   *  (read SAS) and caching locally when only a cloud `blobPath` is known. */
  resolveImageUrl(image: ImageRef): Promise<string>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listMemory(): Promise<MemoryItem[]>;
  addMemory(m: MemoryItem): Promise<void>;
  removeMemory(id: Id): Promise<void>;

  search(query: string): Promise<SearchHit[]>;

  exportAll(): Promise<Blob>;
  deleteAll(): Promise<void>;
}

/**
 * Extra capability the sync engine needs from the local store: write a server
 * record verbatim without the create/append side effects (no id minting, no
 * thread message-count bump), so pulled changes don't double-count or clobber.
 */
export interface SyncLocalStore extends Repository {
  putMessageRaw(message: Message): Promise<void>;
  /** Read raw blob bytes (for uploading a local image to Blob Storage). */
  getBlob(key: string): Promise<Blob | null>;
}
