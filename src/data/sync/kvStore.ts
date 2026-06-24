// Tiny key/value persistence port for the sync engine's queue + delta cursors.
// The production implementation is backed by the same IndexedDB `kv` store the
// rest of the app uses; tests inject an in-memory implementation.
import { db, kvGet, kvSet } from '../db';

export interface KvStore {
  get<T>(key: string): Promise<T | undefined>;
  set(key: string, value: unknown): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
}

export function idbKvStore(): KvStore {
  return {
    get: <T>(key: string) => kvGet<T>(key),
    set: (key: string, value: unknown) => kvSet(key, value),
    async delete(key: string): Promise<void> {
      await (await db()).delete('kv', key);
    },
    async keys(): Promise<string[]> {
      return (await (await db()).getAllKeys('kv')) as string[];
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
  };
}
