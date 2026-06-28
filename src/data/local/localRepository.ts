import { db, kvGet, kvSet } from '../db';
import type { SearchHit, SyncLocalStore } from '../repository';
import { newId } from '../../lib/ids';
import { DEFAULT_SETTINGS, type Id, type ImageRef, type Message, type Settings, type Thread, type MemoryKind } from '../../lib/types';
import type { CreateMemoryBody, ListMemoryQuery, MemoryRecord, PatchMemoryBody } from '../cloud/types';

const SETTINGS_KEY = 'settings';
const MEMORY_KEY = 'memory';
const blobUrlCache = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

function normalizeMemoryText(text: string): string {
  return text.trim().replace(/\s+/g, ' ');
}

function asMemoryRecord(item: unknown): MemoryRecord | null {
  const raw = item as Partial<MemoryRecord> & { source?: string };
  if (!raw || typeof raw !== 'object' || !raw.id || !raw.text) return null;
  if (raw.status && raw.kind && raw.sourceRefs) return raw as MemoryRecord;
  const ts = raw.createdAt ?? nowIso();
  return {
    id: raw.id,
    userId: 'local',
    kind: 'fact',
    status: 'active',
    text: raw.text,
    normalizedText: normalizeMemoryText(raw.text).toLowerCase(),
    sourceRefs: [{ type: 'manual', quote: raw.source, createdAt: ts }],
    confidence: 1,
    salience: 0.7,
    pinned: false,
    sensitive: false,
    visibility: 'normal',
    createdAt: ts,
    updatedAt: ts,
    useCount: 0,
  };
}

