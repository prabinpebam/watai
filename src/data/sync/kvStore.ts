// Tiny key/value persistence port for the sync engine's queue + delta cursors.
// The production implementation is backed by the same IndexedDB `kv` store the
// rest of the app uses; tests inject an in-memory implementation.
import { activeLocalDataOwner, db, kvGet, kvSet } from '../db';

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  update<T>(key: string, mutate: (current: T | undefined) => T | undefined): Promise<T | undefined>;
}

export function idbKvStore(ownerId = activeLocalDataOwner()): KvStore {
  return {
    get: <T>(key: string) => kvGet<T>(key, ownerId),
    set: (key: string, value: unknown) => kvSet(key, value, ownerId),
    async delete(key: string): Promise<void> {
      await (await db(ownerId)).delete('kv', key);
    },
    async keys(): Promise<string[]> {
      return (await (await db(ownerId)).getAllKeys('kv')) as string[];
    },
    async update<T>(key: string, mutate: (current: T | undefined) => T | undefined): Promise<T | undefined> {
      const transaction = (await db(ownerId)).transaction('kv', 'readwrite');
      const current = await transaction.store.get(key) as T | undefined;
      const next = mutate(current);
      if (next === undefined) await transaction.store.delete(key);
      else await transaction.store.put(next, key);
      await transaction.done;
      return next;
    },
  };
}

/** In-memory KvStore — handy for tests and as the default when IDB is unavailable. */
export function memoryKvStore(): KvStore {
  const map = new Map<string, unknown>();
  return {
    async get<T>(key: string): Promise<T | undefined> {
      return map.has(key) ? (map.get(key) as T) : undefined;
    },
    async set(key: string, value: unknown): Promise<void> {
      map.set(key, value);
    },
    async delete(key: string): Promise<void> {
      map.delete(key);
    },
    async keys(): Promise<string[]> {
      return [...map.keys()];
    },
    async update<T>(key: string, mutate: (current: T | undefined) => T | undefined): Promise<T | undefined> {
      const next = mutate(map.get(key) as T | undefined);
      if (next === undefined) map.delete(key);
      else map.set(key, next);
      return next;
    },
  };
}
