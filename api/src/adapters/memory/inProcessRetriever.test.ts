import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from './memoryStore';
import { InProcessRetriever, cosineSimilarity } from './inProcessRetriever';
import { parseMemoryRecord, type MemoryRecord } from '../../domain/memory';

function rec(over: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord {
  return parseMemoryRecord({
    userId: 'userA',
    kind: 'fact',
    status: 'active',
    confidence: 0.9,
    salience: 0.7,
    pinned: false,
    sensitive: false,
    visibility: 'normal',
    useCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    ...over,
  });
}

describe('cosineSimilarity', () => {
  it('is 1 for identical vectors, 0 for orthogonal and negative', () => {
    expect(cosineSimilarity([1, 2, 3], [1, 2, 3])).toBeCloseTo(1);
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0);
    expect(cosineSimilarity([1, 0], [-1, 0])).toBe(0);
    expect(cosineSimilarity([1, 0], [])).toBe(0);
  });
});

describe('InProcessRetriever', () => {
  it('ranks embedded active memories by similarity and skips unembedded ones', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'a', text: 'a', embedding: [1, 0, 0] }));
    await store.put(rec({ id: 'b', text: 'b', embedding: [0, 1, 0] }));
    await store.put(rec({ id: 'c', text: 'c (no vector)' }));
    const retriever = new InProcessRetriever(store);

    const out = await retriever.retrieve('userA', [1, 0, 0], { now: '2026-02-01T00:00:00Z', limit: 5 });
    expect(out.scored.map((s) => s.memory.id)).toEqual(['a', 'b']);
    expect(out.embeddedCandidates).toBe(2);
    expect(out.scored[0].relevance).toBeCloseTo(1);
    expect(out.scored[1].relevance).toBe(0);
  });

  it('excludes temporally invalid memories and respects the limit', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'valid', text: 'valid', embedding: [1, 0, 0] }));
    await store.put(rec({ id: 'expired', text: 'expired', embedding: [1, 0, 0], invalidAt: '2026-01-15T00:00:00Z' }));
    const retriever = new InProcessRetriever(store);

    const out = await retriever.retrieve('userA', [1, 0, 0], { now: '2026-02-01T00:00:00Z', limit: 1 });
    expect(out.scored.map((s) => s.memory.id)).toEqual(['valid']);
  });

  it('returns nothing for an empty query vector', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'a', text: 'a', embedding: [1, 0, 0] }));
    const retriever = new InProcessRetriever(store);
    expect((await retriever.retrieve('userA', [], { now: '2026-02-01T00:00:00Z', limit: 5 })).scored).toEqual([]);
  });
});
