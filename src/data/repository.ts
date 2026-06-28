import type { Id, ImageRef, Message, Settings, Thread, ThreadLock } from '../lib/types';
import type { CreateMemoryBody, ListMemoryQuery, MemoryRecord, PatchMemoryBody } from './cloud/types';

export interface SearchHit {
  thread: Thread;
  messageId: Id;
  snippet: string;
}

/** Outcome of trying to take a thread's run lock before generating a reply. */
export interface RunLockResult {
  acquired: boolean;
  /** When not acquired, the other device that currently holds the lock (for the UX). */
  heldBy?: { deviceLabel: string; since: string };
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

  /** Take the thread's run lock before generating a reply, so two devices never generate at once.
   *  A no-op (always acquired) with sync off or for local-only threads. */
  acquireRunLock(threadId: Id): Promise<RunLockResult>;
  /** Release the thread's run lock once the run ends (best-effort; safe to call when not held). */
  releaseRunLock(threadId: Id): Promise<void>;
  /** Read the thread's current run lock from the server (null when free, sync off, or local-only).
   *  Used to proactively show/clear the "another device is responding" UX on the open thread. */
  getThreadLock(threadId: Id): Promise<ThreadLock | null>;

  putBlob(key: string, blob: Blob): Promise<void>;
  getBlobUrl(key: string): Promise<string>;
  /** Read raw blob bytes (e.g. an uploaded image, for vision input or an edit reference). */
  getBlob(key: string): Promise<Blob | null>;
  /** Resolve a displayable URL for a generated/attached image, fetching from the cloud
   *  (read SAS) and caching locally when only a cloud `blobPath` is known. */
  resolveImageUrl(image: ImageRef): Promise<string>;
  /** Resolve any asset (generated image OR uploaded attachment) to a usable URL; fetches +
   *  caches from Blob Storage via a read SAS when only a cloud `blobPath` is known. */
  resolveAssetUrl(asset: { id: string; localBlobKey?: string; blobPath?: string }): Promise<string>;

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listMemory(query?: ListMemoryQuery): Promise<MemoryRecord[]>;
  addMemory(input: CreateMemoryBody): Promise<MemoryRecord>;
  updateMemory(id: Id, patch: PatchMemoryBody): Promise<MemoryRecord>;
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
}
