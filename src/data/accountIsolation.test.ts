import { describe, expect, it, vi } from 'vitest';

const databases = vi.hoisted(() => new Map<string, FakeDatabase>());

class FakeDatabase {
  private readonly stores = new Map<string, Map<string, unknown>>([
    ['threads', new Map()],
    ['messages', new Map()],
    ['blobs', new Map()],
    ['kv', new Map()],
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

  transaction(store: string): { store: { delete: (key: string) => Promise<void>; index: () => { getAll: (threadId: string) => Promise<unknown[]> } }; done: Promise<void> } {
    return {
      store: {
        delete: (key: string) => this.delete(store, key),
        index: () => ({
          getAll: async (threadId: string) => [...(this.stores.get(store)?.values() ?? [])]
            .filter((value) => (value as { threadId?: string }).threadId === threadId),
        }),
      },
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

function cloud() {
  return { createThread: vi.fn(async () => undefined) } as unknown as CloudApi;
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
    expect((await localB.listThreads()).map((thread) => thread.title)).toEqual(['Owner B']);
    await localA1.putBlob('same-blob', new Blob(['A']));
    await localB.putBlob('same-blob', new Blob(['B']));
    await expect(localA1.getBlobUrl('same-blob')).resolves.toBe('blob:owner-a');
    await expect(localB.getBlobUrl('same-blob')).resolves.toBe('blob:owner-b');

    await syncB.push();
    expect(cloudB.createThread).not.toHaveBeenCalled();
    await syncA.push();
    expect(cloudA.createThread).toHaveBeenCalledWith(expect.objectContaining({ id: 'same-thread', title: 'Owner A' }));
  });
});
