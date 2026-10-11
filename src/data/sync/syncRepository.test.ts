import { describe, it, expect, vi } from 'vitest';
import { SyncRepository } from './syncRepository';
import { memoryKvStore } from './kvStore';
import { CloudError, WataiApiClient, type CloudApi } from '../cloud/apiClient';
import { appendBodyFromMessage, messageFromRecord } from '../cloud/types';
import type { SearchHit, SyncLocalStore } from '../repository';
import {
  DEFAULT_SETTINGS,
  type Id,
  type ImageRef,
  type Message,
  type Settings,
  type Thread,
  type ThreadLock,
} from '../../lib/types';
import type {
  AppendMessageBody,
  AccountSettingsPatch,
  CreateMemoryBody,
  CreateThreadBody,
  CredentialStatus,
  CredentialsInput,
  ListMemoryQuery,
  ListMemoryResponse,
  LibraryItemDTO,
  MemoryProfileView,
  MemoryRecord,
  PatchMemoryBody,
  MessageRecord,
  RunRecord,
  SasRequestBody,
  SasResult,
  SettingsSnapshot,
  SubmitRunBody,
  SubmitRunResult,
  ThreadRecord,
  UpdateThreadBody,
} from '../cloud/types';

/** Minimal in-memory SyncLocalStore mirroring the behaviours the sync engine relies on. */
class FakeLocal implements SyncLocalStore {
  threads = new Map<Id, Thread>();
  messages = new Map<Id, Message>();
  memories = new Map<Id, MemoryRecord>();
  blobs = new Map<string, Blob>();
  settings: Settings;
  private clock = 0;

  constructor(sync = false) {
    this.settings = { ...DEFAULT_SETTINGS, data: { ...DEFAULT_SETTINGS.data, sync } };
  }
  private now(): string {
    return `2026-01-01T00:00:${String(this.clock++).padStart(2, '0')}Z`;
  }

  async listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]> {
    return [...this.threads.values()]
      .filter((t) => !t.deletedAt && (opts?.includeArchived || !t.archived))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }
  async getThread(id: Id): Promise<Thread | null> {
    return this.threads.get(id) ?? null;
  }
  async createThread(init?: Partial<Thread>): Promise<Thread> {
    const ts = this.now();
    const t: Thread = {
      id: init?.id ?? `loc_${this.clock}`,
      title: init?.title ?? 'New chat',
      pinned: false,
      archived: false,
      temporary: init?.temporary ?? false,
      createdAt: ts,
      updatedAt: ts,
      messageCount: 0,
      ...init,
    };
    this.threads.set(t.id, t);
    return t;
  }
  async updateThread(id: Id, patch: Partial<Thread>): Promise<Thread> {
    const cur = this.threads.get(id);
    if (!cur) throw new Error('thread not found');
    const merged = { ...cur, ...patch, updatedAt: patch.updatedAt ?? this.now() };
    this.threads.set(id, merged);
    return merged;
  }
  async deleteThread(id: Id): Promise<void> {
    this.threads.delete(id);
    for (const [mid, m] of this.messages) if (m.threadId === id) this.messages.delete(mid);
  }
  async listMessages(threadId: Id): Promise<Message[]> {
    return [...this.messages.values()]
      .filter((m) => m.threadId === threadId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }
  async appendMessage(m: Message): Promise<Message> {
    this.messages.set(m.id, m);
    const t = this.threads.get(m.threadId);
    if (t) await this.updateThread(m.threadId, { messageCount: t.messageCount + 1 });
    return m;
  }
  async putMessageRaw(m: Message): Promise<void> {
    this.messages.set(m.id, m);
  }
  async updateMessage(id: Id, patch: Partial<Message>): Promise<Message> {
    const cur = this.messages.get(id)!;
    const merged = { ...cur, ...patch };
    this.messages.set(id, merged);
    return merged;
  }
  async deleteMessage(id: Id): Promise<void> {
    this.messages.delete(id);
  }
  async acquireRunLock(): Promise<{ acquired: boolean }> {
    return { acquired: true };
  }
  async releaseRunLock(): Promise<void> {}
  async getThreadLock(): Promise<null> {
    return null;
  }
  async getSettings(): Promise<Settings> {
    return this.settings;
  }
  async saveSettings(s: Settings): Promise<void> {
    this.settings = s;
  }
  async putBlob(key: string, blob: Blob): Promise<void> {
    this.blobs.set(key, blob);
  }
  async getBlob(key: string): Promise<Blob | null> {
    return this.blobs.get(key) ?? null;
  }
  async getBlobUrl(key: string): Promise<string> {
    return this.blobs.has(key) ? `blob:fake/${key}` : '';
  }
  async resolveImageUrl(image: ImageRef): Promise<string> {
    if (image.localBlobKey && this.blobs.has(image.localBlobKey)) return `blob:fake/${image.localBlobKey}`;
    if (image.blobPath && /^(data:|blob:|https?:)/.test(image.blobPath)) return image.blobPath;
    return '';
  }
  async resolveAssetUrl(asset: { id: string; localBlobKey?: string; blobPath?: string }): Promise<string> {
    if (asset.localBlobKey && this.blobs.has(asset.localBlobKey)) return `blob:fake/${asset.localBlobKey}`;
    if (asset.blobPath && /^(data:|blob:|https?:)/.test(asset.blobPath)) return asset.blobPath;
    return '';
  }
  async listMemory(query: ListMemoryQuery = {}): Promise<MemoryRecord[]> {
    return [...this.memories.values()].filter((m) => (query.status ? m.status === query.status : m.status === 'active'));
  }
  async addMemory(input: CreateMemoryBody): Promise<MemoryRecord> {
    const ts = this.now();
    const rec: MemoryRecord = {
      id: `mem_${this.clock}`,
      userId: 'local',
      kind: input.kind ?? 'fact',
      status: 'active',
      text: input.text,
      sourceRefs: [input.sourceRef ?? { type: 'manual', createdAt: ts }],
      confidence: 1,
      salience: 0.7,
      pinned: input.pinned ?? false,
      sensitive: false,
      visibility: input.visibility ?? 'normal',
      createdAt: ts,
      updatedAt: ts,
      useCount: 0,
    };
    this.memories.set(rec.id, rec);
    return rec;
  }
  async updateMemory(id: Id, patch: PatchMemoryBody): Promise<MemoryRecord> {
    const current = this.memories.get(id)!;
    const next = { ...current, ...patch, updatedAt: this.now() } as MemoryRecord;
    this.memories.set(id, next);
    return next;
  }
  async removeMemory(id: Id): Promise<void> {
    const current = this.memories.get(id);
    if (current) this.memories.set(id, { ...current, status: 'deleted', deletedAt: this.now() });
  }
  async getMemoryProfile(): Promise<MemoryProfileView> {
    return emptyMemoryProfile('local');
  }
  async search(): Promise<SearchHit[]> {
    return [];
  }
  async exportAll(): Promise<Blob> {
    return new Blob([]);
  }
  async deleteAll(): Promise<void> {
    this.threads.clear();
    this.messages.clear();
  }
}

/** In-memory CloudApi that records calls and lets tests seed server state directly. */
class FakeCloud implements CloudApi {
  threads = new Map<string, ThreadRecord>();
  messages = new Map<string, MessageRecord>();
  memories = new Map<string, MemoryRecord>();
  libraryItems = new Map<string, LibraryItemDTO>();
  serverSettings: Settings | null = null;
  serverSettingsRevision = 0;
  calls: string[] = [];
  private clock = 0;

  private now(): string {
    return `2026-02-01T00:00:${String(this.clock++).padStart(2, '0')}Z`;
  }

  seedThread(rec: Partial<ThreadRecord> & { id: string }): void {
    this.threads.set(rec.id, {
      userId: 'u',
      title: 't',
      pinned: false,
      archived: false,
      temporary: false,
      messageCount: 0,
      createdAt: rec.updatedAt ?? '2026-02-01T00:00:00Z',
      updatedAt: '2026-02-01T00:00:00Z',
      deletedAt: null,
      ...rec,
    });
  }
  seedMessage(rec: Partial<MessageRecord> & { id: string; threadId: string }): void {
    this.messages.set(rec.id, {
      userId: 'u',
      role: 'user',
      content: '',
      status: 'complete',
      createdAt: '2026-02-01T00:00:00Z',
      deletedAt: null,
      ...rec,
    });
  }

  async getThreadLock(id: string): Promise<ThreadLock | null> {
    this.calls.push(`getLock:${id}`);
    return this.threads.get(id)?.lock ?? null;
  }