export class LocalRepository implements SyncLocalStore {
  async listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]> {
    const all = (await (await db()).getAll('threads')) as Thread[];
    return all
      .filter((t) => !t.deletedAt && (opts?.includeArchived || !t.archived))
      .sort((a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime());
  }

  async getThread(id: Id): Promise<Thread | null> {
    return ((await (await db()).get('threads', id)) as Thread) ?? null;
  }

  async createThread(init?: Partial<Thread>): Promise<Thread> {
    const t: Thread = {
      id: init?.id ?? newId(),
      title: init?.title ?? 'New chat',
      pinned: false,
      archived: false,
      temporary: init?.temporary ?? false,
      model: init?.model,
      createdAt: nowIso(),
      updatedAt: nowIso(),
      messageCount: 0,
      ...init,
    };
    await (await db()).put('threads', t);
    return t;
  }

  async updateThread(id: Id, patch: Partial<Thread>): Promise<Thread> {
    const existing = await this.getThread(id);
    if (!existing) throw new Error('thread not found');
    const merged = { ...existing, ...patch, updatedAt: patch.updatedAt ?? nowIso() };
    await (await db()).put('threads', merged);
    return merged;
  }

  async deleteThread(id: Id): Promise<void> {
    await this.updateThread(id, { deletedAt: nowIso() });
    const msgs = await this.listMessages(id);
    const tx = (await db()).transaction('messages', 'readwrite');
    await Promise.all(msgs.map((m) => tx.store.delete(m.id)));
    await tx.done;
    await (await db()).delete('threads', id);
  }

  async listMessages(threadId: Id): Promise<Message[]> {
    const idx = (await db()).transaction('messages').store.index('byThread');
    const msgs = (await idx.getAll(threadId)) as Message[];
    return msgs.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async appendMessage(m: Message): Promise<Message> {
    await (await db()).put('messages', m);
    const t = await this.getThread(m.threadId);
    if (t) {
      await this.updateThread(m.threadId, {
        messageCount: t.messageCount + 1,
        lastMessagePreview: m.content.slice(0, 120),
        updatedAt: nowIso(),
      });
    }
    return m;
  }

  async updateMessage(id: Id, patch: Partial<Message>): Promise<Message> {
    const existing = (await (await db()).get('messages', id)) as Message | undefined;
    if (!existing) throw new Error('message not found');
    const merged = { ...existing, ...patch };
    await (await db()).put('messages', merged);
    if (patch.content !== undefined) {
      await this.updateThread(merged.threadId, {
        lastMessagePreview: merged.content.slice(0, 120),
      }).catch(() => undefined);
    }
    return merged;
  }

  async deleteMessage(id: Id): Promise<void> {
    await (await db()).delete('messages', id);
  }

  /** Local-only store: a single device, so there is never lock contention. */
  async acquireRunLock(): Promise<{ acquired: boolean }> {
    return { acquired: true };
  }
  async releaseRunLock(): Promise<void> {}
  async getThreadLock(): Promise<null> {
    return null;
  }

  /** Sync-only: insert/replace a server message verbatim, without bumping the thread. */
  async putMessageRaw(message: Message): Promise<void> {
    await (await db()).put('messages', message);
  }

  async putBlob(key: string, blob: Blob): Promise<void> {
    await (await db()).put('blobs', blob, key);
  }

  async getBlobUrl(key: string): Promise<string> {
    if (blobUrlCache.has(key)) return blobUrlCache.get(key)!;
    const blob = (await (await db()).get('blobs', key)) as Blob | undefined;
    if (!blob) return '';
    const url = URL.createObjectURL(blob);
    blobUrlCache.set(key, url);
    return url;
  }

  async getBlob(key: string): Promise<Blob | null> {
    return ((await (await db()).get('blobs', key)) as Blob) ?? null;
  }

  /** Local-only resolution: use the cached blob, or a direct-URL blobPath. A cloud
   *  storage path can't be resolved here (the SyncRepository overrides this). */
  async resolveAssetUrl(asset: { id: string; localBlobKey?: string; blobPath?: string }): Promise<string> {
    if (asset.localBlobKey) {
      const url = await this.getBlobUrl(asset.localBlobKey);
      if (url) return url;
    }
    if (asset.blobPath && /^(data:|blob:|https?:)/.test(asset.blobPath)) return asset.blobPath;
    return '';
  }

  resolveImageUrl(image: ImageRef): Promise<string> {
    return this.resolveAssetUrl(image);
  }

  async getSettings(): Promise<Settings> {
    const s = await kvGet<Settings>(SETTINGS_KEY);
    return s ?? DEFAULT_SETTINGS;
  }

  async saveSettings(s: Settings): Promise<void> {
    await kvSet(SETTINGS_KEY, s);
  }

  async listMemory(query: ListMemoryQuery = {}): Promise<MemoryRecord[]> {
    const list = ((await kvGet<unknown[]>(MEMORY_KEY)) ?? []).map(asMemoryRecord).filter((m): m is MemoryRecord => !!m);
    const q = query.q?.trim().toLowerCase();
    return list
      .filter((m) => (query.status ? m.status === query.status : m.status === 'active'))
      .filter((m) => !query.kind || m.kind === query.kind)
      .filter((m) => !q || [m.text, m.summary, ...(m.entities ?? []), ...(m.topics ?? [])].filter(Boolean).some((x) => x!.toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }

  async addMemory(input: CreateMemoryBody): Promise<MemoryRecord> {
    const ts = nowIso();
    const text = normalizeMemoryText(input.text);
    const record: MemoryRecord = {
      id: newId(),
      userId: 'local',
      kind: input.kind ?? 'fact',
      status: 'active',
      text,
      normalizedText: text.toLowerCase(),
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
    const list = await this.listMemory({ status: 'active' });
    await kvSet(MEMORY_KEY, [record, ...list]);
    return record;
  }

  async updateMemory(id: Id, patch: PatchMemoryBody): Promise<MemoryRecord> {
    const all = ((await kvGet<unknown[]>(MEMORY_KEY)) ?? []).map(asMemoryRecord).filter((m): m is MemoryRecord => !!m);
    const current = all.find((m) => m.id === id);
    if (!current) throw new Error('memory not found');
    const next: MemoryRecord = {
      ...current,
      ...(patch.text !== undefined ? { text: normalizeMemoryText(patch.text), normalizedText: normalizeMemoryText(patch.text).toLowerCase() } : {}),
      ...(patch.kind !== undefined ? { kind: patch.kind as MemoryKind } : {}),
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.visibility !== undefined ? { visibility: patch.visibility } : {}),
      ...(patch.pinned !== undefined ? { pinned: patch.pinned } : {}),
      ...(patch.salience !== undefined ? { salience: patch.salience } : {}),
      updatedAt: nowIso(),
    };
    await kvSet(MEMORY_KEY, all.map((m) => (m.id === id ? next : m)));
    return next;
  }

  async removeMemory(id: Id): Promise<void> {
    const all = ((await kvGet<unknown[]>(MEMORY_KEY)) ?? []).map(asMemoryRecord).filter((m): m is MemoryRecord => !!m);
    await kvSet(MEMORY_KEY, all.map((m) => (m.id === id ? { ...m, status: 'deleted', deletedAt: nowIso(), updatedAt: nowIso() } : m)));
  }

  async search(query: string): Promise<SearchHit[]> {
    const q = query.trim().toLowerCase();
    if (!q) return [];
    const threads = await this.listThreads({ includeArchived: true });
    const hits: SearchHit[] = [];
    for (const thread of threads) {
      const msgs = await this.listMessages(thread.id);
      const titleMatch = thread.title.toLowerCase().includes(q);
      const msg = msgs.find((m) => m.content.toLowerCase().includes(q));
      if (msg) {
        const i = msg.content.toLowerCase().indexOf(q);
        const start = Math.max(0, i - 30);
        const snippet = (start > 0 ? '…' : '') + msg.content.slice(start, i + q.length + 50);
        hits.push({ thread, messageId: msg.id, snippet });
      } else if (titleMatch) {
        hits.push({ thread, messageId: '', snippet: thread.lastMessagePreview ?? '' });
      }
    }
    return hits;
  }

  async exportAll(): Promise<Blob> {
    const threads = await this.listThreads({ includeArchived: true });
    const data: Record<string, unknown> = {
      exportedAt: nowIso(),
      threads,
      messages: {} as Record<string, Message[]>,
      settings: await this.getSettings(),
      memory: await this.listMemory(),
    };
    for (const t of threads) {
      (data.messages as Record<string, Message[]>)[t.id] = await this.listMessages(t.id);
    }
    return new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  }

  /** Remove dev-seeded demo threads (stable `seed-` ids) and their messages directly from
   *  the local store. Production calls this to clear placeholder chats left in a returning
   *  user's browser by an earlier build. Real user data (non-`seed-` ids) is never touched. */
  async purgeSeedThreads(): Promise<number> {
    const database = await db();
    const all = (await database.getAll('threads')) as Thread[];
    const seeds = all.filter((t) => typeof t.id === 'string' && t.id.startsWith('seed-'));
    for (const t of seeds) {
      const msgs = await this.listMessages(t.id);
      if (msgs.length) {
        const tx = database.transaction('messages', 'readwrite');
        await Promise.all(msgs.map((msg) => tx.store.delete(msg.id)));
        await tx.done;
      }
      await database.delete('threads', t.id);
    }
    return seeds.length;
  }

  async deleteAll(): Promise<void> {
    const database = await db();
    await database.clear('threads');
    await database.clear('messages');
    await database.clear('blobs');
    await kvSet(MEMORY_KEY, []);
  }
}
