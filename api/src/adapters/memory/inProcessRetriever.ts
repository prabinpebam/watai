import { isRetrievableMemory } from '../../domain/memory';
import type { MemoryStore } from '../../ports/memoryStore';
import type { MemoryRetriever, MemoryRetrieveOptions, ScoredMemory } from '../../ports/memoryRetriever';

/** Cosine similarity, clamped to 0..1 (negative similarities are treated as "not similar"). */
export function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  const cos = dot / (Math.sqrt(na) * Math.sqrt(nb));
  return cos > 0 ? Math.min(1, cos) : 0;
}

/**
 * Exact in-process cosine retrieval over a user's active memories. Suited to the small per-user sets
 * this product has; it is swappable for a Cosmos `VectorDistance` retriever behind the same
 * {@link MemoryRetriever} port without changing the serve path.
 */
export class InProcessRetriever implements MemoryRetriever {
  constructor(private readonly store: MemoryStore) {}

  async retrieve(userId: string, queryEmbedding: number[], opts: MemoryRetrieveOptions): Promise<ScoredMemory[]> {
    if (!queryEmbedding.length) return [];
    const page = await this.store.list(userId, { status: 'active', limit: opts.candidateLimit ?? 200 });
    const scored: ScoredMemory[] = [];
    for (const memory of page.memories) {
      if (!memory.embedding?.length) continue;
      if (!isRetrievableMemory(memory, opts.now)) continue;
      scored.push({ memory, relevance: cosineSimilarity(queryEmbedding, memory.embedding) });
    }
    scored.sort((a, b) => b.relevance - a.relevance || b.memory.updatedAt.localeCompare(a.memory.updatedAt));
    return scored.slice(0, opts.limit);
  }
}