  async listThreads(opts?: {
    includeArchived?: boolean;
    includeDeleted?: boolean;
    since?: string;
  }): Promise<ThreadRecord[]> {
    this.calls.push('listThreads');
    return [...this.threads.values()].filter(
      (t) => (opts?.includeDeleted || !t.deletedAt) && (!opts?.since || t.updatedAt >= opts.since),
    );
  }
  async getThread(id: string): Promise<ThreadRecord> {
    const t = this.threads.get(id);
    if (!t) throw new CloudError('not_found', 'missing', 404);
    return t;
  }
  async createThread(body: CreateThreadBody): Promise<ThreadRecord> {
    this.calls.push(`createThread:${body.id}`);
    const id = body.id ?? `srv_${this.clock}`;
    const existing = this.threads.get(id);
    if (existing) return existing;
    const ts = this.now();
    const rec: ThreadRecord = {
      id,
      userId: 'u',
      title: body.title,
      pinned: false,
      archived: false,
      temporary: false,
      messageCount: 0,
      createdAt: ts,
      updatedAt: ts,
      deletedAt: null,
    };
    this.threads.set(id, rec);
    return rec;
  }
  async updateThread(id: string, body: UpdateThreadBody): Promise<ThreadRecord> {
    this.calls.push(`updateThread:${id}`);
    const cur = this.threads.get(id);
    if (!cur) throw new CloudError('not_found', 'missing', 404);
    const rec = { ...cur, ...body, updatedAt: this.now() };
    this.threads.set(id, rec);
    return rec;
  }
  async deleteThread(id: string): Promise<void> {
    this.calls.push(`deleteThread:${id}`);
    const cur = this.threads.get(id);
    if (cur) this.threads.set(id, { ...cur, deletedAt: this.now() });
  }
  async listMessages(threadId: string, opts?: { since?: string }): Promise<MessageRecord[]> {
    this.calls.push(`listMessages:${threadId}`);
    return [...this.messages.values()].filter(
      (m) => m.threadId === threadId && (!opts?.since || m.createdAt >= opts.since),
    );
  }
  async appendMessage(threadId: string, body: AppendMessageBody): Promise<MessageRecord> {
    this.calls.push(`appendMessage:${threadId}:${body.id}`);
    const id = body.id ?? `m_${this.clock}`;
    const existing = this.messages.get(id);
    if (existing) return existing;
    const rec: MessageRecord = {
      id,
      threadId,
      userId: 'u',
      role: body.role,
      content: body.content,
      status: 'complete',
      createdAt: this.now(),
      deletedAt: null,
      ...(body.model ? { model: body.model } : {}),
      ...(body.parentId ? { parentId: body.parentId } : {}),
      ...(body.images?.length ? { images: body.images } : {}),
      ...(body.attachments?.length ? { attachments: body.attachments } : {}),
      ...(body.toolCalls?.length ? { toolCalls: body.toolCalls } : {}),
      ...(body.citations?.length ? { citations: body.citations } : {}),
      ...(body.memoryRefs?.length ? { memoryRefs: body.memoryRefs } : {}),
    };
    this.messages.set(id, rec);
    return rec;
  }
  async acquireThreadLock(
    threadId: string,
    body: { deviceId: string; deviceLabel: string },
  ): Promise<{ thread: ThreadRecord; lock: ThreadLock }> {
    this.calls.push(`acquireThreadLock:${threadId}:${body.deviceId}`);
    const cur = this.threads.get(threadId);
    if (!cur) throw new CloudError('not_found', 'missing', 404);
    const existing = cur.lock ?? null;
    const live =
      !!existing &&
      existing.deviceId !== body.deviceId &&
      Date.now() - Date.parse(existing.heartbeatAt) <= 120_000;
    if (live) throw new CloudError('conflict', 'busy', 409, { lock: existing });
    const nowIso = this.now();
    const lock: ThreadLock = {
      deviceId: body.deviceId,
      deviceLabel: body.deviceLabel,
      acquiredAt: existing?.deviceId === body.deviceId ? existing.acquiredAt : nowIso,
      heartbeatAt: nowIso,
    };
    const rec = { ...cur, lock, updatedAt: nowIso };
    this.threads.set(threadId, rec);
    return { thread: rec, lock };
  }
  async releaseThreadLock(threadId: string, deviceId: string): Promise<void> {
    this.calls.push(`releaseThreadLock:${threadId}:${deviceId}`);
    const cur = this.threads.get(threadId);
    if (cur?.lock && cur.lock.deviceId === deviceId) {
      this.threads.set(threadId, { ...cur, lock: null, updatedAt: this.now() });
    }
  }
  async getSettings(): Promise<SettingsSnapshot> {
    this.calls.push('getSettings');
    return { ...(this.serverSettings ?? DEFAULT_SETTINGS), revision: this.serverSettingsRevision };
  }
  async patchSettings(patch: AccountSettingsPatch, expectedRevision: number): Promise<SettingsSnapshot> {
    this.calls.push('patchSettings');
    if (expectedRevision !== this.serverSettingsRevision) throw new CloudError('conflict', 'stale settings', 409);
    const current = this.serverSettings ?? DEFAULT_SETTINGS;
    const { memory, ...personalization } = patch.personalization ?? {};
    this.serverSettings = {
      ...current,
      personalization: {
        ...current.personalization,
        ...personalization,
        ...(memory
          ? { memory: { ...(current.personalization.memory ?? DEFAULT_SETTINGS.personalization.memory!), ...memory } }
          : {}),
      },
      appearance: { ...current.appearance, ...patch.appearance },
      voice: { ...current.voice, ...patch.voice },
      data: { ...current.data, ...patch.data },
    };
    this.serverSettingsRevision += 1;
    return { ...this.serverSettings!, revision: this.serverSettingsRevision };
  }
  async listMemory(query: ListMemoryQuery = {}): Promise<ListMemoryResponse> {
    this.calls.push('listMemory');
    const all = [...this.memories.values()].filter((m) => (query.status ? m.status === query.status : m.status === 'active'));
    const offset = query.cursor ? Number(query.cursor) : 0;
    const limit = query.limit ?? 100;
    const memories = all.slice(offset, offset + limit);
    return {
      memories,
      ...(offset + limit < all.length ? { cursor: String(offset + limit) } : {}),
    };
  }
  async createMemory(body: CreateMemoryBody): Promise<MemoryRecord> {
    this.calls.push('createMemory');
    const ts = this.now();
    const rec: MemoryRecord = {
      id: `cloud_mem_${this.clock}`,
      userId: 'u',
      kind: body.kind ?? 'fact',
      status: 'active',
      text: body.text,
      sourceRefs: [body.sourceRef ?? { type: 'manual', createdAt: ts }],
      confidence: 1,
      salience: 0.7,
      pinned: body.pinned ?? false,
      sensitive: false,
      visibility: body.visibility ?? 'normal',
      createdAt: ts,
      updatedAt: ts,
      useCount: 0,
    };
    this.memories.set(rec.id, rec);
    return rec;
  }
  async patchMemory(id: string, patch: PatchMemoryBody): Promise<MemoryRecord> {
    this.calls.push(`patchMemory:${id}`);
    const current = this.memories.get(id)!;
    const next = { ...current, ...patch, updatedAt: this.now() } as MemoryRecord;
    this.memories.set(id, next);
    return next;
  }
  async deleteMemory(id: string): Promise<void> {
    this.calls.push(`deleteMemory:${id}`);
    const current = this.memories.get(id);
    if (current) this.memories.set(id, { ...current, status: 'deleted', deletedAt: this.now() });
  }
  async getMemoryProfile(): Promise<MemoryProfileView> {
    this.calls.push('getMemoryProfile');
    return emptyMemoryProfile('u');
  }
  async requestSas(body: SasRequestBody): Promise<SasResult> {
    this.calls.push(`requestSas:${body.op}:${body.threadId}:${body.assetId}`);
    return {
      blobPath: body.op === 'write' ? `u/library/${body.assetId}.png` : `u/${body.threadId}/${body.assetId}.png`,
      url: `https://blob.test/${body.threadId}/${body.assetId}?${body.op}`,
      expiresAt: this.now(),
    };
  }
  async getMe() {
    return { email: 'u@example.com', isAdmin: false, isInvited: true };
  }
  async getCredentialStatus(): Promise<CredentialStatus> {
    this.calls.push('getCredentialStatus');
    return { configured: false, tavilyConfigured: false };
  }
  async putCredentials(body: CredentialsInput): Promise<CredentialStatus> {
    this.calls.push('putCredentials');
    return {
      configured: true,
      baseUrl: body.baseUrl,
      models: body.models,
      tavilyConfigured: !!body.tavilyKey,
    };
  }
  async deleteCredentials(): Promise<void> {
    this.calls.push('deleteCredentials');
  }
  async submitRun(threadId: string, body: SubmitRunBody): Promise<SubmitRunResult> {
    this.calls.push(`submitRun:${threadId}`);
    return { runId: 'r1', assistantMessageId: body.clientMessageId ?? 'm', status: 'queued' };
  }
  async getRun(threadId: string, runId: string): Promise<RunRecord> {
    this.calls.push(`getRun:${threadId}:${runId}`);
    return {
      id: runId,
      threadId,
      userId: 'u',
      assistantMessageId: 'm',
      status: 'complete',
      tools: [],
      allowDestructive: [],
      createdAt: this.now(),
      heartbeatAt: this.now(),
    };
  }
  async listActiveRuns(threadId: string): Promise<RunRecord[]> {
    this.calls.push(`listActiveRuns:${threadId}`);
    return [];
  }
  async cancelRun(threadId: string, runId: string): Promise<RunRecord> {
    this.calls.push(`cancelRun:${threadId}:${runId}`);
    return {
      id: runId,
      threadId,
      userId: 'u',
      assistantMessageId: 'm',
      status: 'canceled',
      tools: [],
      allowDestructive: [],
      createdAt: this.now(),
      heartbeatAt: this.now(),
    };
  }
  async listInvites() {
    return [];
  }
  async createInvite(email: string) {
    return { email, invitedBy: 'admin@example.com', createdAt: this.now() };
  }
  async deleteInvite() {}
  async getMemoryModelConfig() {
    return {
      base: { model: 'gpt-5.4-mini', source: 'env' as const, envDefault: 'gpt-5.4-mini', override: null },
      deep: { model: 'gpt-5.4', source: 'env' as const, envDefault: 'gpt-5.4', override: null },
    };
  }
  async setMemoryModels(body: { memoryModel?: string; memoryDeepModel?: string }) {
    return {
      base: { model: body.memoryModel || 'gpt-5.4-mini', source: (body.memoryModel ? 'override' : 'env') as 'override' | 'env', envDefault: 'gpt-5.4-mini', override: body.memoryModel || null },
      deep: { model: body.memoryDeepModel || 'gpt-5.4', source: (body.memoryDeepModel ? 'override' : 'env') as 'override' | 'env', envDefault: 'gpt-5.4', override: body.memoryDeepModel || null },
    };
  }
  async negotiate() {
    return { url: '', accessToken: '' };
  }
  async listThreadFiles() {
    return [];
  }
  async uploadThreadFile(_threadId: string, body: { name: string; mime: string; dataBase64: string }) {
    return { fileId: 'f1', name: body.name, bytes: 1, status: 'ready' as const, createdAt: this.now() };
  }
  async attachLibraryThreadFile(_threadId: string, itemId: string) {
    return { fileId: `library-${itemId}`, libraryItemId: itemId, name: 'Library file', bytes: 1, status: 'ready' as const, createdAt: this.now() };
  }
  async deleteThreadFile() {}
  async transcribeAudio() {
    return { text: '' };
  }
  async synthesizeSpeech() {
    return { audioBase64: '', mime: 'audio/mpeg' };
  }
  async fetchWebImage() {
    return { dataBase64: '', mime: 'image/png', bytes: 0 };
  }
  async chatComplete() {
    return { text: '' };
  }
  async generateImage() {
    return { images: [] };
  }
  async createImages() {
    return [];
  }
  async listImages() {
    return { images: [] };
  }
  getImage(): Promise<never> {
    return Promise.reject(new Error('not implemented'));
  }
  async deleteImage() {}
  async listLibrary() {
    return { items: [] };
  }
  async getLibraryItem(id: string): Promise<LibraryItemDTO> {
    const item = this.libraryItems.get(id);
    if (!item) throw new CloudError('not_found', 'missing', 404);
    return item;
  }
  async getLibraryStorage() {
    return {
      activeBytes: 0,
      trashedBytes: 0,
      activeCount: 0,
      trashedCount: 0,
      byKind: [],
      byOrigin: [],
      largestSourceThreads: [],
      duplicateGroups: 0,
    };
  }
  async getLibraryLineage() {
    return { items: [] };
  }
  reserveLibraryUpload(): Promise<never> {
    return Promise.reject(new Error('not implemented'));
  }
  completeLibraryUpload(): Promise<never> {
    return Promise.reject(new Error('not implemented'));
  }
}

function setup(sync = true) {
  const local = new FakeLocal(sync);
  const cloud = new FakeCloud();
  const kv = memoryKvStore();
  const uploaded = new Map<string, Blob>();
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit): Promise<Response> => {
    if (init?.method === 'PUT') {
      uploaded.set(String(url), init.body as Blob);
      return new Response(null, { status: 201 });
    }
    return new Response(new Uint8Array([73, 77, 71]), { status: 200, headers: { 'content-type': 'image/png' } });
  }) as typeof fetch;
  const repo = new SyncRepository(local, cloud, kv, fetchImpl);
  return { local, cloud, kv, repo, uploaded };
}

const msg = (over: Partial<Message> & { id: string; threadId: string }): Message => ({
  role: 'user',
  content: 'hi',
  status: 'complete',
  createdAt: '2026-01-01T00:00:30Z',
  ...over,
});

function emptyMemoryProfile(userId: string): MemoryProfileView {
  return {
    schemaVersion: 1,
    userId,
    updatedAt: '2026-01-01T00:00:00Z',
    evidenceCount: 0,
    profile: {
      user: { details: {}, family: { spouse: [], children: [], pets: [] }, preferences: { communication: [], engineering: [], design: [], tools: [], other: [] }, interests: { media: [], hobbies: [], other: [] } },
      work: { projects: [], repositories: [], deployments: [], currentFocus: [] },
      avoidances: [],
    },
    temporal: { today: { items: [] }, week: { items: [] }, month: { items: [] } },
  };
}

describe('SyncRepository — sync disabled', () => {
  it('is a pure local passthrough that queues nothing', async () => {
    const { repo, cloud, kv } = setup(false);
    const t = await repo.createThread({ title: 'A' });
    await repo.appendMessage(msg({ id: 'm1', threadId: t.id }));
    await repo.sync();

    expect(await kv.get('sync.queue')).toBeUndefined();
    expect(cloud.calls).toEqual([]);
    expect((await repo.listThreads()).map((x) => x.id)).toEqual([t.id]);
  });

  it('keeps memory local when sync is disabled', async () => {
    const { repo, cloud } = setup(false);
    const memory = await repo.addMemory({ text: 'Local memory only.', kind: 'preference' });
    expect((await repo.listMemory()).map((m) => m.id)).toEqual([memory.id]);
    await repo.updateMemory(memory.id, { expectedRevision: 1, status: 'suppressed' });
    expect(await repo.listMemory()).toEqual([]);
    await repo.removeMemory(memory.id);
    expect(cloud.calls).toEqual([]);
  });
});

