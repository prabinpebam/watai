// Local-first sync engine. Every Repository call is served from the local store
// (instant + offline), and mutations also enqueue a sync op. `sync()` later drains
// the queue to the cloud and pulls deltas back (last-write-wins by `updatedAt`).
// All of this is gated on Settings.data.sync, so with sync off it is a pure
// passthrough to the local store. The token provider is injected via the CloudApi,
// so this whole engine is unit-testable without MSAL.
import type { Id, Message, MemoryItem, Settings, Thread } from '../../lib/types';
import type { Repository, SearchHit, SyncLocalStore } from '../repository';
import { CloudError, type CloudApi } from '../cloud/apiClient';
import {
  appendBodyFromMessage,
  messageFromRecord,
  threadFromRecord,
  updateBodyFromPatch,
  type AppendMessageBody,
  type CreateThreadBody,
  type MessageRecord,
  type ThreadRecord,
  type UpdateThreadBody,
} from '../cloud/types';
import type { KvStore } from './kvStore';

const QUEUE_KEY = 'sync.queue';
const THREAD_CURSOR_KEY = 'sync.cursor.threads';
const MSG_CURSOR_PREFIX = 'sync.cursor.messages.';
const SYNC_KEY_PREFIX = 'sync.';

type SyncOp =
  | { kind: 'thread.create'; id: Id; body: CreateThreadBody }
  | { kind: 'thread.update'; id: Id; body: UpdateThreadBody }
  | { kind: 'thread.delete'; id: Id }
  | { kind: 'message.append'; threadId: Id; id: Id; body: AppendMessageBody }
  | { kind: 'settings.save' };

/** The syncable thread flags that are currently set (non-default). */
function flagsPatch(t: Thread): UpdateThreadBody {
  return {
    ...(t.pinned ? { pinned: true } : {}),
    ...(t.archived ? { archived: true } : {}),
  };
}

export class SyncRepository implements Repository {
  constructor(
    private readonly local: SyncLocalStore,
    private readonly cloud: CloudApi,
    private readonly kv: KvStore,
  ) {}

