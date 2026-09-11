// Local-first sync engine. Every Repository call is served from the local store
// (instant + offline), and mutations also enqueue a sync op. `sync()` later drains
// the queue to the cloud and pulls deltas back (last-write-wins by `updatedAt`).
// All of this is gated on Settings.data.sync, so with sync off it is a pure
// passthrough to the local store. The token provider is injected via the CloudApi,
// so this whole engine is unit-testable without MSAL.
import { DEFAULT_SETTINGS, type Id, type ImageRef, type Message, type Settings, type Thread, type ThreadLock } from '../../lib/types';
import { hasTransactionalOutbox, type Repository, type RunLockResult, type SearchHit, type SyncLocalStore } from '../repository';
import { CloudError, type CloudApi } from '../cloud/apiClient';
import { getDeviceId, getDeviceLabel } from '../../lib/device';
import { newId } from '../../lib/ids';
import {
  appendBodyFromMessage,
  type AccountSettingsPatch,
  messageFromRecord,
  threadFromRecord,
  updateBodyFromPatch,
  type AppendMessageBody,
  type CreateMemoryBody,
  type CreateThreadBody,
  type ListMemoryQuery,
  type MemoryProfileView,
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
const SETTINGS_HYDRATED_KEY = 'sync.settings.hydrated';
const SETTINGS_REVISION_KEY = 'sync.settings.revision';
const OUTBOX_LOCK = 'watai.sync.outbox.v2';
let localPush: Promise<void> | null = null;

type SyncOp = { operationId: string; state?: 'pending' | 'failed'; failure?: { code: string; at: string } } & (
  | { kind: 'thread.create'; id: Id; body: CreateThreadBody }
  | { kind: 'thread.update'; id: Id; body: UpdateThreadBody }
  | { kind: 'thread.delete'; id: Id }
  | { kind: 'message.append'; threadId: Id; id: Id; body: AppendMessageBody }
  | { kind: 'settings.save'; patch: AccountSettingsPatch; expectedRevision: number }
);
type WithoutOperationId<T> = T extends unknown ? Omit<T, 'operationId'> : never;
type NewSyncOp = WithoutOperationId<SyncOp>;

function objectDiff(current: Record<string, unknown>, next: Record<string, unknown>, excluded = new Set<string>()): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(next)) {
    if (excluded.has(key)) continue;
    const previous = current[key];
    if (value && previous && typeof value === 'object' && typeof previous === 'object' && !Array.isArray(value) && !Array.isArray(previous)) {
      const nested = objectDiff(previous as Record<string, unknown>, value as Record<string, unknown>);
      if (Object.keys(nested).length) patch[key] = nested;
    } else if (JSON.stringify(previous) !== JSON.stringify(value)) {
      patch[key] = value;
    }
  }
  return patch;
}

function accountSettingsPatch(current: Settings, next: Settings): AccountSettingsPatch {
  const personalization = objectDiff(current.personalization as unknown as Record<string, unknown>, next.personalization as unknown as Record<string, unknown>);
  const appearance = objectDiff(current.appearance as unknown as Record<string, unknown>, next.appearance as unknown as Record<string, unknown>);
  const voice = objectDiff(current.voice as unknown as Record<string, unknown>, next.voice as unknown as Record<string, unknown>, new Set(['inputDeviceId']));
  const data = objectDiff(current.data as unknown as Record<string, unknown>, next.data as unknown as Record<string, unknown>, new Set(['sync']));
  return {
    ...(Object.keys(personalization).length ? { personalization } : {}),
    ...(Object.keys(appearance).length ? { appearance } : {}),
    ...(Object.keys(voice).length ? { voice } : {}),
    ...(Object.keys(data).length ? { data } : {}),
  } as AccountSettingsPatch;
}