describe('SyncRepository — memory', () => {
  it.each(['timeout', 'cancelled', 'unavailable', 'unexpected', undefined] as const)
    ('hydrates only server diagnostic values without adding them to client append bodies: %s', async reason => {
      const record: MessageRecord = { id: 'response', threadId: 'thread', userId: 'owner', role: 'assistant', content: 'Reply',
        status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:00Z', deletedAt: null,
        memoryDegradedReason: reason as MessageRecord['memoryDegradedReason'],
      };
      const hydrated = messageFromRecord(record);
      expect(hydrated.memoryDegradedReason).toBe(reason === 'unexpected' ? undefined : reason);
      expect(hydrated.createdAt).toBe(record.orderAt);
      expect(appendBodyFromMessage(hydrated)).not.toHaveProperty('memoryDegradedReason');
      expect(messageFromRecord({ ...record, role: 'user' }).memoryDegradedReason).toBeUndefined();
      const { repo, local } = setup(true);
      await repo.mergeServerMessage(hydrated);
      expect((await local.listMessages('thread'))[0].memoryDegradedReason).toBe(hydrated.memoryDegradedReason);
    });

  it('preserves split UTF-8 archive JSON and ordinary server errors', async () => {
    const content = { version: 2, scope: 'active-records', exportedAt: '2026-01-01T00:00:00Z',
      memories: [{ text: '\u00e9\u6771\ud83d\ude00' }], summary: null };
    const bytes = new TextEncoder().encode(JSON.stringify(content));
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
      controller.close();
    } });
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(body))
      .mockResolvedValueOnce(new Response(JSON.stringify({ error: { code: 'conflict', message: 'Excluded archive' } }), { status: 409 }));
    const client = new WataiApiClient({ getToken: async () => 'synthetic', fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
    expect(await client.exportMemoryArchive()).toEqual(content);
    expect(body.locked).toBe(false);
    await expect(client.previewMemoryArchive({})).rejects.toMatchObject({ code: 'conflict', message: 'Excluded archive', status: 409 });
  });

  it('rejects and unlocks a stalled archive reader on abort rather than treating cancellation as EOF', async () => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ cancel });
    const controller = new AbortController();
    const client = new WataiApiClient({ getToken: async () => 'synthetic', fetchImpl: vi.fn(async () => new Response(body)), baseUrl: 'https://api.fixture.test' });
    const rejected = expect(client.exportMemoryArchive(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    await vi.waitFor(() => expect(body.locked).toBe(true));
    controller.abort();
    await rejected;
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it.each(['export', 'preview'] as const)('rejects oversized declared %s response without buffering', async route => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); }, cancel }, { highWaterMark: 0 });
    const response = new Response(body, { headers: { 'content-length': String(72 * 1024 * 1024 + 1) } });
    const readText = vi.spyOn(response, 'text');
    const acquire = vi.spyOn(body, 'getReader');
    const client = new WataiApiClient({ getToken: async () => 'synthetic', fetchImpl: vi.fn(async () => response), baseUrl: 'https://api.fixture.test' });
    await expect(route === 'export' ? client.exportMemoryArchive() : client.previewMemoryArchive({}))
      .rejects.toMatchObject({ code: 'validation', message: 'Archive response exceeds the 72 MiB limit.' });
    expect(readText).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
  });

  it.each([undefined, '1'])('counts streamed archive bytes independently of declared length %s', async length => {
    const chunk = new Uint8Array(1024 * 1024).fill(32);
    const cancel = vi.fn();
    let reads = 0;
    const body = new ReadableStream<Uint8Array>({ pull(controller) {
      reads += 1;
      if (reads <= 73) controller.enqueue(chunk);
      else controller.close();
    }, cancel }, { highWaterMark: 0 });
    const response = new Response(body, { headers: length ? { 'content-length': length } : {} });
    const client = new WataiApiClient({ getToken: async () => 'synthetic', fetchImpl: vi.fn(async () => response), baseUrl: 'https://api.fixture.test' });
    await expect(client.exportMemoryArchive()).rejects.toMatchObject({ code: 'validation' });
    expect(reads).toBe(73);
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('uses v2 export and preview-only archive requests with explicit cancellation', async () => {
    const archive = { version: 2, scope: 'active-records', exportedAt: '2026-01-01T00:00:00Z', memories: [], summary: null };
    const preview = { added: 0, skipped: 0, rejected: [], archive };
    const transport = vi.fn<typeof fetch>().mockResolvedValueOnce(new Response(JSON.stringify(archive)))
      .mockResolvedValueOnce(new Response(JSON.stringify(preview)));
    const client = new WataiApiClient({ getToken: async () => 'synthetic-token', fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
    const controller = new AbortController();
    expect(await client.exportMemoryArchive(controller.signal)).toEqual(archive);
    expect(await client.previewMemoryArchive({ ...archive, mode: 'commit' }, controller.signal)).toEqual(preview);
    expect(transport.mock.calls[0][0]).toBe('https://api.fixture.test/memory/export?version=2');
    expect(transport.mock.calls[0][1]).toMatchObject({ method: 'POST', signal: controller.signal });
    expect(transport.mock.calls[1][0]).toBe('https://api.fixture.test/memory/import');
    expect(JSON.parse(transport.mock.calls[1][1]?.body as string)).toEqual({ ...archive, mode: 'preview' });
    controller.abort();
    await expect(client.exportMemoryArchive(controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(transport).toHaveBeenCalledTimes(2);
  });

  it.each(['inventory', 'profile'] as const)('aborts the real %s API transport and permits a fresh read after timeout', async kind => {
    vi.useFakeTimers();
    try {
      const { local, kv } = setup(true);
      let signal: AbortSignal | undefined;
      const transport = vi.fn<typeof fetch>((_url, options) => new Promise((_resolve, reject) => {
        signal = options?.signal ?? undefined;
        signal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const client = new WataiApiClient({ getToken: async () => 'synthetic-token', fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
      const repo = new SyncRepository(local, client, kv);
      const read = () => kind === 'inventory' ? repo.listMemory() : repo.getMemoryProfile();
      const work = read().catch(error => error);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await work).toMatchObject({ message: 'Memory request timed out. Retry loading memory.' });
      expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
      const result = kind === 'inventory' ? { memories: [] } : emptyMemoryProfile('u');
      transport.mockResolvedValueOnce(new Response(JSON.stringify(result), { status: 200 }));
      expect(await read()).toEqual(kind === 'inventory' ? [] : result);
      expect(transport.mock.calls[1][1]?.signal?.aborted).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('does not reset the inventory deadline after a slow first page', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const { repo, cloud } = setup(true);
      const list = vi.spyOn(cloud, 'listMemory').mockImplementationOnce(async () => {
        await new Promise(resolve => setTimeout(resolve, 10_000));
        return { memories: [], cursor: 'second' };
      }).mockImplementationOnce(async () => { await blocked; return { memories: [], cursor: 'third' }; });
      let failure: unknown;
      const work = repo.listMemory().catch(error => { failure = error.message; });
      await vi.advanceTimersByTimeAsync(15_001);
      expect(failure).toBe('Memory request timed out. Retry loading memory.');
      release(); await work; await vi.advanceTimersByTimeAsync(0);
      expect(list).toHaveBeenCalledTimes(2);
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it.each(['settings', 'local-inventory', 'cloud-inventory', 'next-page', 'profile', 'local-profile'] as const)
    ('bounds the entire memory read stalled at %s and stops late continuation', async stage => {
      vi.useFakeTimers();
      let release!: () => void;
      const blocked = new Promise<void>(resolve => { release = resolve; });
      try {
        const { repo, local, cloud } = setup(!stage.startsWith('local'));
        if (stage === 'settings') {
          const settings = await local.getSettings();
          vi.spyOn(local, 'getSettings').mockImplementationOnce(async () => { await blocked; return settings; });
        }
        if (stage === 'local-inventory') vi.spyOn(local, 'listMemory').mockImplementationOnce(async () => { await blocked; return []; });
        if (stage === 'local-profile') vi.spyOn(local, 'getMemoryProfile').mockImplementationOnce(async () => { await blocked; return emptyMemoryProfile('local'); });
        const list = vi.spyOn(cloud, 'listMemory');
        if (stage === 'cloud-inventory' || stage === 'next-page') {
          let pages = 0;
          list.mockImplementation(async () => {
            if (stage === 'next-page' && ++pages === 1) return { memories: [], cursor: 'next' };
            await blocked;
            return { memories: [], cursor: 'late' };
          });
        }
        if (stage === 'profile') vi.spyOn(cloud, 'getMemoryProfile').mockImplementationOnce(async () => { await blocked; return emptyMemoryProfile('u'); });
        let observed: unknown;
        const work = (stage.includes('profile') ? repo.getMemoryProfile() : repo.listMemory()).then(
          () => { observed = 'resolved'; }, error => { observed = error.message; },
        );
        await vi.advanceTimersByTimeAsync(15_001);
        const atDeadline = observed;
        release(); await work; await vi.advanceTimersByTimeAsync(0);
        expect(atDeadline).toBe('Memory request timed out. Retry loading memory.');
        expect(list).toHaveBeenCalledTimes(stage === 'cloud-inventory' ? 1 : stage === 'next-page' ? 2 : 0);
        expect(vi.getTimerCount()).toBe(0);
      } finally { release(); vi.useRealTimers(); }
    });

  it('rejects a pending profile immediately when device data is cleared', async () => {
    const { repo, cloud } = setup(true);
    let release!: (profile: MemoryProfileView) => void;
    const request = vi.spyOn(cloud, 'getMemoryProfile').mockReturnValueOnce(new Promise(resolve => { release = resolve; }));
    let observed: unknown;
    const work = repo.getMemoryProfile().then(() => { observed = 'resolved'; }, error => { observed = error.message; });
    await vi.waitFor(() => expect(request).toHaveBeenCalledOnce());
    await repo.deleteAll();
    await work;
    const afterClear = observed;
    release(emptyMemoryProfile('old'));
    expect(afterClear).toBe('Memory inventory was cleared during collection.');
    expect(await repo.getMemoryProfile()).toMatchObject({ userId: 'u' });
  });

  it('does not start inventory reads while clear-device is still running', async () => {
    const { repo, cloud, local } = setup(true);
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    vi.spyOn(local, 'deleteAll').mockImplementationOnce(() => blocked);
    const settings = vi.spyOn(local, 'getSettings');
    const list = vi.spyOn(cloud, 'listMemory');
    const clear = repo.deleteAll();
    try {
      await expect(repo.listMemory()).rejects.toThrow('Memory inventory was cleared during collection.');
      expect(settings).not.toHaveBeenCalled();
      expect(list).not.toHaveBeenCalled();
    } finally { release(); await clear; }
    expect(await repo.listMemory()).toEqual([]);
  });

  it('rejects longer cursor cycles even across empty memory pages', async () => {
    const { repo, cloud } = setup(true);
    const list = vi.spyOn(cloud, 'listMemory')
      .mockResolvedValueOnce({ memories: [], cursor: 'second' })
      .mockResolvedValueOnce({ memories: [], cursor: 'third' })
      .mockResolvedValueOnce({ memories: [], cursor: 'second' });
    await expect(repo.listMemory()).rejects.toThrow('Memory inventory returned a repeated cursor.');
    expect(list).toHaveBeenCalledTimes(3);
  });

  it('keeps explicit inactive-status inventories and unchanged errors authoritative', async () => {
    const { repo, cloud } = setup(true);
    const memory = await repo.addMemory({ text: 'Inactive entry.' });
    await repo.updateMemory(memory.id, { expectedRevision: 1, status: 'suppressed' });
    expect(await repo.listMemory({ status: 'suppressed' })).toMatchObject([{ id: memory.id, status: 'suppressed' }]);
    const failure = new CloudError('network', 'Synthetic failure', 0);
    vi.spyOn(cloud, 'listMemory').mockRejectedValueOnce(failure);
    await expect(repo.listMemory()).rejects.toBe(failure);
  });

  it('captures the memory query before awaits and keeps it stable across pages', async () => {
    const { repo, cloud } = setup(true);
    const query: ListMemoryQuery = { status: 'active', q: 'original', limit: 10 };
    const list = vi.spyOn(cloud, 'listMemory').mockImplementationOnce(async () => {
      query.status = 'suppressed'; query.q = 'later'; query.limit = 1;
      return { memories: [], cursor: 'next' };
    }).mockResolvedValueOnce({ memories: [] });
    const work = repo.listMemory(query);
    query.q = 'mutated-before-settings';
    expect(await work).toEqual([]);
    expect(list.mock.calls.map(([input]) => input)).toEqual([
      { status: 'active', q: 'original', limit: 10, cursor: undefined },
      { status: 'active', q: 'original', limit: 10, cursor: 'next' },
    ]);
  });

  it.each(['same-page', 'next-page', 'wrong-status'] as const)('rejects an inconsistent memory collection: %s', async mode => {
    const { repo, cloud } = setup(true);
    const memory = await repo.addMemory({ text: 'Saved entry.' });
    const list = vi.spyOn(cloud, 'listMemory');
    if (mode === 'same-page') list.mockResolvedValueOnce({ memories: [memory, memory] });
    else if (mode === 'next-page') list.mockResolvedValueOnce({ memories: [memory], cursor: 'next' }).mockResolvedValueOnce({ memories: [memory] });
    else list.mockResolvedValueOnce({ memories: [{ ...memory, status: 'suppressed' }] });
    await expect(repo.listMemory()).rejects.toThrow('Memory inventory changed during collection. Retry from the current state.');
  });

  it.each(['settings', 'cloud', 'cloud-error', 'local', 'local-error'] as const)('rejects inventory invalidated by clear during %s', async stage => {
    const { repo, local, cloud } = setup(!stage.startsWith('local'));
    if (stage === 'settings') {
      const settings = await local.getSettings();
      vi.spyOn(local, 'getSettings').mockImplementationOnce(async () => { await repo.deleteAll(); return settings; });
    }
    const list = vi.spyOn(cloud, 'listMemory');
    if (stage.startsWith('cloud')) list.mockImplementationOnce(async () => {
      await repo.deleteAll();
      if (stage === 'cloud-error') throw new Error('Obsolete request error');
      return { memories: [], cursor: 'next' };
    }).mockResolvedValue({ memories: [] });
    if (stage.startsWith('local')) vi.spyOn(local, 'listMemory').mockImplementationOnce(async () => {
      await repo.deleteAll();
      if (stage === 'local-error') throw new Error('Obsolete local error');
      return [];
    });
    await expect(repo.listMemory()).rejects.toThrow('Memory inventory was cleared during collection.');
    expect(list).toHaveBeenCalledTimes(stage.startsWith('cloud') ? 1 : 0);
    expect(await repo.listMemory()).toEqual([]);
  });

  it('detects a repeated initial memory cursor on the first page', async () => {
    const { repo, cloud } = setup(true);
    const list = vi.spyOn(cloud, 'listMemory').mockResolvedValue({ memories: [], cursor: 'same' });
    await expect(repo.listMemory({ cursor: 'same' })).rejects.toThrow('Memory inventory returned a repeated cursor.');
    expect(list).toHaveBeenCalledOnce();
  });

  it('keeps local-only profiles available when sync is disabled', async () => {
    const { repo, cloud } = setup(false);
    expect(await repo.getMemoryProfile()).toMatchObject({ userId: 'local' });
    expect(cloud.calls).toEqual([]);
  });

  it.each(['network', 'forbidden'] as const)('does not substitute a local profile for a failed account profile: %s', async code => {
    const { repo, local, cloud } = setup(true);
    const localProfile = vi.spyOn(local, 'getMemoryProfile');
    cloud.getMemoryProfile = async () => { throw new CloudError(code, 'Synthetic account-profile failure', code === 'network' ? 0 : 403); };
    await expect(repo.getMemoryProfile()).rejects.toMatchObject({ code });
    expect(localProfile).not.toHaveBeenCalled();
  });

  it('uses cloud memory CRUD when sync is enabled', async () => {
    const { repo, cloud } = setup(true);
    const memory = await repo.addMemory({ text: 'Cloud memory.', kind: 'preference' });
    await expect(repo.listMemory()).resolves.toHaveLength(1);
    await repo.updateMemory(memory.id, { expectedRevision: 1, status: 'suppressed' });
    await repo.removeMemory(memory.id);
    expect(cloud.calls).toEqual(['createMemory', 'listMemory', `patchMemory:${memory.id}`, `deleteMemory:${memory.id}`]);
  });

  it('uses cloud memory profile when sync is enabled', async () => {
    const { repo, cloud } = setup(true);
    await expect(repo.getMemoryProfile()).resolves.toMatchObject({ userId: 'u' });
    expect(cloud.calls).toEqual(['getMemoryProfile']);
  });

  it('drains every memory page without omitting equal-timestamp records', async () => {
    const { repo, cloud } = setup(true);
    for (let index = 0; index < 1000; index++) {
      cloud.memories.set(`memory-${index}`, {
        id: `memory-${index}`, userId: 'u', kind: 'fact', status: 'active', text: `Memory ${index}`,
        sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }], confidence: 1,
        salience: 0.5, pinned: false, sensitive: false, visibility: 'normal',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', useCount: 0,
      });
    }
    const memories = await repo.listMemory({ status: 'active', limit: 100 });
    expect(memories).toHaveLength(1000);
    expect(new Set(memories.map((memory) => memory.id)).size).toBe(1000);
    expect(cloud.calls.filter((call) => call === 'listMemory')).toHaveLength(10);
  });

  it('does not present local memory as a complete inventory when cloud listing fails', async () => {
    const { repo, cloud } = setup(true);
    cloud.listMemory = async () => { throw new CloudError('network', 'offline', 0); };
    await expect(repo.listMemory()).rejects.toMatchObject({ code: 'network' });
  });
});

describe('SyncRepository — push', () => {
  it.each(['changed', 'same-value', 'untouched'] as const)('preserves intent observed during hydration while respecting untouched server authority: %s', async intent => {
    const { repo, local, cloud, kv } = setup(true);
    const initial = await local.getSettings();
    if (intent !== 'changed') await local.saveSettings({ ...initial, personalization: { ...initial.personalization, memoryEnabled: false } });
    const obsolete = { operationId: 'obsolete', kind: 'settings.save', expectedRevision: 0, patch: { appearance: { theme: 'dark' } } };
    await kv.set('sync.queue', [obsolete]);
    const server = await cloud.getSettings();
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    cloud.getSettings = async () => { entered(); await blocked; return server; };
    const hydration = repo.hydrateSettings();
    await started;
    const fresh = { operationId: 'fresh', kind: 'settings.save', expectedRevision: 0, patch: { personalization: { memoryEnabled: false } } };
    const save = vi.spyOn(local, 'saveSettings');
    try {
      if (intent === 'changed') {
        const current = await local.getSettings();
        await local.saveSettings({ ...current, personalization: { ...current.personalization, memoryEnabled: false },
          voice: { ...current.voice, inputDeviceId: 'chosen-during-hydration' } });
      }
      if (intent !== 'untouched') await kv.set('sync.queue', [obsolete, fresh]);
    } finally { release(); await hydration; }
    for (const [written] of save.mock.calls) expect(written.personalization.memoryEnabled).toBe(intent === 'untouched');
    if (intent === 'changed') expect((await local.getSettings()).voice.inputDeviceId).toBe('chosen-during-hydration');
    expect(await kv.get('sync.queue')).toEqual(intent === 'untouched' ? [] : [fresh]);
    save.mockRestore();
  });

  it('preserves a current explicit memory enable after successful settings persistence', async () => {
    const { repo, local, cloud, kv } = setup(true);
    cloud.serverSettings = { ...DEFAULT_SETTINGS, personalization: { ...DEFAULT_SETTINGS.personalization,
      memoryEnabled: false, memory: { ...DEFAULT_SETTINGS.personalization.memory!, enabled: false, paused: true } } };
    await repo.hydrateSettings();
    const current = await local.getSettings();
    await repo.saveSettings({ ...current, personalization: { ...current.personalization,
      memoryEnabled: true, memory: { ...current.personalization.memory!, enabled: true, paused: false } } });
    await repo.push();
    expect((await local.getSettings()).personalization).toMatchObject({ memoryEnabled: true, memory: { enabled: true, paused: false } });
    expect(cloud.serverSettings?.personalization).toMatchObject({ memoryEnabled: true, memory: { enabled: true, paused: false } });
    expect(await kv.get('sync.queue')).toEqual([]);
  });

  it.each(['success', 'conflict'] as const)('never relaxes newer local privacy during stale settings %s writeback', async outcome => {
    const { repo, local, cloud, kv } = setup(true);
    await repo.hydrateSettings();
    const initial = await local.getSettings();
    await repo.saveSettings({ ...initial, appearance: { ...initial.appearance, theme: 'dark' } });
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const originalPatch = cloud.patchSettings.bind(cloud);
    cloud.patchSettings = async (patch, revision) => {
      entered(); await blocked;
      if (outcome === 'conflict') throw new CloudError('conflict', 'Synthetic stale version', 409);
      return originalPatch(patch, revision);
    };
    const pushing = repo.push();
    await started;
    const writes: Settings[] = [];
    const save = local.saveSettings.bind(local);
    const observe = vi.spyOn(local, 'saveSettings').mockImplementation(async settings => { writes.push(structuredClone(settings)); await save(settings); });
    try {
      const current = await local.getSettings();
      await local.saveSettings({ ...current,
        personalization: { ...current.personalization, memoryEnabled: false, memory: {
          ...DEFAULT_SETTINGS.personalization.memory!, enabled: false, paused: true, referenceSaved: false, referenceHistory: false, autoExtract: false,
        } },
        data: { ...current.data, retention: '30d', temporaryDefault: true },
        voice: { ...current.voice, inputDeviceId: 'new-device' },
      });
    } finally { release(); await pushing; observe.mockRestore(); }
    expect(writes.length).toBeGreaterThan(1);
    for (const written of writes) expect(written).toMatchObject({
      personalization: { memoryEnabled: false, memory: { enabled: false, paused: true, referenceSaved: false, referenceHistory: false, autoExtract: false } },
      data: { retention: '30d', temporaryDefault: true }, voice: { inputDeviceId: 'new-device' },
    });
    expect(await kv.get('sync.queue')).toEqual(outcome === 'success' ? [] : expect.arrayContaining([expect.objectContaining({ state: 'failed' })]));
  });

  it('retains a newer settings patch after an older acknowledgement and revision conflict', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await repo.hydrateSettings();
    const initial = await local.getSettings();
    await repo.saveSettings({ ...initial, appearance: { ...initial.appearance, theme: 'dark' } });
    const previous = (await kv.get<Array<{ operationId: string; patch: AccountSettingsPatch }>>('sync.queue'))![0];
    const sentPatch = structuredClone(previous.patch);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const patchSettings = cloud.patchSettings.bind(cloud);
    let attempts = 0;
    cloud.patchSettings = async (patch, revision) => {
      const sent = structuredClone(patch);
      if (++attempts === 1) { entered(); await blocked; }
      return patchSettings(sent, revision);
    };
    const pushing = repo.push();
    await started;
    try {
      const current = await local.getSettings();
      await repo.saveSettings({ ...current, personalization: { ...current.personalization, memoryEnabled: false } });
    } finally { release(); await pushing; }
    expect(attempts).toBe(2);
    expect(previous.patch).toEqual(sentPatch);
    const remaining = (await kv.get<Array<{ operationId: string; state?: string; patch: AccountSettingsPatch }>>('sync.queue'))!;
    expect(remaining).toHaveLength(1);
    expect(remaining[0]).toMatchObject({ kind: 'settings.save', state: 'failed', failure: { code: 'conflict' },
      patch: { personalization: { memoryEnabled: false } } });
    expect(remaining[0].operationId).not.toBe(previous.operationId);
  });

  it.each([false, true])('preserves a newer coalesced thread edit after an older in-flight result (failure: %s)', async failed => {
    const { repo, cloud, kv } = setup(true);
    await repo.createThread({ id: 'coalesced', title: 'Original' });
    await repo.push();
    await repo.updateThread('coalesced', { title: 'First' });
    const oldOperation = (await kv.get<Array<{ operationId: string; body: UpdateThreadBody }>>('sync.queue'))![0];
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const originalUpdate = cloud.updateThread.bind(cloud);
    let attempts = 0;
    cloud.updateThread = async (id, body) => {
      const sent = structuredClone(body);
      attempts += 1;
      if (attempts === 1) {
        entered(); await blocked;
        if (failed) throw new CloudError('validation', 'Synthetic stale failure', 400);
      }
      return originalUpdate(id, sent);
    };
    const pushing = repo.push();
    await started;
    let replacementId: string | undefined;
    try {
      await repo.updateThread('coalesced', { title: 'Newest', pinned: true });
      replacementId = (await kv.get<Array<{ operationId: string }>>('sync.queue'))![0].operationId;
    } finally { release(); await pushing; }
    expect(attempts).toBe(2);
    expect(replacementId).not.toBe(oldOperation.operationId);
    expect(oldOperation.body).toEqual({ title: 'First' });
    expect(cloud.threads.get('coalesced')).toMatchObject({ title: 'Newest', pinned: true });
    expect(await kv.get('sync.queue')).toEqual([]);
  });

  it.each(['not_found', 'network', 'forbidden', 'validation'] as const)('only confirms absent deletion outcomes, retaining other failures: %s', async code => {
    const { repo, local, cloud, kv } = setup(true);
    await local.createThread({ id: 'known', title: 'A' });
    await repo.deleteThread('known');
    cloud.deleteThread = vi.fn(async () => {
      throw new CloudError(code, 'Synthetic deletion outcome', code === 'not_found' ? 404 : code === 'network' ? 0 : code === 'forbidden' ? 403 : 400);
    });
    await repo.push();
    const queue = await kv.get<Array<{ state?: string; kind: string }>>('sync.queue');
    if (code === 'not_found') expect(queue).toEqual([]);
    else {
      expect(queue).toHaveLength(1);
      expect(queue![0].kind).toBe('thread.delete');
      expect(queue![0].state).toBe(code === 'validation' ? 'failed' : undefined);
    }
  });

  it('retains creation attempt knowledge after an unconfirmed transport failure', async () => {
    const { repo, cloud, kv } = setup(true);
    await repo.createThread({ id: 'uncertain', title: 'A' });
    cloud.createThread = async () => { throw new CloudError('network', 'Synthetic lost response', 0); };
    await repo.push();
    expect(await kv.get('sync.queue')).toMatchObject([{ kind: 'thread.create', attempted: true }]);
    await repo.deleteThread('uncertain');
    expect(await kv.get('sync.queue')).toMatchObject([{ kind: 'thread.delete', id: 'uncertain' }]);
  });

  it('does not dispatch a creation removed before its attempt marker is committed', async () => {
    const { repo, cloud, kv } = setup(true);
    await repo.createThread({ id: 'removed', title: 'A' });
    const originalUpdate = kv.update.bind(kv);
    vi.spyOn(kv, 'update').mockImplementationOnce(async (key, mutate) => {
      await kv.set(key, []);
      return originalUpdate(key, mutate);
    });
    await repo.push();
    expect(cloud.calls).toEqual([]);
  });

  it('preserves a server delete while a local creation is in flight', async () => {
    const { repo, cloud, local, kv } = setup(true);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const originalCreate = cloud.createThread.bind(cloud);
    cloud.createThread = async body => { entered(); await blocked; return originalCreate(body); };
    await repo.createThread({ id: 'late-create', title: 'Deleted while sending' });
    const pushing = repo.push();
    await started;
    try { await repo.deleteThread('late-create'); }
    finally { release(); await pushing; }
    expect(cloud.calls).toContain('deleteThread:late-create');
    expect(cloud.threads.get('late-create')?.deletedAt).toBeTruthy();
    expect(await local.getThread('late-create')).toBeNull();
    expect(await kv.get('sync.queue')).toEqual([]);
  });

  it('hydrates server privacy settings before backfill can push fresh-device defaults', async () => {
    const { repo, local, cloud } = setup(true);
    cloud.serverSettings = {
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memoryEnabled: false,
        memory: {
          enabled: false,
          paused: true,
          referenceSaved: false,
          referenceHistory: false,
          autoExtract: false,
        },
      },
      data: { ...DEFAULT_SETTINGS.data, sync: true },
    };

    await repo.backfill();
    await repo.sync();

    expect((await local.getSettings()).personalization.memoryEnabled).toBe(false);
    expect(cloud.serverSettings.personalization.memoryEnabled).toBe(false);
    expect(cloud.calls).toContain('getSettings');
    expect(cloud.calls).not.toContain('patchSettings');
  });

  it('creates the thread on the server with the same client id', async () => {
    const { repo, cloud, kv } = setup(true);
    const t = await repo.createThread({ title: 'Trip' });
    await repo.push();

    expect(cloud.calls).toContain(`createThread:${t.id}`);
    expect(cloud.threads.get(t.id)?.title).toBe('Trip');
    expect(await kv.get('sync.queue')).toEqual([]);
  });

  it('preserves an operation enqueued while an earlier push is in flight', async () => {
    const { repo, cloud, kv } = setup(true);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const started = new Promise<void>((resolve) => { entered = resolve; });
    const originalCreate = cloud.createThread.bind(cloud);
    cloud.createThread = async (body) => {
      if (body.title === 'First') {
        entered();
        await blocked;
      }
      return originalCreate(body);
    };
    await repo.createThread({ id: 'first', title: 'First' });
    const pushing = repo.push();
    await started;
    await repo.createThread({ id: 'second', title: 'Second' });
    release();
    await pushing;

    const queue = await kv.get<Array<{ kind: string; id?: string }>>('sync.queue');
    expect(cloud.threads.get('second')?.title).toBe('Second');
    expect(queue).toEqual([]);
  });

  it('drains through the exclusive cross-tab outbox lock when available', async () => {
    const { repo } = setup(true);
    const request = vi.fn(async (_name: string, _options: LockOptions, callback: () => Promise<void>) => callback());
    Object.defineProperty(navigator, 'locks', { configurable: true, value: { request } });
    await repo.createThread({ title: 'Locked' });
    await repo.push();
    expect(request).toHaveBeenCalledWith('watai.sync.outbox.v2', { mode: 'exclusive' }, expect.any(Function));
    Object.defineProperty(navigator, 'locks', { configurable: true, value: undefined });
  });

  it('pushes appended messages with their client id', async () => {
    const { repo, cloud } = setup(true);
    const t = await repo.createThread({ title: 'A' });
    await repo.appendMessage(msg({ id: 'm1', threadId: t.id, content: 'hello' }));
    await repo.push();

    expect(cloud.messages.get('m1')?.content).toBe('hello');
  });

  it('coalesces repeated updates to one thread into a single op', async () => {
    const { repo, kv } = setup(true);
    const t = await repo.createThread({ title: 'A' });
    await repo.updateThread(t.id, { pinned: true });
    await repo.updateThread(t.id, { archived: true });

    const queue = (await kv.get<Array<{ kind: string; id?: string; body?: unknown }>>('sync.queue'))!;
    const updates = queue.filter((o) => o.kind === 'thread.update' && o.id === t.id);
    expect(updates).toHaveLength(1);
    expect(updates[0].body).toEqual({ pinned: true, archived: true });
  });

  it('drops all pending ops and skips the server when deleting an unsynced thread', async () => {
    const { repo, cloud, kv } = setup(true);
    const t = await repo.createThread({ title: 'A' });
    await repo.appendMessage(msg({ id: 'm1', threadId: t.id }));
    await repo.deleteThread(t.id);

    expect(await kv.get('sync.queue')).toEqual([]);
    await repo.push();
    expect(cloud.calls).toEqual([]);
  });

  it('enqueues a delete for a thread that was already synced', async () => {
    const { repo, cloud } = setup(true);
    const t = await repo.createThread({ title: 'A' });
    await repo.push();
    await repo.deleteThread(t.id);
    await repo.push();

    expect(cloud.calls).toContain(`deleteThread:${t.id}`);
    expect(cloud.threads.get(t.id)?.deletedAt).not.toBeNull();
  });

  it('never enqueues temporary threads or their messages', async () => {
    const { repo, kv } = setup(true);
    const t = await repo.createThread({ title: 'tmp', temporary: true });
    await repo.appendMessage(msg({ id: 'm1', threadId: t.id }));
    expect(await kv.get('sync.queue')).toBeUndefined();
  });

  it('keeps retryable work pending and permanent failures inspectable', async () => {
    const retry = setup(true);
    await retry.repo.createThread({ title: 'A' });
    retry.cloud.createThread = async () => {
      throw new CloudError('network', 'offline', 0);
    };
    await retry.repo.push();
    expect((await retry.kv.get<unknown[]>('sync.queue'))!).toHaveLength(1);

    const perm = setup(true);
    await perm.repo.createThread({ title: 'A' });
    perm.cloud.createThread = async () => {
      throw new CloudError('validation', 'bad', 400);
    };
    await perm.repo.push();
    expect(await perm.kv.get('sync.queue')).toMatchObject([
      { kind: 'thread.create', state: 'failed', failure: { code: 'validation' } },
    ]);
  });

  it('keeps an op when access is forbidden (invite may be granted later), never dropping data', async () => {
    const denied = setup(true);
    await denied.repo.createThread({ title: 'A' });
    denied.cloud.createThread = async () => {
      throw new CloudError('forbidden', 'not invited', 403);
    };
    await denied.repo.push();
    expect((await denied.kv.get<unknown[]>('sync.queue'))!).toHaveLength(1);
  });

  it('pushes settings changes', async () => {
    const { repo, cloud } = setup(true);
    const s: Settings = {
      ...DEFAULT_SETTINGS,
      data: { ...DEFAULT_SETTINGS.data, sync: true },
      appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' },
    };
    await repo.saveSettings(s);
    await repo.push();
    expect(cloud.serverSettings?.appearance.theme).toBe('dark');
  });

  it('retains the stricter privacy policy after a stale offline patch conflicts', async () => {
    const { repo, local, cloud, kv } = setup(true);
    cloud.serverSettings = {
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memoryEnabled: false,
        memory: { enabled: false, paused: true, referenceSaved: false, referenceHistory: false, autoExtract: false },
      },
      data: { ...DEFAULT_SETTINGS.data, sync: true, retention: '30d' },
    };
    cloud.serverSettingsRevision = 1;
    await repo.hydrateSettings();

    const hydrated = await local.getSettings();
    await repo.saveSettings({
      ...hydrated,
      personalization: {
        ...hydrated.personalization,
        memoryEnabled: true,
        memory: { enabled: true, paused: false, referenceSaved: true, referenceHistory: true, autoExtract: true },
      },
      data: { ...hydrated.data, retention: 'forever' },
    });
    cloud.serverSettingsRevision = 2;
    await repo.push();

    const effective = await local.getSettings();
    expect(effective.personalization.memoryEnabled).toBe(false);
    expect(effective.personalization.memory?.paused).toBe(true);
    expect(effective.data.retention).toBe('30d');
    expect(await kv.get('sync.queue')).toMatchObject([
      { kind: 'settings.save', state: 'failed', failure: { code: 'conflict' } },
    ]);
  });

  it('keeps microphone device selection local and sends no account patch', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await repo.hydrateSettings();
    cloud.calls.length = 0;
    const current = await local.getSettings();
    await repo.saveSettings({ ...current, voice: { ...current.voice, inputDeviceId: 'microphone-local' } });
    await repo.push();

    expect((await local.getSettings()).voice.inputDeviceId).toBe('microphone-local');
    expect(cloud.calls).not.toContain('patchSettings');
    expect(await kv.get('sync.queue')).toEqual([]);
  });
});

describe('SyncRepository — pull', () => {
  it('merges new server threads into local and advances the cursor', async () => {
    const { repo, local, cloud, kv } = setup(true);
    cloud.seedThread({ id: 's1', title: 'Server', updatedAt: '2026-02-01T00:00:05Z' });
    await repo.pull();

    expect((await local.getThread('s1'))?.title).toBe('Server');
    expect(await kv.get('sync.cursor.threads')).toBe('2026-02-01T00:00:05Z');
  });

  it('replays an equal-timestamp boundary so a delayed message is not lost or duplicated', async () => {
    const { repo, local, cloud } = setup(true);
    const boundary = '2026-02-01T00:00:05Z';
    cloud.seedThread({ id: 't1', title: 'T', messageCount: 1, updatedAt: boundary });
    cloud.seedMessage({ id: 'm1', threadId: 't1', content: 'first', createdAt: boundary });
    await repo.pull();

    cloud.seedThread({ id: 't1', title: 'T', messageCount: 2, updatedAt: boundary });
    cloud.seedMessage({ id: 'm2', threadId: 't1', content: 'late same-time', createdAt: boundary });
    await repo.pull();

    expect((await local.listMessages('t1')).map((message) => message.id).sort()).toEqual(['m1', 'm2']);
  });

  it('retries a thread pull without an invalid cursor when the server requires resync', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await kv.set('sync.cursor.threads', 'legacy-invalid');
    cloud.seedThread({ id: 't1', title: 'Recovered', updatedAt: '2026-02-01T00:00:05Z' });
    const original = cloud.listThreads.bind(cloud);
    cloud.listThreads = vi.fn(async (options) => {
      if (options?.since) throw new CloudError('validation', 'resync', 400, { resyncRequired: true });
      return original(options);
    });

    await repo.pull();

    expect((await local.getThread('t1'))?.title).toBe('Recovered');
    expect(cloud.listThreads).toHaveBeenCalledTimes(2);
    expect(await kv.get('sync.cursor.threads')).toBe('2026-02-01T00:00:05Z');
  });

  it('retries a message pull without an invalid cursor when the server requires resync', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await kv.set('sync.cursor.messages.t1', 'legacy-invalid');
    cloud.seedThread({ id: 't1', title: 'T', messageCount: 1, updatedAt: '2026-02-01T00:00:05Z' });
    cloud.seedMessage({ id: 'm1', threadId: 't1', content: 'Recovered', createdAt: '2026-02-01T00:00:05Z' });
    const original = cloud.listMessages.bind(cloud);
    cloud.listMessages = vi.fn(async (threadId, options) => {
      if (options?.since) throw new CloudError('validation', 'resync', 400, { resyncRequired: true });
      return original(threadId, options);
    });

    await repo.pull();

    expect((await local.listMessages('t1')).map((message) => message.id)).toEqual(['m1']);
    expect(cloud.listMessages).toHaveBeenCalledTimes(2);
    expect(await kv.get('sync.cursor.messages.t1')).toBe('2026-02-01T00:00:05Z');
  });

  it('applies last-write-wins by updatedAt', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 'x', title: 'Local', updatedAt: '2026-03-01T00:00:10Z' });

    cloud.seedThread({ id: 'x', title: 'OldServer', updatedAt: '2026-02-01T00:00:00Z' });
    await repo.pull();
    expect((await local.getThread('x'))?.title).toBe('Local');

    cloud.seedThread({ id: 'x', title: 'NewServer', updatedAt: '2026-04-01T00:00:00Z' });
    await repo.pull();
    expect((await local.getThread('x'))?.title).toBe('NewServer');
  });

  it('inserts server messages without bumping the thread, and skips known ids', async () => {
    const { repo, local, cloud, kv } = setup(true);
    cloud.seedThread({ id: 't1', title: 'T', messageCount: 2, updatedAt: '2026-02-01T00:00:05Z' });
    cloud.seedMessage({ id: 'sm1', threadId: 't1', content: 'one', createdAt: '2026-02-01T00:00:01Z' });
    cloud.seedMessage({ id: 'sm2', threadId: 't1', content: 'two', createdAt: '2026-02-01T00:00:02Z' });
    // a locally-authored copy of sm1 must not be clobbered
    await local.putMessageRaw(msg({ id: 'sm1', threadId: 't1', content: 'LOCAL' }));

    await repo.pull();

    expect((await local.getThread('t1'))?.messageCount).toBe(2);
    const msgs = await local.listMessages('t1');
    expect(msgs.find((m) => m.id === 'sm1')?.content).toBe('LOCAL');
    expect(msgs.find((m) => m.id === 'sm2')?.content).toBe('two');
    expect(await kv.get('sync.cursor.messages.t1')).toBe('2026-02-01T00:00:02Z');
  });

  it('removes a local thread when the server returns a tombstone', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 'g', title: 'Gone', updatedAt: '2026-02-01T00:00:01Z' });
    cloud.seedThread({ id: 'g', updatedAt: '2026-03-01T00:00:00Z', deletedAt: '2026-03-01T00:00:00Z' });

    await repo.pull();

    expect(await local.getThread('g')).toBeNull();
  });

  it('reports the thread ids whose messages/record changed (drives the UI refresh)', async () => {
    const { repo, cloud } = setup(true);
    cloud.seedThread({ id: 't1', title: 'T', updatedAt: '2026-02-01T00:00:05Z' });
    cloud.seedMessage({ id: 'sm1', threadId: 't1', content: 'hi', createdAt: '2026-02-01T00:00:01Z' });

    const changed = await repo.pull();
    expect(changed.has('t1')).toBe(true);

    // A second pull with nothing new reports no changes (no spurious UI refresh).
    const again = await repo.pull();
    expect(again.size).toBe(0);
  });

  it('repairs a known streaming assistant message by fetching the full thread window', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await kv.set('sync.cursor.messages.t1', '2026-02-01T00:00:09Z');
    await local.putMessageRaw(
      msg({
        id: 'am1',
        threadId: 't1',
        role: 'assistant',
        content: '',
        status: 'streaming',
        createdAt: '2026-02-01T00:00:01Z',
        toolCalls: [{ id: 'g1', kind: 'image', name: 'generate_image', status: 'running', imageSize: '1024x1024' }],
      }),
    );
    cloud.seedMessage({
      id: 'am1',
      threadId: 't1',
      role: 'assistant',
      content: 'Done.',
      status: 'complete',
      createdAt: '2026-02-01T00:00:01Z',
      orderAt: '2026-02-01T00:00:01Z',
      images: [
        {
          id: 'img1',
          blobPath: 'u/t1/img1.png',
          prompt: 'a cat',
          size: '1024x1024',
          outputFormat: 'png',
          createdAt: '2026-02-01T00:00:02Z',
        },
      ],
      toolCalls: [{ id: 'g1', kind: 'image', name: 'generate_image', status: 'done' }],
    });

    const messages = await repo.listMessages('t1');

    expect(messages[0]).toMatchObject({ content: 'Done.', status: 'complete' });
    expect(messages[0].images?.[0].blobPath).toBe('u/t1/img1.png');
    expect(messages[0].toolCalls?.[0].status).toBe('done');
    expect(await kv.get('sync.cursor.messages.t1')).toBe('2026-02-01T00:00:09Z');
  });

  it('reconciles a stale terminal assistant message that gained web images on the server', async () => {
    const { repo, local, cloud } = setup(true);
    cloud.seedThread({ id: 't1', title: 'T', updatedAt: '2026-02-01T00:00:05Z' });
    // A terminal copy this device stored before the web images were attached to the reply.
    await local.putMessageRaw(
      msg({
        id: 'am1',
        threadId: 't1',
        role: 'assistant',
        content: 'Here are some cats.',
        status: 'complete',
        createdAt: '2026-02-01T00:00:02Z',
      }),
    );
    cloud.seedMessage({
      id: 'am1',
      threadId: 't1',
      role: 'assistant',
      content: 'Here are some cats.',
      status: 'complete',
      createdAt: '2026-02-01T00:00:02Z',
      orderAt: '2026-02-01T00:00:02Z',
      webImages: [
        { id: 'w1', url: 'https://img.example/cat1.jpg', description: 'a cat' },
        { id: 'w2', url: 'https://img.example/cat2.jpg' },
      ],
    });

    await repo.pull();

    const am1 = (await local.listMessages('t1')).find((m) => m.id === 'am1');
    expect(am1?.webImages).toHaveLength(2);
    expect(am1?.webImages?.[0]).toMatchObject({ id: 'w1', url: 'https://img.example/cat1.jpg' });
  });

  it('heals a stale terminal message on thread open even when the delta cursor is past it', async () => {
    const { repo, local, cloud, kv } = setup(true);
    // Cursor already advanced past the message, so a delta pull would never re-fetch it.
    await kv.set('sync.cursor.messages.t1', '2026-02-01T00:00:09Z');
    await local.putMessageRaw(
      msg({
        id: 'am1',
        threadId: 't1',
        role: 'assistant',
        content: 'Here are some cats.',
        status: 'complete',
        createdAt: '2026-02-01T00:00:02Z',
      }),
    );
    cloud.seedMessage({
      id: 'am1',
      threadId: 't1',
      role: 'assistant',
      content: 'Here are some cats.',
      status: 'complete',
      createdAt: '2026-02-01T00:00:02Z',
      orderAt: '2026-02-01T00:00:02Z',
      webImages: [{ id: 'w1', url: 'https://img.example/cat1.jpg' }],
    });

    const messages = await repo.listMessages('t1');

    expect(messages.find((m) => m.id === 'am1')?.webImages).toHaveLength(1);
    // A full re-pull happened on first open (not gated by the delta cursor).
    expect(cloud.calls).toContain('listMessages:t1');
  });

  it('leaves a terminal assistant message untouched when the server signature matches', async () => {
    const { repo, local, cloud } = setup(true);
    await local.putMessageRaw(
      msg({
        id: 'am1',
        threadId: 't1',
        role: 'assistant',
        content: 'Here are some cats.',
        status: 'complete',
        createdAt: '2026-02-01T00:00:02Z',
        webImages: [{ id: 'local-w', url: 'https://img.example/cat1.jpg' }],
      }),
    );
    // Same status, content length and array counts => identical signature, so no redundant write.
    cloud.seedMessage({
      id: 'am1',
      threadId: 't1',
      role: 'assistant',
      content: 'Here are some cats.',
      status: 'complete',
      createdAt: '2026-02-01T00:00:02Z',
      orderAt: '2026-02-01T00:00:02Z',
      webImages: [{ id: 'server-w', url: 'https://img.example/other.jpg' }],
    });

    const am1 = (await repo.listMessages('t1')).find((m) => m.id === 'am1');
    // Not replaced: the local copy (with its own web-image id) is preserved.
    expect(am1?.webImages?.[0].id).toBe('local-w');
  });

  it('repairs stale assistant chronology even when its content signature is unchanged', async () => {
    const { repo, local, cloud, kv } = setup(true);
    await kv.set('sync.cursor.messages.t1', '2026-02-01T00:00:09Z');
    await local.putMessageRaw(msg({
      id: 'u1', threadId: 't1', role: 'user', content: 'prompt', status: 'complete',
      createdAt: '2026-02-01T00:00:02Z',
    }));
    // Legacy/device-local corruption: identical assistant content but a timestamp before its prompt.
    await local.putMessageRaw(msg({
      id: 'a1', threadId: 't1', role: 'assistant', content: 'answer', status: 'complete',
      createdAt: '2026-02-01T00:00:01Z',
    }));
    cloud.seedMessage({
      id: 'u1', threadId: 't1', role: 'user', content: 'prompt', status: 'complete',
      createdAt: '2026-02-01T00:00:02Z', orderAt: '2026-02-01T00:00:02Z',
    });
    cloud.seedMessage({
      id: 'a1', threadId: 't1', role: 'assistant', content: 'answer', status: 'complete',
      createdAt: '2026-02-01T00:00:10Z', orderAt: '2026-02-01T00:00:03Z',
    });

    const messages = await repo.listMessages('t1');

    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(messages.find((message) => message.id === 'a1')?.createdAt).toBe('2026-02-01T00:00:03Z');
  });

  it('repairs user chronology without dropping local-only attachment fields', async () => {
    const { repo, local, cloud } = setup(true);
    await local.putMessageRaw(msg({
      id: 'u1', threadId: 't1', role: 'user', content: 'prompt', status: 'complete',
      createdAt: '2026-02-01T00:00:09Z',
      attachments: [{ id: 'att1', kind: 'image', mime: 'image/png', bytes: 3, localBlobKey: 'att-local' }],
    }));
    await local.putMessageRaw(msg({
      id: 'a1', threadId: 't1', role: 'assistant', content: 'answer', status: 'complete',
      createdAt: '2026-02-01T00:00:03Z',
    }));
    cloud.seedMessage({
      id: 'u1', threadId: 't1', role: 'user', content: 'prompt', status: 'complete',
      createdAt: '2026-02-01T00:00:09Z', orderAt: '2026-02-01T00:00:02Z',
    });
    cloud.seedMessage({
      id: 'a1', threadId: 't1', role: 'assistant', content: 'answer', status: 'complete',
      createdAt: '2026-02-01T00:00:10Z', orderAt: '2026-02-01T00:00:03Z',
    });

    const messages = await repo.listMessages('t1');
    const user = messages.find((message) => message.id === 'u1');

    expect(messages.map((message) => message.id)).toEqual(['u1', 'a1']);
    expect(user?.createdAt).toBe('2026-02-01T00:00:02Z');
    expect(user?.attachments?.[0].localBlobKey).toBe('att-local');
  });
});

