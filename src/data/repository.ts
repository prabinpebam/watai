import type { Id, Message, Settings, Thread, MemoryItem } from '../lib/types';

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

  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listMemory(): Promise<MemoryItem[]>;
  addMemory(m: MemoryItem): Promise<void>;
  removeMemory(id: Id): Promise<void>;

  search(query: string): Promise<SearchHit[]>;

  exportAll(): Promise<Blob>;
  deleteAll(): Promise<void>;
}
