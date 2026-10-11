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
    const key = explicitKey ?? String(store === 'outbox' ? (value as { operationId: string }).operationId : (value as { id: string }).id);
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

vi.mock('../auth/cloudAuth', () => ({ getCloudToken: vi.fn(async () => null) }));

import type { CloudApi } from './cloud/apiClient';
import { LocalRepository } from './local/localRepository';
import { SyncRepository } from './sync/syncRepository';
import { idbKvStore } from './sync/kvStore';
import { DEFAULT_SETTINGS } from '../lib/types';
import { localDatabaseName } from './db';

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
  it.each(['hydrate', 'local-read'] as const)('rejects an account switch during settings %s', async stage => {
    const data = await import('./index');
    const stop = vi.spyOn(data.realtime, 'stop').mockResolvedValue(undefined);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const hydrate = vi.spyOn(SyncRepository.prototype, 'hydrateSettings').mockImplementation(async () => {
      if (stage === 'hydrate') { entered(); await blocked; }
    });
    const read = vi.spyOn(LocalRepository.prototype, 'getSettings').mockImplementation(async () => {
      if (stage === 'local-read') { entered(); await blocked; }
      return DEFAULT_SETTINGS;
    });
    try {
      await data.activateAccountData(`settings-first-${stage}`);
      const result = data.loadAccountSettings().then(() => 'resolved', error => error.message);
      await started;
      await data.activateAccountData(`settings-second-${stage}`);
      release();
      expect(await result).toBe('Account changed during settings load.');
      expect(read).toHaveBeenCalledTimes(stage === 'hydrate' ? 0 : 1);
    } finally {
      release();
      hydrate.mockRestore(); read.mockRestore();
      await data.activateAccountData(null);
      stop.mockRestore();
    }
  });

  it.each(['missing', 'deleted', 'collision'] as const)('rejects invalid transactional append targets before persistence: %s', async state => {
    const local = new LocalRepository(`append-target-${state}`);
    if (state !== 'missing') await local.createThread({ id: 'target', title: 'Target',
      ...(state === 'deleted' ? { deletedAt: '2026-01-01T00:00:00Z' } : {}) });
    const message = { id: 'same', threadId: 'target', role: 'user' as const, content: 'New',
      createdAt: '2026-01-01T00:00:00Z', status: 'complete' as const };
    const retained = { ...message, threadId: 'other', content: 'Keep' };
    if (state === 'collision') await local.putMessageRaw(retained);
    await expect(local.appendMessageWithOutbox(message, { operationId: 'new', kind: 'message.append' })).rejects.toThrow();
    expect(await local.listOutbox()).toEqual([]);
    expect(await local.listMessages('target')).toEqual([]);
    if (state === 'collision') expect(await local.listMessages('other')).toEqual([retained]);
  });

  it('counts transactional message snapshots once while retaining both outbox operations', async () => {
    const local = new LocalRepository('message-replay-owner');
    await local.createThread({ id: 'thread', title: 'A' });
    const message = { id: 'message', threadId: 'thread', role: 'assistant' as const, content: 'Partial',
      status: 'streaming' as const, createdAt: '2026-01-01T00:00:00Z' };
    await local.appendMessageWithOutbox(message, { operationId: 'first', kind: 'message.append' });
    await local.appendMessageWithOutbox({ ...message, content: 'Complete', status: 'complete' }, { operationId: 'second', kind: 'message.append' });
    expect((await local.getThread('thread'))?.messageCount).toBe(1);
    expect(await local.listMessages('thread')).toEqual([{ ...message, content: 'Complete', status: 'complete' }]);
    expect((await local.listOutbox()).map(operation => operation.operationId)).toEqual(['first', 'second']);
  });

  it.each([false, true])('cleans up failed blob reads without removing a replacement: %s', async replaced => {
    const owner = `failed-url-${replaced}`;
    const local = new LocalRepository(owner);
    await local.putBlob('asset', new Blob(['old']));
    const database = databases.get(localDatabaseName(owner))!;
    let rejectRead!: (error: Error) => void;
    let entered!: () => void;
    const started = new Promise<void>(resolve => { entered = resolve; });
    const failure = new Error('Synthetic read failure');
    const read = vi.spyOn(database, 'get').mockImplementationOnce(() => new Promise((_resolve, reject) => { rejectRead = reject; entered(); }));
    const mint = vi.fn(() => 'blob:latest');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mint });
    const pending = expect(local.getBlobUrl('asset')).rejects.toBe(failure);
    await started;
    try {
      if (replaced) { await local.putBlob('asset', new Blob(['new'])); expect(await local.getBlobUrl('asset')).toBe('blob:latest'); }
    } finally { rejectRead(failure); await pending; read.mockRestore(); }
    expect(await local.getBlobUrl('asset')).toBe('blob:latest');
    expect(mint).toHaveBeenCalledOnce();
  });

  it.each(['clear', 'replace'] as const)('does not expose old bytes from a read completed after %s', async action => {
    const owner = `pending-url-${action}`;
    const local = new LocalRepository(owner);
    await local.putBlob('asset', new Blob(['old']));
    const database = databases.get(localDatabaseName(owner))!;
    const get = database.get.bind(database);
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const read = vi.spyOn(database, 'get').mockImplementationOnce(async (store, key) => {
      const captured = await get(store, key); entered(); await blocked; return captured;
    });
    const mint = vi.fn(() => 'blob:current');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mint });
    const pending = local.getBlobUrl('asset');
    await started;
    try {
      if (action === 'clear') await local.deleteAll();
      else await local.putBlob('asset', new Blob(['new']));
    } finally { release(); }
    const result = await pending;
    read.mockRestore();
    expect(result).toBe('');
    expect(mint).not.toHaveBeenCalled();
    expect(await local.getBlobUrl('asset')).toBe(action === 'clear' ? '' : 'blob:current');
  });

  it('shares concurrent reads of one current blob URL', async () => {
    const local = new LocalRepository('concurrent-url-owner');
    await local.putBlob('asset', new Blob(['current']));
    const mint = vi.fn().mockReturnValueOnce('blob:one').mockReturnValueOnce('blob:duplicate');
    Object.defineProperty(URL, 'createObjectURL', { configurable: true, value: mint });
    expect(await Promise.all([local.getBlobUrl('asset'), local.getBlobUrl('asset')])).toEqual(['blob:one', 'blob:one']);
    expect(mint).toHaveBeenCalledOnce();
  });

  it('invalidates only the replaced owner blob URL when its bytes change', async () => {
    Object.defineProperty(URL, 'createObjectURL', { configurable: true,
      value: vi.fn().mockReturnValueOnce('blob:old').mockReturnValueOnce('blob:other').mockReturnValueOnce('blob:new') });
    const revoke = vi.fn();
    Object.defineProperty(URL, 'revokeObjectURL', { configurable: true, value: revoke });
    const local = new LocalRepository('replace-owner');
    const other = new LocalRepository('replace-other');
    await local.putBlob('same', new Blob(['old']));
    await other.putBlob('same', new Blob(['other']));
    expect(await local.getBlobUrl('same')).toBe('blob:old');
    expect(await other.getBlobUrl('same')).toBe('blob:other');
    await local.putBlob('same', new Blob(['new']));
    expect(await local.getBlobUrl('same')).toBe('blob:new');
    expect(await other.getBlobUrl('same')).toBe('blob:other');
    expect(revoke.mock.calls).toEqual([['blob:old']]);
  });

  it('does not delete another thread message operation with a colliding message ID', async () => {
    const local = new LocalRepository('outbox-identity-owner');
    await local.createThread({ id: 'removed', title: 'Remove' });
    await local.mutateOutbox(() => [
      { operationId: 'other-message', kind: 'message.append', id: 'removed', threadId: 'kept' },
      { operationId: 'own-message', kind: 'message.append', id: 'message', threadId: 'removed' },
      { operationId: 'own-update', kind: 'thread.update', id: 'removed' },
    ]);
    await local.deleteThreadWithOutbox('removed', { operationId: 'delete', kind: 'thread.delete', id: 'removed' });
    expect(await local.listOutbox()).toEqual([
      { operationId: 'other-message', kind: 'message.append', id: 'removed', threadId: 'kept' },
      { operationId: 'delete', kind: 'thread.delete', id: 'removed' },
    ]);
  });

  it.each([undefined, false, true])('preserves creation dispatch knowledge across repository reopen: %s', async attempted => {
    const owner = `reopen-${String(attempted)}`;
    const local = new LocalRepository(owner);
    await local.createThread({ id: 'thread', title: 'A' });
    await local.mutateOutbox(() => [{ operationId: 'creation', kind: 'thread.create', id: 'thread', attempted }]);
    const reopened = new LocalRepository(owner);
    await reopened.deleteThreadWithOutbox('thread', { operationId: 'deletion', kind: 'thread.delete', id: 'thread' });
    expect(await local.listOutbox()).toEqual(attempted === false ? [] : [{ operationId: 'deletion', kind: 'thread.delete', id: 'thread' }]);
  });

  it('retains transactional deletion intent while a thread creation is in flight', async () => {
    const local = new LocalRepository('create-delete-owner');
    const calls: string[] = [];
    let release!: () => void;
    let entered!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    const started = new Promise<void>(resolve => { entered = resolve; });
    const remote = {
      createThread: async () => { calls.push('create-start'); entered(); await blocked; calls.push('create-end'); },
      deleteThread: async () => { calls.push('delete'); },
    } as unknown as CloudApi;
    const repo = new SyncRepository(local, remote, idbKvStore('create-delete-owner'));
    await repo.createThread({ id: 'late-create', title: 'A' });
    const pushing = repo.push();
    await started;
    try { await repo.deleteThread('late-create'); }
    finally { release(); await pushing; }
    expect(calls).toEqual(['create-start', 'create-end', 'delete']);
    expect(await local.getThread('late-create')).toBeNull();
    expect(await local.listOutbox()).toEqual([]);
  });

  it('keeps the newest account activation when an older realtime stop completes late', async () => {
    const { activateAccountData, accountLocalStorageKey, realtime } = await import('./index');
    let resolve!: () => void;
    const pending = new Promise<void>(done => { resolve = done; });
    const stop = vi.spyOn(realtime, 'stop').mockReturnValueOnce(pending).mockResolvedValue(undefined);
    try {
      const older = activateAccountData('earlier-owner');
      await activateAccountData('latest-owner');
      expect(accountLocalStorageKey('test')).toBe('test.latest-owner');
      resolve();
      await older;
      expect(accountLocalStorageKey('test')).toBe('test.latest-owner');
    } finally {
      resolve();
      await activateAccountData(null);
      stop.mockRestore();
    }
  });

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