describe('SyncRepository — run lock', () => {
  const freshLock = (over: Partial<ThreadLock>): ThreadLock => ({
    deviceId: 'other-device',
    deviceLabel: 'Safari on iPhone',
    acquiredAt: new Date().toISOString(),
    heartbeatAt: new Date().toISOString(),
    ...over,
  });

  it('acquires the lock when the thread is free', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 't1', title: 'A' });
    cloud.seedThread({ id: 't1' });
    const res = await repo.acquireRunLock('t1');
    expect(res.acquired).toBe(true);
    expect(cloud.calls.some((c) => c.startsWith('acquireThreadLock:t1'))).toBe(true);
    expect(cloud.threads.get('t1')?.lock).toBeTruthy();
  });

  it('reports the holder (does not acquire) when another live device holds it', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 't1', title: 'A' });
    cloud.seedThread({ id: 't1', lock: freshLock({ deviceLabel: 'Edge on macOS' }) });
    const res = await repo.acquireRunLock('t1');
    expect(res.acquired).toBe(false);
    expect(res.heldBy?.deviceLabel).toBe('Edge on macOS');
  });

  it('is a no-op (acquired) when sync is off — never blocks local generation', async () => {
    const { repo, cloud } = setup(false);
    expect(await repo.acquireRunLock('anything')).toEqual({ acquired: true });
    expect(cloud.calls).toEqual([]);
  });

  it('is a no-op (acquired) for a local-only thread', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 'tmp', title: 'T', temporary: true });
    expect(await repo.acquireRunLock('tmp')).toEqual({ acquired: true });
    expect(cloud.calls).toEqual([]);
  });

  it('releaseRunLock clears the server lock held by this device', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 't1', title: 'A' });
    cloud.seedThread({ id: 't1' });
    await repo.acquireRunLock('t1');
    await repo.releaseRunLock('t1');
    expect(cloud.threads.get('t1')?.lock ?? null).toBeNull();
  });

  it('getThreadLock returns the current server lock', async () => {
    const { repo, local, cloud } = setup(true);
    await local.createThread({ id: 't1', title: 'A' });
    cloud.seedThread({ id: 't1', lock: freshLock({ deviceLabel: 'Chrome on Windows' }) });
    expect((await repo.getThreadLock('t1'))?.deviceLabel).toBe('Chrome on Windows');
  });

  it('getThreadLock is null with sync off', async () => {
    const { repo } = setup(false);
    expect(await repo.getThreadLock('t1')).toBeNull();
  });
});

