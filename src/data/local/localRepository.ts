import { db, kvGet, kvSet } from '../db';
import type { Repository, SearchHit } from '../repository';
import { newId } from '../../lib/ids';
import { DEFAULT_SETTINGS, type Id, type Message, type Settings, type Thread, type MemoryItem } from '../../lib/types';

const SETTINGS_KEY = 'settings';
const MEMORY_KEY = 'memory';
const blobUrlCache = new Map<string, string>();

function nowIso(): string {
  return new Date().toISOString();
}

export class LocalRepository implements Repository {
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

  async getSettings(): Promise<Settings> {
    const s = await kvGet<Settings>(SETTINGS_KEY);
    return s ?? DEFAULT_SETTINGS;
  }

  async saveSettings(s: Settings): Promise<void> {
    await kvSet(SETTINGS_KEY, s);
  }

  async listMemory(): Promise<MemoryItem[]> {
    return (await kvGet<MemoryItem[]>(MEMORY_KEY)) ?? [];
  }

  async addMemory(m: MemoryItem): Promise<void> {
    const list = await this.listMemory();
    await kvSet(MEMORY_KEY, [m, ...list]);
  }

  async removeMemory(id: Id): Promise<void> {
    const list = await this.listMemory();
    await kvSet(MEMORY_KEY, list.filter((x) => x.id !== id));
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

  async deleteAll(): Promise<void> {
    const database = await db();
    await database.clear('threads');
    await database.clear('messages');
    await database.clear('blobs');
    await kvSet(MEMORY_KEY, []);
  }
}
