import { openDB, type IDBPDatabase } from 'idb';
import type { Message, Settings, Thread, MemoryItem, ApiConfig } from '../lib/types';

const DB_VERSION = 2;
export const LOCAL_QUARANTINE_OWNER = 'signed-out-quarantine';

interface Schema {
  threads: Thread;
  messages: Message;
  blobs: Blob;
  kv: unknown;
  outbox: { operationId: string };
}

const dbPromises = new Map<string, Promise<IDBPDatabase>>();
let activeOwnerId = LOCAL_QUARANTINE_OWNER;

export function activateLocalDataOwner(ownerId: string | null): string {
  activeOwnerId = ownerId?.trim() || LOCAL_QUARANTINE_OWNER;
  return activeOwnerId;
}

export function activeLocalDataOwner(): string {
  return activeOwnerId;
}

export function localDatabaseName(ownerId: string): string {
  const owner = ownerId.trim() || LOCAL_QUARANTINE_OWNER;
  return `watai.account.v2.${encodeURIComponent(owner)}`;
}

export function db(ownerId = activeOwnerId): Promise<IDBPDatabase> {
  const name = localDatabaseName(ownerId);
  let promise = dbPromises.get(name);
  if (!promise) {
    promise = openDB(name, DB_VERSION, {
      upgrade(database) {
        if (!database.objectStoreNames.contains('threads')) {
          database.createObjectStore('threads', { keyPath: 'id' });
        }
        if (!database.objectStoreNames.contains('messages')) {
          const ms = database.createObjectStore('messages', { keyPath: 'id' });
          ms.createIndex('byThread', 'threadId');
        }
        if (!database.objectStoreNames.contains('blobs')) {
          database.createObjectStore('blobs');
        }
        if (!database.objectStoreNames.contains('kv')) {
          database.createObjectStore('kv');
        }
        if (!database.objectStoreNames.contains('outbox')) {
          const outbox = database.createObjectStore('outbox', { keyPath: 'operationId' });
          outbox.createIndex('byState', 'state');
        }
      },
    });
    dbPromises.set(name, promise);
  }
  return promise;
}

export async function kvGet<T>(key: string, ownerId = activeOwnerId): Promise<T | undefined> {
  return (await db(ownerId)).get('kv', key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown, ownerId = activeOwnerId): Promise<void> {
  await (await db(ownerId)).put('kv', value, key);
}

export type { Settings, MemoryItem, ApiConfig };