describe('SyncRepository — deleteAll', () => {
  it.each(['threads', 'messages'])('discards a stale %s response after clearing but allows a fresh later pull', async stage => {
    const { repo, cloud, local, kv } = setup(true);
    await cloud.createThread({ id: 'remote', title: 'Retained remotely' });
    await cloud.appendMessage('remote', { id: 'remote-message', role: 'user', content: 'Server content' });
    const clearAfter = async <Result,>(promise: Promise<Result>) => {
      const result = await promise;
      await repo.deleteAll();
      return result;
    };
    if (stage === 'threads') {
      const list = cloud.listThreads.bind(cloud);
      vi.spyOn(cloud, 'listThreads').mockImplementationOnce((...args) => clearAfter(list(...args)));
    } else {
      const list = cloud.listMessages.bind(cloud);
      vi.spyOn(cloud, 'listMessages').mockImplementationOnce((...args) => clearAfter(list(...args)));
    }
    expect(await repo.pull()).toEqual(new Set());
    expect(await local.listThreads()).toEqual([]);
    expect(await local.listMessages('remote')).toEqual([]);
    expect(await kv.keys()).toEqual([]);
    await repo.pull();
    expect(await local.getThread('remote')).not.toBeNull();
    expect(await local.listMessages('remote')).toHaveLength(1);
  });

  it('does not restore settings or hydration flags from a pre-clear remote read', async () => {
    const { repo, cloud, local, kv } = setup(true);
    const get = cloud.getSettings.bind(cloud);
    const read = vi.spyOn(cloud, 'getSettings').mockImplementationOnce(async () => {
      const settings = await get();
      await repo.deleteAll();
      return settings;
    });
    const save = vi.spyOn(local, 'saveSettings');
    await repo.hydrateSettings();
    expect(read).toHaveBeenCalledOnce();
    expect(save).not.toHaveBeenCalled();
    expect(await kv.keys()).toEqual([]);
  });

  it.each(['success', 'conflict'])('does not restore cleared settings after a delayed %s and preserves fresh work', async outcome => {
    const { repo, cloud, local, kv } = setup(true);
    await kv.set('sync.queue', [{ operationId: 'old-settings', kind: 'settings.save', expectedRevision: 1, patch: { appearance: { theme: 'dark' } } }]);
    let resolve!: (settings: SettingsSnapshot) => void;
    let reject!: (error: Error) => void;
    const patch = vi.spyOn(cloud, 'patchSettings').mockReturnValue(new Promise<SettingsSnapshot>((done, fail) => { resolve = done; reject = fail; }));
    const save = vi.spyOn(local, 'saveSettings');
    const getSettings = vi.spyOn(cloud, 'getSettings');
    const create = vi.spyOn(cloud, 'createThread');
    const pushing = repo.push();
    await vi.waitFor(() => expect(patch).toHaveBeenCalledOnce());
    await repo.deleteAll();
    await repo.createThread({ id: 'fresh-after-clear', title: 'Fresh' });
    if (outcome === 'success') resolve({ ...DEFAULT_SETTINGS, revision: 44 });
    else reject(new CloudError('conflict', 'Changed remotely', 409));
    await pushing;
    expect(save).not.toHaveBeenCalled();
    expect(getSettings).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect((await kv.keys()).filter(key => key !== 'sync.queue')).toEqual([]);
    await repo.push();
    expect(create).toHaveBeenCalledWith(expect.objectContaining({ id: 'fresh-after-clear' }));
  });

  it('does not dispatch settings after clearing during the pre-dispatch settings read', async () => {
    const { repo, cloud, local, kv } = setup(true);
    await kv.set('sync.queue', [{ operationId: 'old-settings', kind: 'settings.save', expectedRevision: 1, patch: { appearance: { theme: 'dark' } } }]);
    const original = local.settings;
    vi.spyOn(local, 'getSettings').mockResolvedValueOnce(original).mockImplementationOnce(async () => {
      await repo.deleteAll();
      return original;
    });
    const patch = vi.spyOn(cloud, 'patchSettings');
    await repo.push();
    expect(patch).not.toHaveBeenCalled();
    expect(await kv.get('sync.queue')).toBeUndefined();
  });

  it('does not migrate or dispatch a legacy queue snapshot loaded before device clearing', async () => {
    const { repo, cloud, kv } = setup(true);
    await kv.set('sync.queue', [{ kind: 'thread.create', id: 'stale', body: { id: 'stale', title: 'Cleared thread' } }]);
    const get = kv.get.bind(kv);
    let cleared = false;
    vi.spyOn(kv, 'get').mockImplementation(async key => {
      const value = await get(key);
      if (key === 'sync.queue' && !cleared) {
        cleared = true;
        await repo.deleteAll();
      }
      return value;
    });
    const create = vi.spyOn(cloud, 'createThread');
    await repo.push();
    expect(create).not.toHaveBeenCalled();
    expect(await get('sync.queue')).toBeUndefined();
  });

  it('clears all sync.* bookkeeping keys', async () => {
    const { repo, kv } = setup(true);
    await repo.createThread({ title: 'A' });
    await kv.set('sync.cursor.threads', '2026-02-01T00:00:00Z');

    await repo.deleteAll();

    expect(await kv.get('sync.queue')).toBeUndefined();
    expect(await kv.get('sync.cursor.threads')).toBeUndefined();
  });
});

