// Local-first sync engine. Every Repository call is served from the local store
// (instant + offline), and mutations also enqueue a sync op. `sync()` later drains
// the queue to the cloud and pulls deltas back (last-write-wins by `updatedAt`).
// All of this is gated on Settings.data.sync, so with sync off it is a pure
// passthrough to the local store. The token provider is injected via the CloudApi,
// so this whole engine is unit-testable without MSAL.
import type { Id, ImageRef, Message, Settings, Thread, ThreadLock } from '../../lib/types';
import type { Repository, RunLockResult, SearchHit, SyncLocalStore } from '../repository';
import { CloudError, type CloudApi } from '../cloud/apiClient';
import { getDeviceId, getDeviceLabel } from '../../lib/device';
import {
  appendBodyFromMessage,
  messageFromRecord,
  threadFromRecord,
  updateBodyFromPatch,
  type AppendMessageBody,
  type CreateMemoryBody,
  type CreateThreadBody,
  type ListMemoryQuery,
  type MemoryRecord,
  type PatchMemoryBody,
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

function isStreamingAssistant(message: Message): boolean {
  return message.role === 'assistant' && message.status === 'streaming';
}

function shouldReplaceKnownMessage(existing: Message, incoming: MessageRecord): boolean {
  return isStreamingAssistant(existing) && existing.role === incoming.role;
}

export class SyncRepository implements Repository {
  constructor(
    private readonly local: SyncLocalStore,
    private readonly cloud: CloudApi,
    private readonly kv: KvStore,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  // ---- reads: always local ----
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]> {
    return this.local.listThreads(opts);
  }
  getThread(id: Id): Promise<Thread | null> {
    return this.local.getThread(id);
  }
  async listMessages(threadId: Id): Promise<Message[]> {
    const messages = await this.local.listMessages(threadId);
    if (messages.some(isStreamingAssistant) && (await this.syncEnabled())) {
      await this.pullMessages(threadId, { forceFull: true }).catch(() => false);
      return this.local.listMessages(threadId);
    }
    return messages;
  }
  getBlobUrl(key: string): Promise<string> {
    return this.local.getBlobUrl(key);
  }

  /** Resolve an asset URL (generated image OR uploaded attachment): prefer the local cache;
   *  otherwise download from Blob Storage via a read SAS and cache it locally so other devices
   *  and reloads work offline after. */
  async resolveAssetUrl(asset: { id: string; localBlobKey?: string; blobPath?: string }): Promise<string> {
    // The cache key is the explicit local key, else a stable per-asset cloud key. Always check
    // it FIRST so a once-downloaded cloud asset is never re-fetched (faster + no repeat SAS/egress).
    const cacheKey = asset.localBlobKey ?? `cloud-${asset.id}`;
    const cached = await this.local.getBlobUrl(cacheKey);
    if (cached) return cached;
    if (asset.blobPath && /^(data:|blob:|https?:)/.test(asset.blobPath)) return asset.blobPath;
    if (asset.blobPath && (await this.syncEnabled())) {
      const parsed = parseBlobPath(asset.blobPath);
      if (!parsed) return '';
      try {
        const sas = await this.cloud.requestSas({
          threadId: parsed.threadId,
          assetId: parsed.assetId,
          op: 'read',
          contentType: parsed.contentType,
        });
        const res = await this.fetchImpl(sas.url);
        if (!res.ok) return '';
        const blob = await res.blob();
        await this.local.putBlob(cacheKey, blob);
        return this.local.getBlobUrl(cacheKey);
      } catch {
        return '';
      }
    }
    return '';
  }

  /** Resolve a generated image's URL (delegates to the shared asset resolver). */
  resolveImageUrl(image: ImageRef): Promise<string> {
    return this.resolveAssetUrl(image);
  }
  getSettings(): Promise<Settings> {
    return this.local.getSettings();
  }
  async listMemory(query?: ListMemoryQuery): Promise<MemoryRecord[]> {
    if (await this.syncEnabled()) {
      try {
        const out = await this.cloud.listMemory(query);
        return out.memories;
      } catch {
        return this.local.listMemory(query);
      }
    }
    return this.local.listMemory(query);
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

  /** Merge a server-authored message into the local store verbatim (no re-queue). Used by the
   *  server-run streaming finalizer so the same device lands the terminal assistant snapshot
   *  immediately; cross-device sync also reconciles later server snapshots by cursor. */
  async mergeServerMessage(m: Message): Promise<void> {
    await this.local.putMessageRaw(m);
  }

  /** Take the thread's run lock before generating a reply, so two devices never generate at once.
   *  Best-effort: a network failure (offline) does NOT block local generation — only a live lock
   *  held by another device does. */
  async acquireRunLock(threadId: Id): Promise<RunLockResult> {
    if (!(await this.syncEnabled())) return { acquired: true };
    const thread = await this.local.getThread(threadId);
    if (!thread || thread.temporary) return { acquired: true };
    try {
      await this.cloud.acquireThreadLock(threadId, {
        deviceId: getDeviceId(),
        deviceLabel: getDeviceLabel(),
      });
      return { acquired: true };
    } catch (err) {
      if (err instanceof CloudError && err.code === 'conflict') {
        const lock = (err.details as { lock?: ThreadLock } | undefined)?.lock;
        return {
          acquired: false,
          ...(lock ? { heldBy: { deviceLabel: lock.deviceLabel, since: lock.acquiredAt } } : {}),
        };
      }
      // Offline / auth / server error: proceed (single-device best-effort; the server stays the
      // ultimate guard, and a missed lock only matters when another device is genuinely active).
      return { acquired: true };
    }
  }

  /** Release the thread's run lock once the run ends. Best-effort and idempotent. */
  async releaseRunLock(threadId: Id): Promise<void> {
    if (!(await this.syncEnabled())) return;
    const thread = await this.local.getThread(threadId);
    if (!thread || thread.temporary) return;
    await this.cloud.releaseThreadLock(threadId, getDeviceId()).catch(() => {});
  }

  /** Read the authoritative run lock for a thread (for the proactive "locked elsewhere" UX).
   *  Returns null when sync is off, the thread is local-only, or the read fails. */
  async getThreadLock(threadId: Id): Promise<ThreadLock | null> {
    if (!(await this.syncEnabled())) return null;
    const thread = await this.local.getThread(threadId);
    if (!thread || thread.temporary) return null;
    try {
      return await this.cloud.getThreadLock(threadId);
    } catch {
      return null;
    }
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
  getBlob(key: string): Promise<Blob | null> {
    return this.local.getBlob(key);
  }
  async addMemory(input: CreateMemoryBody): Promise<MemoryRecord> {
    if (await this.syncEnabled()) return this.cloud.createMemory(input);
    return this.local.addMemory(input);
  }
  async updateMemory(id: Id, patch: PatchMemoryBody): Promise<MemoryRecord> {
    if (await this.syncEnabled()) return this.cloud.patchMemory(id, patch);
    return this.local.updateMemory(id, patch);
  }
  removeMemory(id: Id): Promise<void> {
    return this.syncEnabled().then((enabled) => (enabled ? this.cloud.deleteMemory(id) : this.local.removeMemory(id)));
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
  /** Push local changes then pull remote deltas. Returns the thread ids whose local state
   *  changed during the pull, so the UI can refresh them. No-op when sync is disabled. */
  async sync(): Promise<Set<Id>> {
    if (!(await this.syncEnabled())) return new Set();
    await this.push();
    return this.pull();
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

  async pull(): Promise<Set<Id>> {
    const changed = new Set<Id>();
    if (!(await this.syncEnabled())) return changed;
    const cursor = await this.kv.get<string>(THREAD_CURSOR_KEY);
    const records = await this.cloud.listThreads({
      includeArchived: true,
      includeDeleted: true,
      since: cursor,
    });
    let maxUpdated = cursor ?? '';
    for (const rec of records) {
      if (await this.mergeThread(rec)) changed.add(rec.id);
      if (rec.updatedAt > maxUpdated) maxUpdated = rec.updatedAt;
      if (!rec.deletedAt && (await this.pullMessages(rec.id))) changed.add(rec.id);
    }
    if (maxUpdated && maxUpdated !== cursor) await this.kv.set(THREAD_CURSOR_KEY, maxUpdated);
    return changed;
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
        await this.cloud.appendMessage(
          op.threadId,
          await this.buildAppendBody(op.threadId, op.id, op.body),
        );
        return;
      case 'settings.save':
        await this.cloud.patchSettings(await this.local.getSettings());
        return;
    }
  }

  private async mergeThread(rec: ThreadRecord): Promise<boolean> {
    const incoming = threadFromRecord(rec);
    const existing = await this.local.getThread(rec.id);
    if (rec.deletedAt) {
      if (existing) {
        await this.local.deleteThread(rec.id);
        return true;
      }
      return false;
    }
    if (!existing) {
      await this.local.createThread(incoming);
      return true;
    }
    if (incoming.updatedAt > existing.updatedAt) {
      await this.local.updateThread(rec.id, incoming);
      return true;
    }
    return false;
  }

  private async pullMessages(threadId: Id, opts?: { forceFull?: boolean }): Promise<boolean> {
    const key = MSG_CURSOR_PREFIX + threadId;
    const cursor = await this.kv.get<string>(key);
    const localMessages = await this.local.listMessages(threadId);
    const forceFull = opts?.forceFull || localMessages.some(isStreamingAssistant);
    const records = await this.cloud.listMessages(threadId, forceFull ? undefined : { since: cursor });
    if (records.length === 0) return false;
    const known = new Map(localMessages.map((m) => [m.id, m]));
    let maxCreated = cursor ?? '';
    let changed = false;
    for (const rec of records) {
      const existing = known.get(rec.id);
      if (!existing || shouldReplaceKnownMessage(existing, rec as MessageRecord)) {
        await this.local.putMessageRaw(messageFromRecord(rec as MessageRecord));
        changed = true;
      }
      if (rec.createdAt > maxCreated) maxCreated = rec.createdAt;
    }
    if (maxCreated && maxCreated !== cursor) await this.kv.set(key, maxCreated);
    return changed;
  }

  /** On push, upload any local-only images of this message to Blob Storage (write SAS),
   *  persist their blobPath, and return the append body including them. */
  private async buildAppendBody(
    threadId: Id,
    id: Id,
    fallback: AppendMessageBody,
  ): Promise<AppendMessageBody> {
    const message = (await this.local.listMessages(threadId)).find((m) => m.id === id);
    if (!message || (!message.images?.length && !message.attachments?.length)) return fallback;
    let changed = false;
    for (const img of message.images ?? []) {
      if (img.blobPath || !img.localBlobKey) continue;
      const blob = await this.local.getBlob(img.localBlobKey);
      if (!blob) continue;
      const contentType = imageContentType(img.outputFormat);
      const sas = await this.cloud.requestSas({ threadId, assetId: img.id, op: 'write', contentType });
      await uploadBlobToSas(this.fetchImpl, sas.url, blob, contentType);
      img.blobPath = sas.blobPath;
      changed = true;
    }
    for (const att of message.attachments ?? []) {
      if (att.blobPath || !att.localBlobKey) continue;
      // Only sync bytes for content types the asset endpoint allows; others stay local-only.
      if (!SYNCABLE_CONTENT_TYPES.has(att.mime)) continue;
      const blob = await this.local.getBlob(att.localBlobKey);
      if (!blob) continue;
      const sas = await this.cloud.requestSas({ threadId, assetId: att.id, op: 'write', contentType: att.mime });
      await uploadBlobToSas(this.fetchImpl, sas.url, blob, att.mime);
      att.blobPath = sas.blobPath;
      changed = true;
    }
    if (changed)
      await this.local.updateMessage(id, { images: message.images, attachments: message.attachments });
    return appendBodyFromMessage(message);
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

function imageContentType(fmt: string): string {
  return fmt === 'jpeg' ? 'image/jpeg' : fmt === 'webp' ? 'image/webp' : 'image/png';
}

/** Blob-path extension -> content type. Mirrors the api asset allowlist (`api/src/domain/asset.ts`). */
const CONTENT_TYPE_BY_EXT: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  webp: 'image/webp',
  gif: 'image/gif',
  pdf: 'application/pdf',
  txt: 'text/plain',
  md: 'text/markdown',
  csv: 'text/csv',
  json: 'application/json',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  zip: 'application/zip',
};

/** Content types whose bytes the asset endpoint accepts (mirrors the api allowlist). */
const SYNCABLE_CONTENT_TYPES = new Set<string>([
  ...Object.values(CONTENT_TYPE_BY_EXT),
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
]);

/** Derive the threadId, assetId, and content type from a `{userId}/{threadId}/{assetId}.{ext}` blob path. */
function parseBlobPath(blobPath: string): { threadId: string; assetId: string; contentType: string } | null {
  const parts = blobPath.split('/').filter(Boolean);
  if (parts.length < 3) return null;
  const file = parts[parts.length - 1];
  const threadId = parts[parts.length - 2];
  const dot = file.lastIndexOf('.');
  const assetId = dot >= 0 ? file.slice(0, dot) : file;
  const ext = (dot >= 0 ? file.slice(dot + 1) : 'png').toLowerCase();
  const contentType = CONTENT_TYPE_BY_EXT[ext] ?? 'image/png';
  return { threadId, assetId, contentType };
}

/** PUT raw bytes to a blob SAS URL. Failures are flagged retryable so the sync queue keeps the op. */
async function uploadBlobToSas(
  fetchImpl: typeof fetch,
  url: string,
  blob: Blob,
  contentType: string,
): Promise<void> {
  let res: Response;
  try {
    res = await fetchImpl(url, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': contentType },
      body: blob,
    });
  } catch (err) {
    throw new CloudError('network', err instanceof Error ? err.message : 'Blob upload failed.', 0);
  }
  if (!res.ok) {
    throw new CloudError('network', `Blob upload failed (${res.status}).`, res.status);
  }
}