  // ---- reads: always local ----
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]> {
    return this.local.listThreads(opts);
  }
  getThread(id: Id): Promise<Thread | null> {
    return this.local.getThread(id);
  }
  listMessages(threadId: Id): Promise<Message[]> {
    return this.local.listMessages(threadId);
  }
  getBlobUrl(key: string): Promise<string> {
    return this.local.getBlobUrl(key);
  }
  getSettings(): Promise<Settings> {
    return this.local.getSettings();
  }
  listMemory(): Promise<MemoryItem[]> {
    return this.local.listMemory();
  }
  search(query: string): Promise<SearchHit[]> {
    return this.local.search(query);
  }
  exportAll(): Promise<Blob> {
    return this.local.exportAll();
  }

  // ---- mutations: local first, then enqueue ----
  async createThread(init?: Partial<Thread>): Promise<Thread> {
    const thread = await this.local.createThread(init);
    if (!thread.temporary && (await this.syncEnabled())) {
      await this.enqueue({
        kind: 'thread.create',
        id: thread.id,
        body: { id: thread.id, title: thread.title },
      });
      // create only carries title; sync non-default pinned/archived via a follow-up update.
      if (thread.pinned || thread.archived) {
        await this.enqueueThreadUpdate(thread.id, flagsPatch(thread));
      }
    }
    return thread;
  }

  async updateThread(id: Id, patch: Partial<Thread>): Promise<Thread> {
    const updated = await this.local.updateThread(id, patch);
    if (!updated.temporary && (await this.syncEnabled())) {
      const body = updateBodyFromPatch(patch);
      if (Object.keys(body).length > 0) await this.enqueueThreadUpdate(id, body);
    }
    return updated;
  }

  async deleteThread(id: Id): Promise<void> {
    const existing = await this.local.getThread(id);
    await this.local.deleteThread(id);
    if (existing && !existing.temporary && (await this.syncEnabled())) {
      await this.enqueueThreadDelete(id);
    }
  }

  async appendMessage(m: Message): Promise<Message> {
    const saved = await this.local.appendMessage(m);
    if (await this.syncEnabled()) {
      const thread = await this.local.getThread(m.threadId);
      if (thread && !thread.temporary) {
        await this.enqueue({
          kind: 'message.append',
          threadId: m.threadId,
          id: saved.id,
          body: appendBodyFromMessage(saved),
        });
      }
    }
    return saved;
  }

  // No server endpoints for message edit/delete or blobs/memory — keep them local.
  updateMessage(id: Id, patch: Partial<Message>): Promise<Message> {
    return this.local.updateMessage(id, patch);
  }
  deleteMessage(id: Id): Promise<void> {
    return this.local.deleteMessage(id);
  }
  putBlob(key: string, blob: Blob): Promise<void> {
    return this.local.putBlob(key, blob);
  }
  addMemory(m: MemoryItem): Promise<void> {
    return this.local.addMemory(m);
  }
  removeMemory(id: Id): Promise<void> {
    return this.local.removeMemory(id);
  }

  async saveSettings(s: Settings): Promise<void> {
    await this.local.saveSettings(s);
    if (s.data.sync) await this.enqueue({ kind: 'settings.save' });
  }

  async deleteAll(): Promise<void> {
    await this.local.deleteAll();
    for (const key of await this.kv.keys()) {
      if (key.startsWith(SYNC_KEY_PREFIX)) await this.kv.delete(key);
    }
  }

  // ---- sync orchestration ----
  /** Push local changes then pull remote deltas. No-op when sync is disabled. */
  async sync(): Promise<void> {
    if (!(await this.syncEnabled())) return;
    await this.push();
    await this.pull();
  }

  /** Enqueue every existing non-temporary local thread, its messages, and settings. */
  async backfill(): Promise<void> {
    const threads = await this.local.listThreads({ includeArchived: true });
    for (const t of threads) {
      if (t.temporary) continue;
      await this.enqueue({ kind: 'thread.create', id: t.id, body: { id: t.id, title: t.title } });
      if (t.pinned || t.archived) await this.enqueueThreadUpdate(t.id, flagsPatch(t));
      for (const m of await this.local.listMessages(t.id)) {
        await this.enqueue({
          kind: 'message.append',
          threadId: t.id,
          id: m.id,
          body: appendBodyFromMessage(m),
        });
      }
    }
    await this.enqueue({ kind: 'settings.save' });
  }

  async push(): Promise<void> {
    if (!(await this.syncEnabled())) return;
    let queue = await this.loadQueue();
    while (queue.length > 0) {
      const op = queue[0];
      try {
        await this.applyOp(op);
      } catch (err) {
        if (!(err instanceof CloudError) || err.retryable) break; // transient: stop, keep op
        // permanent (4xx): drop the op and continue
        console.warn(`[sync] dropping ${op.kind}: ${(err as CloudError).code}`);
      }
      queue = queue.slice(1);
      await this.saveQueue(queue);
    }
  }

  async pull(): Promise<void> {
    if (!(await this.syncEnabled())) return;
    const cursor = await this.kv.get<string>(THREAD_CURSOR_KEY);
    const records = await this.cloud.listThreads({ includeArchived: true, since: cursor });
    let maxUpdated = cursor ?? '';
    for (const rec of records) {
      await this.mergeThread(rec);
      if (rec.updatedAt > maxUpdated) maxUpdated = rec.updatedAt;
      if (!rec.deletedAt) await this.pullMessages(rec.id);
    }
    if (maxUpdated && maxUpdated !== cursor) await this.kv.set(THREAD_CURSOR_KEY, maxUpdated);
  }

  // ---- internals ----
  private async syncEnabled(): Promise<boolean> {
    return (await this.local.getSettings()).data.sync;
  }

  private async applyOp(op: SyncOp): Promise<void> {
    switch (op.kind) {
      case 'thread.create':
        await this.cloud.createThread(op.body);
        return;
      case 'thread.update':
        await this.cloud.updateThread(op.id, op.body);
        return;
      case 'thread.delete':
        await this.cloud.deleteThread(op.id);
        return;
      case 'message.append':
        await this.cloud.appendMessage(op.threadId, op.body);
        return;
      case 'settings.save':
        await this.cloud.patchSettings(await this.local.getSettings());
        return;
    }
  }

  private async mergeThread(rec: ThreadRecord): Promise<void> {
    const incoming = threadFromRecord(rec);
    const existing = await this.local.getThread(rec.id);
    if (rec.deletedAt) {
      if (existing) await this.local.deleteThread(rec.id);
      return;
    }
    if (!existing) {
      await this.local.createThread(incoming);
    } else if (incoming.updatedAt > existing.updatedAt) {
      await this.local.updateThread(rec.id, incoming);
    }
  }

  private async pullMessages(threadId: Id): Promise<void> {
    const key = MSG_CURSOR_PREFIX + threadId;
    const cursor = await this.kv.get<string>(key);
    const records = await this.cloud.listMessages(threadId, { since: cursor });
    if (records.length === 0) return;
    const known = new Set((await this.local.listMessages(threadId)).map((m) => m.id));
    let maxCreated = cursor ?? '';
    for (const rec of records) {
      if (!known.has(rec.id)) await this.local.putMessageRaw(messageFromRecord(rec as MessageRecord));
      if (rec.createdAt > maxCreated) maxCreated = rec.createdAt;
    }
    if (maxCreated && maxCreated !== cursor) await this.kv.set(key, maxCreated);
  }

  private loadQueue(): Promise<SyncOp[]> {
    return this.kv.get<SyncOp[]>(QUEUE_KEY).then((q) => q ?? []);
  }
  private saveQueue(queue: SyncOp[]): Promise<void> {
    return this.kv.set(QUEUE_KEY, queue);
  }

  private async enqueue(op: SyncOp): Promise<void> {
    const queue = await this.loadQueue();
    queue.push(op);
    await this.saveQueue(queue);
  }

  /** Coalesce repeated updates to the same thread into a single pending op. */
  private async enqueueThreadUpdate(id: Id, body: UpdateThreadBody): Promise<void> {
    const queue = await this.loadQueue();
    const pending = queue.find(
      (op): op is Extract<SyncOp, { kind: 'thread.update' }> =>
        op.kind === 'thread.update' && op.id === id,
    );
    if (pending) {
      Object.assign(pending.body, body);
    } else {
      queue.push({ kind: 'thread.update', id, body });
    }
    await this.saveQueue(queue);
  }

  /**
   * If the thread was created locally but never pushed yet, drop all of its pending
   * ops and skip the delete entirely (the server never knew it existed). Otherwise
   * enqueue the delete and discard any pending updates for it.
   */
  private async enqueueThreadDelete(id: Id): Promise<void> {
    const queue = await this.loadQueue();
    const unsynced = queue.some((op) => op.kind === 'thread.create' && op.id === id);
    const kept = queue.filter((op) => {
      if (op.kind === 'thread.create' || op.kind === 'thread.update') return op.id !== id;
      if (op.kind === 'message.append') return op.threadId !== id;
      return true;
    });
    if (!unsynced) kept.push({ kind: 'thread.delete', id });
    await this.saveQueue(kept);
  }
}