function mergeAccountSettings(settings: Settings, patch: AccountSettingsPatch): Settings {
  const { memory, ...personalization } = patch.personalization ?? {};
  return {
    ...settings,
    personalization: {
      ...settings.personalization,
      ...personalization,
      ...(memory
        ? { memory: { ...(settings.personalization.memory ?? DEFAULT_SETTINGS.personalization.memory!), ...memory } }
        : {}),
    },
    appearance: { ...settings.appearance, ...patch.appearance },
    voice: { ...settings.voice, ...patch.voice },
    data: { ...settings.data, ...patch.data },
  };
}

function preserveDeviceSettings(server: Settings, local: Settings): Settings {
  return {
    ...server,
    voice: {
      ...server.voice,
      ...(local.voice.inputDeviceId ? { inputDeviceId: local.voice.inputDeviceId } : {}),
    },
    data: { ...server.data, sync: local.data.sync },
    ...(local.tools ? { tools: local.tools } : {}),
  };
}

function stricterPrivacySettings(server: Settings, local: Settings): Settings {
  const serverMemory = server.personalization.memory ?? DEFAULT_SETTINGS.personalization.memory!;
  const localMemory = local.personalization.memory ?? DEFAULT_SETTINGS.personalization.memory!;
  const retentionRank: Record<Settings['data']['retention'], number> = { '30d': 0, '90d': 1, forever: 2 };
  const retention = retentionRank[server.data.retention] <= retentionRank[local.data.retention]
    ? server.data.retention
    : local.data.retention;
  return preserveDeviceSettings({
    ...server,
    personalization: {
      ...server.personalization,
      memoryEnabled: server.personalization.memoryEnabled && local.personalization.memoryEnabled,
      memory: {
        enabled: serverMemory.enabled && localMemory.enabled,
        paused: serverMemory.paused || localMemory.paused,
        referenceSaved: serverMemory.referenceSaved && localMemory.referenceSaved,
        referenceHistory: serverMemory.referenceHistory && localMemory.referenceHistory,
        autoExtract: serverMemory.autoExtract && localMemory.autoExtract,
      },
    },
    data: {
      ...server.data,
      temporaryDefault: server.data.temporaryDefault || local.data.temporaryDefault,
      retention,
    },
  }, local);
}

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

function requiresFullResync(error: unknown): boolean {
  return error instanceof CloudError
    && error.code === 'validation'
    && (error.details as { resyncRequired?: unknown } | undefined)?.resyncRequired === true;
}

/** A cheap content signature over an assistant message's server-owned fields. Compares counts (not
 *  deep equality) so it stays O(1) and churn-free: an identical server copy yields an identical
 *  signature, so no redundant local write. Used to detect when the server's copy has diverged from a
 *  locally-stored TERMINAL copy — e.g. it gained webImages/citations/artifacts that landed after
 *  this device first persisted the reply. */
function assistantSignature(m: Message): string {
  return [
    m.status,
    m.content.length,
    m.toolCalls?.length ?? 0,
    m.citations?.length ?? 0,
    m.webImages?.length ?? 0,
    m.memoryRefs?.length ?? 0,
    m.images?.length ?? 0,
    m.artifacts?.length ?? 0,
  ].join(':');
}

/** Reconcile a known local row with the authoritative server snapshot. Assistant snapshots are
 *  replaced when content/enrichment OR logical chronology differs. User rows retain local-only
 *  blob fields, but their chronology is repaired from server orderAt so an old browser cache can
 *  never keep a reply ahead of its prompt indefinitely. */
function reconcileKnownMessage(existing: Message, incoming: Message): Message | null {
  if (isStreamingAssistant(existing)) return incoming;
  if (existing.role === 'assistant' && incoming.role === 'assistant') {
    return assistantSignature(existing) !== assistantSignature(incoming) || existing.createdAt !== incoming.createdAt
      ? incoming
      : null;
  }
  if (existing.role === 'user' && incoming.role === 'user' && existing.createdAt !== incoming.createdAt) {
    return { ...existing, createdAt: incoming.createdAt };
  }
  return null;
}

