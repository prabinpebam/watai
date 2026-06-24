import { describe, it, expect } from 'vitest';
import { SyncRepository } from './syncRepository';
import { memoryKvStore } from './kvStore';
import { CloudError, type CloudApi } from '../cloud/apiClient';
import type { SearchHit, SyncLocalStore } from '../repository';
import {
  DEFAULT_SETTINGS,
  type Id,
  type MemoryItem,
  type Message,
  type Settings,
  type Thread,
} from '../../lib/types';
import type {
  AppendMessageBody,
  CreateThreadBody,
  MessageRecord,
  ThreadRecord,
  UpdateThreadBody,
} from '../cloud/types';

/** Minimal in-memory SyncLocalStore mirroring the behaviours the sync engine relies on. */
class FakeLocal implements SyncLocalStore {
  threads = new Map<Id, Thread>();
  messages = new Map<Id, Message>();
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
  async getSettings(): Promise<Settings> {
    return this.settings;
  }
  async saveSettings(s: Settings): Promise<void> {
    this.settings = s;
  }
  async putBlob(): Promise<void> {}
  async getBlobUrl(): Promise<string> {
    return '';
  }
  async listMemory(): Promise<MemoryItem[]> {
    return [];
  }
  async addMemory(): Promise<void> {}
  async removeMemory(): Promise<void> {}
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
  serverSettings: Settings | null = null;
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

  async listThreads(opts?: {
    includeArchived?: boolean;
    includeDeleted?: boolean;
    since?: string;
  }): Promise<ThreadRecord[]> {
    this.calls.push('listThreads');
    return [...this.threads.values()].filter(
      (t) => (opts?.includeDeleted || !t.deletedAt) && (!opts?.since || t.updatedAt > opts.since),
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
      (m) => m.threadId === threadId && (!opts?.since || m.createdAt > opts.since),
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
    };
    this.messages.set(id, rec);
    return rec;
  }
  async getSettings(): Promise<Settings> {
    this.calls.push('getSettings');
    return this.serverSettings ?? DEFAULT_SETTINGS;
  }
  async patchSettings(patch: Partial<Settings>): Promise<Settings> {
    this.calls.push('patchSettings');
    this.serverSettings = patch as Settings;
    return this.serverSettings;
  }
}

function setup(sync = true) {
  const local = new FakeLocal(sync);
  const cloud = new FakeCloud();
  const kv = memoryKvStore();
  const repo = new SyncRepository(local, cloud, kv);
  return { local, cloud, kv, repo };
}

const msg = (over: Partial<Message> & { id: string; threadId: string }): Message => ({
  role: 'user',
  content: 'hi',
  status: 'complete',
  createdAt: '2026-01-01T00:00:30Z',
  ...over,
});

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
});

describe('SyncRepository — push', () => {
  it('creates the thread on the server with the same client id', async () => {
    const { repo, cloud, kv } = setup(true);
    const t = await repo.createThread({ title: 'Trip' });
    await repo.push();

    expect(cloud.calls).toContain(`createThread:${t.id}`);
    expect(cloud.threads.get(t.id)?.title).toBe('Trip');
    expect(await kv.get('sync.queue')).toEqual([]);
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

  it('keeps a retryable op for later but drops a permanent one', async () => {
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
    expect(await perm.kv.get('sync.queue')).toEqual([]);
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
});

describe('SyncRepository — pull', () => {
  it('merges new server threads into local and advances the cursor', async () => {
    const { repo, local, cloud, kv } = setup(true);
    cloud.seedThread({ id: 's1', title: 'Server', updatedAt: '2026-02-01T00:00:05Z' });
    await repo.pull();

    expect((await local.getThread('s1'))?.title).toBe('Server');
    expect(await kv.get('sync.cursor.threads')).toBe('2026-02-01T00:00:05Z');
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
});

describe('SyncRepository — deleteAll', () => {
  it('clears all sync.* bookkeeping keys', async () => {
    const { repo, kv } = setup(true);
    await repo.createThread({ title: 'A' });
    await kv.set('sync.cursor.threads', '2026-02-01T00:00:00Z');

    await repo.deleteAll();

    expect(await kv.get('sync.queue')).toBeUndefined();
    expect(await kv.get('sync.cursor.threads')).toBeUndefined();
  });
});
