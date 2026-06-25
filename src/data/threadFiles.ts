import { kvGet, kvSet } from './db';

// Per-thread vector store mapping. The store itself lives in the user's own AI plane (Foundry
// vector store); only the opaque id is kept — locally, since the synced Thread schema is strict
// and the bytes never touch Watai's backend (privacy invariant D4).
const key = (threadId: string) => `thread.vectorStore.${threadId}`;

/** The vector store id holding a thread's uploaded documents, if any. */
export async function getThreadVectorStore(threadId: string): Promise<string | undefined> {
  return kvGet<string>(key(threadId));
}

/** Persist the vector store id for a thread's uploaded documents. */
export async function setThreadVectorStore(threadId: string, storeId: string): Promise<void> {
  await kvSet(key(threadId), storeId);
}