export class SyncRepository implements Repository {
  constructor(
    private readonly local: SyncLocalStore,
    private readonly cloud: CloudApi,
    private readonly kv: KvStore,
    private readonly fetchImpl: typeof fetch = globalThis.fetch.bind(globalThis),
  ) {}

  /** Threads reconciled (a full message re-pull) once this session. A stale terminal copy that
   *  predates late enrichment converges on first open without re-pulling on every open. */
  private readonly reconciledThreads = new Set<Id>();

  // ---- reads: always local ----
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]> {
    return this.local.listThreads(opts);
  }
  getThread(id: Id): Promise<Thread | null> {
    return this.local.getThread(id);
  }
  async listMessages(threadId: Id): Promise<Message[]> {
    const messages = await this.local.listMessages(threadId);
    const hasStreaming = messages.some(isStreamingAssistant);
    // Once per session, fully reconcile a thread that has assistant replies against the server: the
    // delta cursor may already be past a message whose server copy gained late enrichment (e.g. web
    // images that landed after this device first stored it), so only a full re-pull surfaces it.
    const needsReconcile =
      !this.reconciledThreads.has(threadId) && messages.some((m) => m.role === 'assistant');
    if ((hasStreaming || needsReconcile) && (await this.syncEnabled())) {
      const ok = await this.pullMessages(threadId, { forceFull: true }).then(
        () => true,
        () => false,
      );
      if (ok) this.reconciledThreads.add(threadId);
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
  async resolveAssetUrl(asset: { id: string; libraryItemId?: string; localBlobKey?: string; blobPath?: string }): Promise<string> {
    // The cache key is the explicit local key, else a stable per-asset cloud key. Always check
    // it FIRST so a once-downloaded cloud asset is never re-fetched (faster + no repeat SAS/egress).
    const cacheKey = asset.localBlobKey ?? `cloud-${asset.id}`;
    const cached = await this.local.getBlobUrl(cacheKey);
    if (cached) return cached;
    if (asset.blobPath && /^(data:|blob:|https?:)/.test(asset.blobPath)) return asset.blobPath;
    if (asset.libraryItemId && (await this.syncEnabled())) {
      const item = await this.cloud.getLibraryItem(asset.libraryItemId).catch(() => null);
      if (item?.url) return item.url;
    }
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
      const memories: MemoryRecord[] = [];
      const seenCursors = new Set<string>();
      let cursor = query?.cursor;
      do {
        const out = await this.cloud.listMemory({ ...query, cursor, limit: Math.min(query?.limit ?? 100, 100) });
        memories.push(...out.memories);
        if (!out.cursor) break;
        if (seenCursors.has(out.cursor)) throw new Error('Memory inventory returned a repeated cursor.');
        seenCursors.add(out.cursor);
        cursor = out.cursor;
      } while (true);
      return memories;
    }
    return this.local.listMemory(query);
  }
  async getMemoryProfile(): Promise<MemoryProfileView> {
    if (await this.syncEnabled()) {
      try {
        return await this.cloud.getMemoryProfile();
      } catch {
        return this.local.getMemoryProfile();
      }
    }
    return this.local.getMemoryProfile();
  }
  search(query: string): Promise<SearchHit[]> {
    return this.local.search(query);
  }
  exportAll(): Promise<Blob> {
    return this.local.exportAll();
  }

  // ---- mutations: local first, then enqueue ----
  async createThread(init?: Partial<Thread>): Promise<Thread> {
    const syncEnabled = await this.syncEnabled();
    const prepared = { ...init, id: init?.id ?? newId() };
    if (!prepared.temporary && syncEnabled && hasTransactionalOutbox(this.local)) {
      return this.local.createThreadWithOutbox(prepared, {
        operationId: newId(), state: 'pending',
        kind: 'thread.create',
        id: prepared.id,
        body: { id: prepared.id, title: prepared.title ?? 'New chat' },
      });
    }
    const thread = await this.local.createThread(prepared);
    if (!thread.temporary && syncEnabled) {
      await this.enqueue({ kind: 'thread.create', id: thread.id, body: { id: thread.id, title: thread.title } });
      // create only carries title; sync non-default pinned/archived via a follow-up update.
      if (thread.pinned || thread.archived) {
        await this.enqueueThreadUpdate(thread.id, flagsPatch(thread));
      }
    }
    return thread;
  }

  async updateThread(id: Id, patch: Partial<Thread>): Promise<Thread> {
    const existing = await this.local.getThread(id);
    const body = updateBodyFromPatch(patch);
    if (existing && !existing.temporary && (await this.syncEnabled()) && Object.keys(body).length > 0 && hasTransactionalOutbox(this.local)) {
      return this.local.updateThreadWithOutbox(id, patch, {
        operationId: newId(), state: 'pending', kind: 'thread.update', id, body,
      });
    }
    const updated = await this.local.updateThread(id, patch);
    if (!updated.temporary && (await this.syncEnabled()) && Object.keys(body).length > 0) await this.enqueueThreadUpdate(id, body);
    return updated;
  }

  async deleteThread(id: Id): Promise<void> {
    const existing = await this.local.getThread(id);
    if (existing && !existing.temporary && (await this.syncEnabled()) && hasTransactionalOutbox(this.local)) {
      await this.local.deleteThreadWithOutbox(id, { operationId: newId(), state: 'pending', kind: 'thread.delete', id });
      return;
    }
    await this.local.deleteThread(id);
    if (existing && !existing.temporary && (await this.syncEnabled())) {
      await this.enqueueThreadDelete(id);
    }
  }

  async appendMessage(m: Message): Promise<Message> {
    if (await this.syncEnabled()) {
      const thread = await this.local.getThread(m.threadId);
      if (thread && !thread.temporary) {
        if (hasTransactionalOutbox(this.local)) {
          return this.local.appendMessageWithOutbox(m, {
            operationId: newId(), state: 'pending', kind: 'message.append', threadId: m.threadId,
            id: m.id, body: appendBodyFromMessage(m),
          });
        }
        const saved = await this.local.appendMessage(m);
        await this.enqueue({
          kind: 'message.append',
          threadId: m.threadId,
          id: saved.id,
          body: appendBodyFromMessage(saved),
        });
        return saved;
      }
    }
    return this.local.appendMessage(m);
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
    const previous = await this.local.getSettings();
    const patch = accountSettingsPatch(previous, s);
    let revision = await this.kv.get<number>(SETTINGS_REVISION_KEY);
    let next = s;
    if (s.data.sync && revision === undefined) {
      await this.hydrateSettings();
      const hydrated = await this.local.getSettings();
      next = preserveDeviceSettings(mergeAccountSettings(hydrated, patch), s);
      revision = await this.kv.get<number>(SETTINGS_REVISION_KEY);
    }
    if (s.data.sync && revision !== undefined && Object.keys(patch).length) {
      if (hasTransactionalOutbox(this.local)) {
        await this.local.saveSettingsWithOutbox(next, {
          operationId: newId(), state: 'pending', kind: 'settings.save', patch, expectedRevision: revision,
        });
      } else {
        await this.local.saveSettings(next);
        await this.enqueueSettingsPatch(patch, revision);
      }
    } else {
      await this.local.saveSettings(next);
    }
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
    await this.hydrateSettings();
    await this.push();
    return this.pull();
  }

  async hydrateSettings(): Promise<void> {
    if (await this.kv.get<boolean>(SETTINGS_HYDRATED_KEY)) return;
    const local = await this.local.getSettings();
    const server = await this.cloud.getSettings();
    const { revision, ...serverSettings } = server;
    await this.local.saveSettings(preserveDeviceSettings(serverSettings, local));
    await this.mutateQueue((queue) => queue.filter((operation) => operation.kind !== 'settings.save'));
    await this.kv.set(SETTINGS_REVISION_KEY, revision);
    await this.kv.set(SETTINGS_HYDRATED_KEY, true);
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
  }

  async push(): Promise<void> {
    if (!(await this.syncEnabled())) return;
    if (localPush) return localPush;
    const drain = () => this.drainOutbox();
    const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
    const promise: Promise<void> = locks
      ? locks.request(OUTBOX_LOCK, { mode: 'exclusive' }, () => drain()) as unknown as Promise<void>
      : drain();
    localPush = promise.finally(() => { localPush = null; });
    await localPush;
  }

  private async drainOutbox(): Promise<void> {
    while (true) {
      const op = (await this.loadQueue()).find((operation) => operation.state !== 'failed');
      if (!op) return;
      try {
        await this.applyOp(op);
      } catch (err) {
        if (!(err instanceof CloudError) || err.retryable) break; // transient: stop, keep op
        console.warn(`[sync] retaining failed ${op.kind}: ${err.code}`);
        await this.failOperation(op.operationId, err.code);
        continue;
      }
      await this.acknowledge(op.operationId);
    }
  }

  async pull(): Promise<Set<Id>> {
    const changed = new Set<Id>();
    if (!(await this.syncEnabled())) return changed;
    let cursor = await this.kv.get<string>(THREAD_CURSOR_KEY);
    let records: ThreadRecord[];
    try {
      records = await this.cloud.listThreads({
        includeArchived: true,
        includeDeleted: true,
        since: cursor,
      });
    } catch (error) {
      if (!cursor || !requiresFullResync(error)) throw error;
      await this.kv.delete(THREAD_CURSOR_KEY);
      cursor = undefined;
      records = await this.cloud.listThreads({ includeArchived: true, includeDeleted: true });
    }
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
        {
          const local = await this.local.getSettings();
          try {
            const updated = await this.cloud.patchSettings(op.patch, op.expectedRevision);
            const { revision, ...updatedSettings } = updated;
            await this.local.saveSettings(preserveDeviceSettings(updatedSettings, local));
            await this.kv.set(SETTINGS_REVISION_KEY, updated.revision);
          } catch (error) {
            if (!(error instanceof CloudError) || error.code !== 'conflict') throw error;
            const latest = await this.cloud.getSettings();
            const { revision, ...latestSettings } = latest;
            await this.local.saveSettings(stricterPrivacySettings(latestSettings, local));
            await this.kv.set(SETTINGS_REVISION_KEY, latest.revision);
            throw error;
          }
        }
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
    let cursor = await this.kv.get<string>(key);
    const localMessages = await this.local.listMessages(threadId);
    const forceFull = opts?.forceFull || localMessages.some(isStreamingAssistant);
    let records: MessageRecord[];
    try {
      records = await this.cloud.listMessages(threadId, forceFull ? undefined : { since: cursor });
    } catch (error) {
      if (forceFull || !cursor || !requiresFullResync(error)) throw error;
      await this.kv.delete(key);
      cursor = undefined;
      records = await this.cloud.listMessages(threadId);
    }
    if (records.length === 0) return false;
    const known = new Map(localMessages.map((m) => [m.id, m]));
    let maxCreated = cursor ?? '';
    let changed = false;
    for (const rec of records) {
      const existing = known.get(rec.id);
      const incoming = messageFromRecord(rec as MessageRecord);
      const reconciled = existing ? reconcileKnownMessage(existing, incoming) : incoming;
      if (reconciled) {
        await this.local.putMessageRaw(reconciled);
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

  private async loadQueue(): Promise<SyncOp[]> {
    if (hasTransactionalOutbox(this.local)) return this.local.listOutbox<SyncOp>();
    const queue = (await this.kv.get<Array<SyncOp | NewSyncOp>>(QUEUE_KEY)) ?? [];
    let migrated = false;
    const normalized = queue.map((operation) => {
      if ('operationId' in operation && operation.operationId) return operation as SyncOp;
      migrated = true;
      return { ...operation, operationId: newId() } as SyncOp;
    });
    if (migrated) await this.saveQueue(normalized);
    return normalized;
  }
  private saveQueue(queue: SyncOp[]): Promise<void> {
    if (hasTransactionalOutbox(this.local)) return this.local.mutateOutbox<SyncOp>(() => queue).then(() => undefined);
    return this.kv.set(QUEUE_KEY, queue);
  }

  private mutateQueue(mutate: (queue: SyncOp[]) => SyncOp[]): Promise<SyncOp[]> {
    if (hasTransactionalOutbox(this.local)) return this.local.mutateOutbox<SyncOp>(mutate);
    return this.kv.update<SyncOp[]>(QUEUE_KEY, (queue) => mutate(queue ?? [])).then((queue) => queue ?? []);
  }

  private async enqueue(op: NewSyncOp): Promise<void> {
    await this.mutateQueue((queue) => [
      ...queue,
      { ...op, operationId: newId() } as SyncOp,
    ]);
  }

  private async acknowledge(operationId: string): Promise<void> {
    await this.mutateQueue((queue) => queue.filter((operation) => operation.operationId !== operationId));
  }

  private async failOperation(operationId: string, code: string): Promise<void> {
    await this.mutateQueue((queue) => queue.map((operation) => operation.operationId === operationId
        ? { ...operation, state: 'failed', failure: { code, at: new Date().toISOString() } }
        : operation));
  }

  private async enqueueSettingsPatch(patch: AccountSettingsPatch, expectedRevision: number): Promise<void> {
    await this.mutateQueue((current) => {
      const queue = [...current];
      const pending = queue.find(
        (operation): operation is Extract<SyncOp, { kind: 'settings.save' }> =>
          operation.kind === 'settings.save' && operation.expectedRevision === expectedRevision,
      );
      if (pending) {
        pending.patch = {
          ...pending.patch,
          ...patch,
          personalization: {
            ...pending.patch.personalization,
            ...patch.personalization,
            ...((pending.patch.personalization?.memory || patch.personalization?.memory)
              ? { memory: { ...pending.patch.personalization?.memory, ...patch.personalization?.memory } }
              : {}),
          },
          appearance: { ...pending.patch.appearance, ...patch.appearance },
          voice: { ...pending.patch.voice, ...patch.voice },
          data: { ...pending.patch.data, ...patch.data },
        };
      } else queue.push({ kind: 'settings.save', patch, expectedRevision, operationId: newId() });
      return queue;
    });
  }

  /** Coalesce repeated updates to the same thread into a single pending op. */
  private async enqueueThreadUpdate(id: Id, body: UpdateThreadBody): Promise<void> {
    await this.mutateQueue((current) => {
      const queue = [...current];
      const pending = queue.find(
        (op): op is Extract<SyncOp, { kind: 'thread.update' }> =>
          op.kind === 'thread.update' && op.id === id,
      );
      if (pending) Object.assign(pending.body, body);
      else queue.push({ kind: 'thread.update', id, body, operationId: newId() });
      return queue;
    });
  }

  /**
   * If the thread was created locally but never pushed yet, drop all of its pending
   * ops and skip the delete entirely (the server never knew it existed). Otherwise
   * enqueue the delete and discard any pending updates for it.
   */
  private async enqueueThreadDelete(id: Id): Promise<void> {
    await this.mutateQueue((current) => {
      const unsynced = current.some((op) => op.kind === 'thread.create' && op.id === id);
      const kept = current.filter((op) => {
        if (op.kind === 'thread.create' || op.kind === 'thread.update') return op.id !== id;
        if (op.kind === 'message.append') return op.threadId !== id;
        return true;
      });
      if (!unsynced) kept.push({ kind: 'thread.delete', id, operationId: newId() });
      return kept;
    });
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