describe('SyncRepository — image cloud storage', () => {
  it.each(['http', 'missing-body', 'read-error', 'cancel-error'] as const)
    ('does not cache or fall back to buffering an unusable asset response: %s', async failure => {
      const { local, cloud, kv } = setup(true);
      const cancel = vi.fn(async () => { if (failure === 'cancel-error') throw new Error('Synthetic cancellation failure'); });
      const body = new ReadableStream<Uint8Array>({
        pull(controller) { controller.error(new Error('Synthetic read failure')); }, cancel,
      }, { highWaterMark: 0 });
      const response = new Response(failure === 'missing-body' ? null : body, {
        status: failure === 'http' ? 503 : 200,
        ...(failure === 'cancel-error' ? { headers: { 'content-length': String(25 * 1024 * 1024 + 1) } } : {}),
      });
      const fallbackBlob = vi.spyOn(response, 'blob');
      const fallbackBuffer = vi.spyOn(response, 'arrayBuffer');
      const repo = new SyncRepository(local, cloud, kv, vi.fn(async () => response));
      const put = vi.spyOn(local, 'putBlob');
      expect(await repo.resolveAssetUrl({ id: 'failed', blobPath: 'u/t1/failed.png' })).toBe('');
      expect(put).not.toHaveBeenCalled();
      expect(fallbackBlob).not.toHaveBeenCalled();
      expect(fallbackBuffer).not.toHaveBeenCalled();
      expect(body.locked).toBe(false);
      if (failure === 'http' || failure === 'cancel-error') expect(cancel).toHaveBeenCalledOnce();
    });

  it('rejects oversized declared asset bytes without acquiring a reader', async () => {
    const { local, cloud, kv } = setup(true);
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({
      pull(controller) { controller.enqueue(new Uint8Array([1])); controller.close(); }, cancel,
    }, { highWaterMark: 0 });
    const acquire = vi.spyOn(body, 'getReader');
    const response = new Response(body, { headers: { 'content-length': String(25 * 1024 * 1024 + 1) } });
    const repo = new SyncRepository(local, cloud, kv, vi.fn(async () => response));
    const put = vi.spyOn(local, 'putBlob');
    expect(await repo.resolveAssetUrl({ id: 'large', blobPath: 'u/t1/large.png' })).toBe('');
    expect(put).not.toHaveBeenCalled();
    expect(acquire).not.toHaveBeenCalled();
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('counts actual streamed asset bytes and accepts the exact limit with its MIME', async () => {
    const boundary = new Uint8Array(25 * 1024 * 1024);
    for (const declaredLength of [undefined, '1', String(boundary.byteLength)]) {
      const oversized = declaredLength !== String(boundary.byteLength);
      const { local, cloud, kv } = setup(true);
      const cancel = vi.fn();
      let reads = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(controller) {
          reads += 1;
          if (reads === 1) controller.enqueue(boundary);
          else if (reads === 2 && oversized) controller.enqueue(new Uint8Array([1]));
          else controller.close();
        }, cancel,
      }, { highWaterMark: 0 });
      const headers = new Headers({ 'content-type': 'image/png' });
      if (declaredLength) headers.set('content-length', declaredLength);
      const response = new Response(body, { headers });
      const repo = new SyncRepository(local, cloud, kv, vi.fn(async () => response));
      const put = vi.spyOn(local, 'putBlob');
      const result = await repo.resolveAssetUrl({ id: 'boundary', blobPath: 'u/t1/boundary.png' });
      if (oversized) {
        expect(result).toBe('');
        expect(put).not.toHaveBeenCalled();
        expect(cancel).toHaveBeenCalledOnce();
        expect(reads).toBe(2);
      } else {
        expect(result).toBeTruthy();
        expect(put).toHaveBeenCalledOnce();
        expect(put.mock.calls[0][1].size).toBe(boundary.byteLength);
        expect(put.mock.calls[0][1].type).toBe('image/png');
        expect(cancel).not.toHaveBeenCalled();
      }
      expect(body.locked).toBe(false);
    }
  });

  it('cancels and unlocks a stalled body at the shared asset deadline', async () => {
    vi.useFakeTimers();
    try {
      const { local, cloud, kv } = setup(true);
      const cancel = vi.fn();
      const body = new ReadableStream<Uint8Array>({ cancel });
      const response = new Response(body);
      const repo = new SyncRepository(local, cloud, kv, vi.fn(async () => response));
      const put = vi.spyOn(local, 'putBlob');
      const work = repo.resolveAssetUrl({ id: 'stalled', blobPath: 'u/t1/stalled.png' });
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await work).toBe('');
      expect(put).not.toHaveBeenCalled();
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('preserves native response stream bytes and MIME in a local Blob', async () => {
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new Uint8Array([1, 2, 3])); controller.close(); },
    }), { headers: { 'content-type': 'image/png' } });
    const reader = response.body!.getReader();
    const chunk = await reader.read();
    expect(ArrayBuffer.isView(chunk.value)).toBe(true);
    expect(chunk.value?.byteLength).toBe(3);
    const blob = new Blob([chunk.value!], { type: response.headers.get('content-type')! });
    expect(blob.size).toBe(3);
    expect(blob.type).toBe('image/png');
    expect((await reader.read()).done).toBe(true);
    reader.releaseLock();
    expect(response.body!.locked).toBe(false);
  });

  it.each(['library', 'grant'].flatMap(method => ['before', 'token'].map(stage => ({ method, stage }))))
    ('does not dispatch an aborted asset API request: %j', async ({ method, stage }) => {
      const controller = new AbortController();
      let provideToken!: (value: string) => void;
      const token = vi.fn(() => new Promise<string>(resolve => { provideToken = resolve; }));
      const transport = vi.fn();
      const client = new WataiApiClient({ getToken: token, fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
      if (stage === 'before') controller.abort();
      const work = method === 'library' ? client.getLibraryItem('lib', controller.signal) :
        client.requestSas({ threadId: 'thread', assetId: 'asset', op: 'read', contentType: 'image/png' }, controller.signal);
      const rejected = expect(work).rejects.toMatchObject({ name: 'AbortError' });
      if (stage === 'token') { controller.abort(); provideToken('synthetic-token'); }
      await rejected;
      expect(token).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1);
      expect(transport).not.toHaveBeenCalled();
    });

  it('aborts the real client transport on resolution timeout and clears timer state', async () => {
    vi.useFakeTimers();
    try {
      const { local, kv } = setup(true);
      let transportSignal: AbortSignal | undefined;
      const transport = vi.fn((_url: string | URL | Request, options?: RequestInit) => new Promise<Response>((_resolve, reject) => {
        transportSignal = options?.signal ?? undefined;
        transportSignal?.addEventListener('abort', () => reject(new DOMException('Aborted', 'AbortError')), { once: true });
      }));
      const client = new WataiApiClient({ getToken: async () => 'synthetic-token', fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
      const repo = new SyncRepository(local, client, kv);
      const work = repo.resolveAssetUrl({ id: 'asset', libraryItemId: 'lib' });
      await vi.advanceTimersByTimeAsync(15_001);
      expect(await work).toBe('');
      expect(transportSignal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it('does not abort an already-successful resolution when its old deadline passes', async () => {
    vi.useFakeTimers();
    try {
      const { local, kv } = setup(true);
      let transportSignal: AbortSignal | undefined;
      const transport = vi.fn(async (_url: string | URL | Request, options?: RequestInit) => {
        transportSignal = options?.signal ?? undefined;
        return { ok: true, status: 200, text: async () => JSON.stringify({ id: 'lib', state: 'active', url: 'https://blob.test/ready' }) } as Response;
      });
      const client = new WataiApiClient({ getToken: async () => 'synthetic-token', fetchImpl: transport, baseUrl: 'https://api.fixture.test' });
      const repo = new SyncRepository(local, client, kv);
      expect(await repo.resolveAssetUrl({ id: 'asset', libraryItemId: 'lib' })).toBe('https://blob.test/ready');
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(15_001);
      expect(transportSignal?.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each(['cache', 'library', 'grant', 'fetch', 'body'] as const)('bounds asset resolution stalled at %s and ignores late continuation', async stage => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const { local, cloud, kv } = setup(true);
      const download = vi.fn(async () => {
        if (stage === 'fetch') await blocked;
        return new Response(new ReadableStream<Uint8Array>({
          async pull(controller) {
            if (stage === 'body') await blocked;
            controller.enqueue(new Uint8Array([1])); controller.close();
          },
        }, { highWaterMark: 0 }));
      });
      const repo = new SyncRepository(local, cloud, kv, download as typeof fetch);
      if (stage === 'cache') vi.spyOn(local, 'getBlobUrl').mockImplementationOnce(async () => { await blocked; return ''; });
      if (stage === 'library') vi.spyOn(cloud, 'getLibraryItem').mockImplementation(async () => {
        await blocked; return { id: 'lib', state: 'active', url: 'https://blob.test/late' } as LibraryItemDTO;
      });
      const grant = cloud.requestSas.bind(cloud);
      const request = vi.spyOn(cloud, 'requestSas').mockImplementation(async input => { if (stage === 'grant') await blocked; return grant(input); });
      const put = vi.spyOn(local, 'putBlob');
      let settled: string | undefined;
      const work = repo.resolveAssetUrl({ id: 'asset', blobPath: 'u/t1/asset.png', ...(stage === 'library' ? { libraryItemId: 'lib' } : {}) })
        .then(url => { settled = url; });
      await vi.advanceTimersByTimeAsync(15_001);
      const atDeadline = settled;
      release();
      await work;
      await vi.advanceTimersByTimeAsync(0);
      expect(atDeadline).toBe('');
      expect(put).not.toHaveBeenCalled();
      expect(download).toHaveBeenCalledTimes(stage === 'fetch' || stage === 'body' ? 1 : 0);
      if (stage === 'cache' || stage === 'library') expect(request).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it('keeps fresh asset resolution independent of an older clear epoch', async () => {
    const { repo, cloud } = setup(true);
    const replies: Array<(item: LibraryItemDTO) => void> = [];
    const lookup = vi.spyOn(cloud, 'getLibraryItem').mockImplementation(() => new Promise(resolve => { replies.push(resolve); }));
    const asset = { id: 'same', libraryItemId: 'lib' };
    const old = repo.resolveAssetUrl(asset);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(1));
    await repo.deleteAll();
    expect(await old).toBe('');
    const fresh = repo.resolveAssetUrl(asset);
    await vi.waitFor(() => expect(lookup).toHaveBeenCalledTimes(2));
    replies[0]({ id: 'lib', state: 'active', url: 'https://blob.test/old' } as LibraryItemDTO);
    expect(await old).toBe('');
    expect(repo.resolveAssetUrl(asset)).toBe(fresh);
    replies[1]({ id: 'lib', state: 'active', url: 'https://blob.test/fresh' } as LibraryItemDTO);
    expect(await fresh).toBe('https://blob.test/fresh');
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it('captures asset identity before awaits and does not merge distinct Library references', async () => {
    const { repo, cloud } = setup(true);
    const lookup = vi.spyOn(cloud, 'getLibraryItem').mockImplementation(async id => ({ id, state: 'active', url: `https://blob.test/${id}` } as LibraryItemDTO));
    const asset = { id: 'same', libraryItemId: 'one' };
    const first = repo.resolveAssetUrl(asset);
    asset.libraryItemId = 'two';
    const second = repo.resolveAssetUrl(asset);
    expect(await Promise.all([first, second])).toEqual(['https://blob.test/one', 'https://blob.test/two']);
    expect(first).not.toBe(second);
    expect(lookup).toHaveBeenCalledTimes(2);
  });

  it.each(['empty', 'error'] as const)('retries asset resolution after a prior %s result', async outcome => {
    const { repo, cloud, local } = setup(true);
    const lookup = vi.spyOn(cloud, 'getLibraryItem').mockResolvedValue({ id: 'lib', state: 'active', url: 'https://blob.test/ready' } as LibraryItemDTO);
    if (outcome === 'empty') lookup.mockRejectedValueOnce(new CloudError('network', 'Synthetic unavailable', 0));
    else vi.spyOn(local, 'getBlobUrl').mockRejectedValueOnce(new Error('Synthetic cache failure'));
    const asset = { id: 'same', libraryItemId: 'lib' };
    const first = repo.resolveAssetUrl(asset);
    if (outcome === 'empty') expect(await first).toBe('');
    else await expect(first).rejects.toThrow('Synthetic cache failure');
    expect(await repo.resolveAssetUrl(asset)).toBe('https://blob.test/ready');
    expect(lookup).toHaveBeenCalledTimes(outcome === 'empty' ? 2 : 1);
  });

  it('shares one pending download and cache write for identical assets', async () => {
    const { local, cloud, kv } = setup(true);
    const download = vi.fn(async () => new Response(new Uint8Array([1, 2, 3])));
    const repo = new SyncRepository(local, cloud, kv, download as typeof fetch);
    const grant = cloud.requestSas.bind(cloud);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const request = vi.spyOn(cloud, 'requestSas').mockImplementation(async input => { entered(); await blocked; return grant(input); });
    const put = vi.spyOn(local, 'putBlob');
    const first = repo.resolveAssetUrl({ id: 'shared', blobPath: 'u/t1/shared.png' });
    const second = repo.resolveAssetUrl({ id: 'shared', blobPath: 'u/t1/shared.png' });
    await started;
    release();
    const urls = await Promise.all([first, second]);
    expect(urls[0]).toBeTruthy();
    expect(urls[1]).toBe(urls[0]);
    expect(request).toHaveBeenCalledOnce();
    expect(download).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledOnce();
    expect(put.mock.calls[0][1].size).toBe(3);
    expect(first).toBe(second);
  });

  it.each(['https://blob.test/stale-signed', 'data:image/png;base64,AAAA', 'blob:old-local'])
    ('does not use an embedded URL to bypass Library resolution: %s', async blobPath => {
      const { repo, cloud } = setup(true);
      const lookup = vi.spyOn(cloud, 'getLibraryItem').mockRejectedValue(new CloudError('not_found', 'Excluded', 404));
      expect(await repo.resolveAssetUrl({ id: 'asset', libraryItemId: 'excluded', blobPath })).toBe('');
      expect(lookup).toHaveBeenCalledOnce();
      expect(await repo.resolveAssetUrl({ id: 'direct', blobPath })).toBe(blobPath);
      expect(lookup).toHaveBeenCalledOnce();
    });

  it.each(['missing', 'foreign-id', 'purged', 'no-grant', 'active', 'trashed'] as const)
    ('treats Library identity and lifecycle as authoritative before fallback grants: %s', async state => {
      const { repo, cloud } = setup(true);
      const item: LibraryItemDTO = {
        id: state === 'foreign-id' ? 'other' : 'library-item', state: state === 'purged' ? 'purged' : state === 'trashed' ? 'trashed' : 'active',
        kind: 'image', origin: 'chat_upload', name: 'image.png', mime: 'image/png', bytes: 10,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
        source: { surface: 'chat', threadId: 't1', createdAt: '2026-01-01T00:00:00Z' },
        ...(state === 'no-grant' ? {} : { url: 'https://blob.test/current-library-grant' }),
      };
      if (state === 'missing') vi.spyOn(cloud, 'getLibraryItem').mockRejectedValue(new CloudError('not_found', 'Missing', 404));
      else vi.spyOn(cloud, 'getLibraryItem').mockResolvedValue(item);
      const grant = vi.spyOn(cloud, 'requestSas');
      const url = await repo.resolveAssetUrl({ id: 'img9', libraryItemId: 'library-item', blobPath: 'u/t1/img9.png' });
      expect(url).toBe(state === 'active' || state === 'trashed' ? item.url : '');
      expect(grant).not.toHaveBeenCalled();
    });

  it.each(['sas', 'body', 'library'])('discards asset resolution cleared during %s', async stage => {
    const { local, cloud, kv } = setup(true);
    let repo!: SyncRepository;
    const fetch = vi.fn(async () => new Response(new ReadableStream<Uint8Array>({
      async pull(controller) {
        if (stage === 'body') await repo.deleteAll();
        controller.enqueue(new Uint8Array([1])); controller.close();
      },
    }, { highWaterMark: 0 })));
    repo = new SyncRepository(local, cloud, kv, fetch as typeof globalThis.fetch);
    if (stage === 'sas') {
      const request = cloud.requestSas.bind(cloud);
      vi.spyOn(cloud, 'requestSas').mockImplementationOnce(async (...args) => {
        const result = await request(...args);
        await repo.deleteAll();
        return result;
      });
    }
    if (stage === 'library') vi.spyOn(cloud, 'getLibraryItem').mockImplementationOnce(async () => {
      await repo.deleteAll();
      return { id: 'lib', url: 'https://blob.test/old-owner' } as LibraryItemDTO;
    });
    const put = vi.spyOn(local, 'putBlob');
    const url = await repo.resolveAssetUrl({ id: 'img9', blobPath: 'u/t1/img9.png', ...(stage === 'library' ? { libraryItemId: 'lib' } : {}) });
    expect(url).toBe('');
    expect(put).not.toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledTimes(stage === 'body' ? 1 : 0);
  });

  it.each(['image', 'attachment'])('does not upload a cleared %s after its write URL resolves', async kind => {
    const { local, cloud, repo, uploaded } = setup(true);
    await repo.createThread({ id: 't1', title: 'A' });
    await local.putBlob('asset-key', new Blob(['PRIVATE']));
    await repo.appendMessage(msg({ id: 'm1', threadId: 't1', ...(kind === 'image' ? {
      images: [{ id: 'asset', localBlobKey: 'asset-key', prompt: '', size: '1024x1024', outputFormat: 'png', createdAt: '2026' }],
    } : {
      attachments: [{ id: 'asset', localBlobKey: 'asset-key', kind: 'file', mime: 'application/pdf', bytes: 7, name: 'private.pdf' }],
    }) }));
    const request = cloud.requestSas.bind(cloud);
    vi.spyOn(cloud, 'requestSas').mockImplementationOnce(async (...args) => {
      const result = await request(...args);
      await repo.deleteAll();
      return result;
    });
    const append = vi.spyOn(cloud, 'appendMessage');
    const update = vi.spyOn(local, 'updateMessage');
    await repo.push();
    expect(uploaded.size).toBe(0);
    expect(append).not.toHaveBeenCalled();
    expect(update).not.toHaveBeenCalled();
  });

  const imageMsg = (over: Partial<Message> = {}): Message =>
    msg({
      id: 'm1',
      threadId: 't1',
      role: 'assistant',
      content: '',
      images: [
        {
          id: 'img1',
          localBlobKey: 'imgkey',
          prompt: 'a cat',
          size: '1024x1024',
          outputFormat: 'png',
          createdAt: '2026-01-01T00:00:30Z',
        },
      ],
      ...over,
    });

  it('uploads a message’s local images to Blob Storage on push and syncs their blobPath', async () => {
    const { local, cloud, repo, uploaded } = setup(true);
    await repo.createThread({ id: 't1', title: 'A' });
    await local.putBlob('imgkey', new Blob(['IMG']));
    await repo.appendMessage(imageMsg());

    await repo.push();

    // The blob was PUT to a write SAS URL.
    expect(uploaded.size).toBe(1);
    expect(cloud.calls).toContain('requestSas:write:t1:img1');
    // The synced message carries the image WITH a cloud blobPath.
    expect(cloud.messages.get('m1')?.images?.[0]).toMatchObject({
      id: 'img1',
      blobPath: 'u/library/img1.png',
    });
    // blobPath is persisted locally so a later push won't re-upload.
    const localMsg = (await local.listMessages('t1')).find((m) => m.id === 'm1');
    expect(localMsg?.images?.[0].blobPath).toBe('u/library/img1.png');
  });

  it('uploads a message’s local attachments to Blob Storage on push and syncs their blobPath', async () => {
    const { local, cloud, repo, uploaded } = setup(true);
    await repo.createThread({ id: 't1', title: 'A' });
    await local.putBlob('attkey', new Blob(['PDF']));
    await repo.appendMessage({
      id: 'm1',
      threadId: 't1',
      role: 'user',
      content: 'see this',
      status: 'complete',
      createdAt: '2026-01-01T00:00:30Z',
      attachments: [
        { id: 'att1', kind: 'file', localBlobKey: 'attkey', mime: 'application/pdf', bytes: 3, name: 'd.pdf' },
      ],
    });

    await repo.push();

    expect(uploaded.size).toBe(1);
    expect(cloud.calls).toContain('requestSas:write:t1:att1');
    expect(cloud.messages.get('m1')?.attachments?.[0]).toMatchObject({ id: 'att1', blobPath: 'u/library/att1.png' });
    const localMsg = (await local.listMessages('t1')).find((m) => m.id === 'm1');
    expect(localMsg?.attachments?.[0].blobPath).toBe('u/library/att1.png');
  });

  it('does not re-upload an image that already has a blobPath', async () => {
    const { local, cloud, repo, uploaded } = setup(true);
    await repo.createThread({ id: 't1', title: 'A' });
    await repo.appendMessage(
      imageMsg({
        images: [
          {
            id: 'img1',
            blobPath: 'u/t1/img1.png',
            prompt: 'a cat',
            size: '1024x1024',
            outputFormat: 'png',
            createdAt: '2026-01-01T00:00:30Z',
          },
        ],
      }),
    );

    await repo.push();

    expect(uploaded.size).toBe(0);
    expect(cloud.calls).not.toContain('requestSas:write:t1:img1');
    expect(cloud.messages.get('m1')?.images?.[0].blobPath).toBe('u/t1/img1.png');
  });

  it('resolveImageUrl fetches and caches a cloud image when only blobPath is known', async () => {
    const { local, cloud, repo } = setup(true);
    const url = await repo.resolveImageUrl({
      id: 'img9',
      blobPath: 'u/t1/img9.png',
      prompt: '',
      size: '1024x1024',
      outputFormat: 'png',
      createdAt: 'now',
    });

    expect(cloud.calls).toContain('requestSas:read:t1:img9');
    expect(url).toBeTruthy();
    // The downloaded bytes were cached locally for offline reuse.
    expect(await local.getBlob('cloud-img9')).not.toBeNull();
  });

  it('resolveImageUrl prefers the local cache and never hits the cloud', async () => {
    const { local, cloud, repo } = setup(true);
    await local.putBlob('imgkey', new Blob(['IMG']));
    const url = await repo.resolveImageUrl({
      id: 'img1',
      localBlobKey: 'imgkey',
      blobPath: 'u/t1/img1.png',
      prompt: '',
      size: '1024x1024',
      outputFormat: 'png',
      createdAt: 'now',
    });

    expect(url).toBe('blob:fake/imgkey');
    expect(cloud.calls).not.toContain('requestSas:read:t1:img1');
  });

  it('resolveAssetUrl uses the safe Library DTO URL for a Library-backed attachment', async () => {
    const { cloud, repo } = setup(true);
    cloud.libraryItems.set('lib-1', {
      id: 'lib-1', state: 'active', kind: 'pdf', origin: 'chat_upload', name: 'brief.pdf', mime: 'application/pdf', bytes: 3,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', source: { surface: 'chat', threadId: 't1', createdAt: '2026-01-01T00:00:00Z' },
      url: 'https://blob.test/library-read',
    });
    await expect(repo.resolveAssetUrl({ id: 'att1', libraryItemId: 'lib-1', blobPath: 'u/library/lib-1.pdf' })).resolves.toBe('https://blob.test/library-read');
  });
});
