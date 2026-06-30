import type { MemoryRecord } from '../domain/memory';

export interface ScoredMemory {
  memory: MemoryRecord;
  /** Cosine similarity of the memory's embedding to the query embedding, clamped to 0..1. */
  relevance: number;
}

export interface MemoryRetrieveOptions {
  /** ISO timestamp used to exclude temporally-invalid memories. */
  now: string;
  /** Maximum number of scored memories to return. */
  limit: number;
  /** Upper bound on candidates scanned before ranking. */
  candidateLimit?: number;
  /** Pre-fetched active candidate set. When provided, an in-process retriever ranks over it instead
   *  of re-listing the store, so a caller that also needs the active set (e.g. the always-on
   *  profile) can share a single read. A vector-native retriever may ignore it. */
  candidates?: MemoryRecord[];
}

/**
 * Returns a user's active memories ranked by vector similarity to a query embedding. The default
 * implementation scans in-process; a Cosmos `VectorDistance` implementation can be swapped in behind
 * the same contract without changing the serve path.
 */
export interface MemoryRetriever {
  retrieve(userId: string, queryEmbedding: number[], opts: MemoryRetrieveOptions): Promise<ScoredMemory[]>;
}
