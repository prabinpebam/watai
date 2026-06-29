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
}

/**
 * Returns a user's active memories ranked by vector similarity to a query embedding. The default
 * implementation scans in-process; a Cosmos `VectorDistance` implementation can be swapped in behind
 * the same contract without changing the serve path.
 */
export interface RetrieveResult {
  scored: ScoredMemory[];
  /** Number of active candidates that actually carried an embedding. 0 ⇒ embeddings have not
   *  reached this user's data yet, so the caller should fall back to lexical retrieval. */
  embeddedCandidates: number;
}

export interface MemoryRetriever {
  retrieve(userId: string, queryEmbedding: number[], opts: MemoryRetrieveOptions): Promise<RetrieveResult>;
}
