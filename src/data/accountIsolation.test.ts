import { describe, expect, it, vi } from 'vitest';

const databases = vi.hoisted(() => new Map<string, FakeDatabase>());

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>([
    ['threads', new Map()],
    ['messages', new Map()],
    ['blobs', new Map()],
    ['kv', new Map()],
    ['outbox', new Map()],
  ]);

  async get(store: string, key: string): Promise<unknown> {
    return this.stores.get(store)?.get(key);
  }

  async getAll(store: string): Promise<unknown[]> {
    return [...(this.stores.get(store)?.values() ?? [])];
  }

  async getAllKeys(store: string): Promise<string[]> {
    return [...(this.stores.get(store)?.keys() ?? [])];
  }

  async put(store: string, value: unknown, explicitKey?: string): Promise<void> {
    const key = explicitKey ?? String((value as { id: string }).id);
    this.stores.get(store)?.set(key, value);
  }

  async delete(store: string, key: string): Promise<void> {
    this.stores.get(store)?.delete(key);
  }

  async clear(store: string): Promise<void> {
    this.stores.get(store)?.clear();
  }

  transaction(store: string | string[]) {
    const access = (storeName: string) => ({
      get: (key: string) => this.get(storeName, key),
      getAll: () => this.getAll(storeName),
      put: (value: unknown, key?: string) => this.put(storeName, value, key),
      delete: (key: string) => this.delete(storeName, key),
      clear: () => this.clear(storeName),
      index: () => ({
        getAll: async (threadId: string) => [...(this.stores.get(storeName)?.values() ?? [])]
          .filter((value) => (value as { threadId?: string }).threadId === threadId),
        getAllKeys: async (threadId: string) => [...(this.stores.get(storeName)?.entries() ?? [])]
          .filter(([, value]) => (value as { threadId?: string }).threadId === threadId)
          .map(([key]) => key),
      }),
    });
    const primary = Array.isArray(store) ? store[0] : store;
    return {
      store: access(primary),
      objectStore: access,
      done: Promise.resolve(),
    };
  }
}

vi.mock('idb', () => ({
  openDB: vi.fn(async (name: string) => {
    let database = databases.get(name);
    if (!database) {
      database = new FakeDatabase();
      databases.set(name, database);
    }
    return database;
  }),
}));

import type { CloudApi } from './cloud/apiClient';
import { LocalRepository } from './local/localRepository';
import { SyncRepository } from './sync/syncRepository';
import { idbKvStore } from './sync/kvStore';
import { DEFAULT_SETTINGS } from '../lib/types';

function cloud() {
  return { createThread: vi.fn(async () => undefined) } as unknown as CloudApi;
}

function readBlobText(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsText(blob);
  });
}

describe('account-scoped local repository', () => {
  it('isolates rows and outbox drains across owners while sharing one owner across tabs', async () => {
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValueOnce('blob:owner-a').mockReturnValueOnce('blob:owner-b'),
    });
    const localA1 = new LocalRepository('owner-a');
    const localA2 = new LocalRepository('owner-a');
    const localB = new LocalRepository('owner-b');
    const cloudA = cloud();
    const cloudB = cloud();
    const syncA = new SyncRepository(localA1, cloudA, idbKvStore('owner-a'));
    const syncB = new SyncRepository(localB, cloudB, idbKvStore('owner-b'));

    await syncA.createThread({ id: 'same-thread', title: 'Owner A' });
    await localB.createThread({ id: 'same-thread', title: 'Owner B' });

    expect((await localA2.listThreads()).map((thread) => thread.title)).toEqual(['Owner A']);
    await expect(localA2.listOutbox()).resolves.toMatchObject([
      { kind: 'thread.create', id: 'same-thread', state: 'pending' },
    ]);
    expect((await localB.listThreads()).map((thread) => thread.title)).toEqual(['Owner B']);
    await localA1.putBlob('same-blob', new Blob(['A']));
    await localB.putBlob('same-blob', new Blob(['B']));
    await expect(localA1.getBlobUrl('same-blob')).resolves.toBe('blob:owner-a');
    await expect(localB.getBlobUrl('same-blob')).resolves.toBe('blob:owner-b');

    await syncB.push();
    expect(cloudB.createThread).not.toHaveBeenCalled();
    await syncA.push();
    expect(cloudA.createThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'same-thread', title: 'Owner A' }));
    await expect(localA2.listOutbox()).resolves.toEqual([]);
  });

  it('exports a versioned inventory matching included records and cached media bytes', async () => {
    const local = new LocalRepository('export-owner');
    await local.createThread({ id: 'thread-1', title: 'Exported' });
    await local.appendMessage({
      id: 'message-1', threadId: 'thread-1', role: 'user', content: 'hello',
      createdAt: '2026-01-01T00:00:00Z', status: 'complete',
    });
    await local.putBlob('cached.txt', new Blob(['abc'], { type: 'text/plain' }));

    const exported = JSON.parse(await readBlobText(await local.exportAll()));
    expect(exported.manifest).toMatchObject({
      schemaVersion: 1,
      records: { threads: 1, messages: 1, settings: 1, memory: 0 },
      cachedMedia: { files: 1, bytes: 3 },
    });
    expect(exported.cachedMedia).toEqual([
      { key: 'cached.txt', mime: 'text/plain', bytes: 3, dataBase64: 'YWJj' },
    ]);
  });

  it('clears one owner including outbox/settings and revokes only that owner’s object URLs', async () => {
    const revoke = vi.fn();
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: vi.fn().mockReturnValueOnce('blob:clear-owner').mockReturnValueOnce('blob:other-owner'),
    });
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const local = new LocalRepository('clear-owner');
    const other = new LocalRepository('other-owner');
    await local.createThread({ id: 'clear-thread' });
    await other.createThread({ id: 'other-thread' });
    await local.mutateOutbox(() => [{ operationId: 'pending', kind: 'thread.create', state: 'pending' }]);
    await local.saveSettings({ ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' } });
    await local.putBlob('blob', new Blob(['clear']));
    await other.putBlob('blob', new Blob(['other']));
    await local.getBlobUrl('blob');
    await other.getBlobUrl('blob');

    await local.deleteAll();

    await expect(local.listThreads()).resolves.toEqual([]);
    await expect(local.listOutbox()).resolves.toEqual([]);
    await expect(local.getSettings()).resolves.toEqual(DEFAULT_SETTINGS);
    await expect(other.listThreads()).resolves.toHaveLength(1);
    expect(revoke).toHaveBeenCalledWith('blob:clear-owner');
    expect(revoke).not.toHaveBeenCalledWith('blob:other-owner');
  });
});
