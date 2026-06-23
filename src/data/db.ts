import { openDB, type IDBPDatabase } from 'idb';
import type { Message, Settings, Thread, MemoryItem, ApiConfig } from '../lib/types';

const DB_NAME = 'watai';
const DB_VERSION = 1;

interface Schema {
  threads: Thread;
  messages: Message;
  blobs: Blob;
  kv: unknown;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

export function db(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
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
      },
    });
  }
  return dbPromise;
}

export async function kvGet<T>(key: string): Promise<T | undefined> {
  return (await db()).get('kv', key) as Promise<T | undefined>;
}

export async function kvSet(key: string, value: unknown): Promise<void> {
  await (await db()).put('kv', value, key);
}

export type { Settings, MemoryItem, ApiConfig };
