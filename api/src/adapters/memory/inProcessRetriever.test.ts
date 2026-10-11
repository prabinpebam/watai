import { describe, expect, it } from 'vitest';
import { createHash } from 'node:crypto';
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
    embeddingModel: 'test-embed',
    embeddingTextHash: createHash('sha256').update(over.text).digest('hex'),
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
  it('rejects stale, missing, malformed and foreign-owner vector bindings even when pinned', async () => {
    const current = rec({ id: 'current', text: 'Current exact text.', embedding: [1, 0], pinned: true });
    const digest = createHash('sha256').update(current.text).digest('hex');
    const candidates = [
      { ...current, embeddingTextHash: digest },
      { ...current, id: 'missing', embeddingTextHash: undefined },
      { ...current, id: 'stale', text: 'Edited text.', embeddingTextHash: digest },
      { ...current, id: 'malformed', embeddingTextHash: 'not-a-digest' },
      { ...current, id: 'foreign', userId: 'another-owner', embeddingTextHash: digest },
    ];
    const result = await new InProcessRetriever(new InMemoryMemoryStore()).retrieve('userA', [1, 0], {
      now: '2026-02-01T00:00:00Z', limit: 10, embeddingModel: 'test-embed', candidates,
    });
    expect(result.map(item => item.memory.id)).toEqual(['current']);
  });

  it('excludes missing or mismatched model identities even for pinned memories', async () => {
    const retriever = new InProcessRetriever(new InMemoryMemoryStore());
    const candidates = [
      rec({ id: 'matching', text: 'matching', embedding: [1, 0] }),
      rec({ id: 'different', text: 'different', embedding: [1, 0], embeddingModel: 'other-model', pinned: true }),
      rec({ id: 'unknown', text: 'unknown', embedding: [1, 0], embeddingModel: undefined, pinned: true }),
    ];
    const options = { now: '2026-02-01T00:00:00Z', limit: 10, candidates, embeddingModel: 'test-embed' };
    expect((await retriever.retrieve('userA', [1, 0], options)).map(result => result.memory.id)).toEqual(['matching']);
    expect(await retriever.retrieve('userA', [1, 0], { ...options, embeddingModel: '' })).toEqual([]);
  });

  it('excludes dimension-mismatched, non-finite and zero vectors instead of scoring them', async () => {
    const store = new InMemoryMemoryStore();
    const candidates = [
      rec({ id: 'valid', text: 'valid', embedding: [1, 0] }),
      rec({ id: 'wrong-dimension', text: 'wrong dimension', embedding: [1, 0, 0], pinned: true }),
      rec({ id: 'zero', text: 'zero', embedding: [0, 0], pinned: true }),
      { ...rec({ id: 'non-finite', text: 'non finite', pinned: true }), embedding: [NaN, 1] },
      { ...rec({ id: 'infinite', text: 'infinite', pinned: true }), embedding: [Infinity, 1] },
    ];
    const retriever = new InProcessRetriever(store);
    const options = { now: '2026-02-01T00:00:00Z', limit: 10, candidates, embeddingModel: 'test-embed' };
    expect((await retriever.retrieve('userA', [1, 0], options)).map(result => result.memory.id)).toEqual(['valid']);
    for (const query of [[0, 0], [NaN, 1], [Infinity, 1]]) {
      expect(await retriever.retrieve('userA', query, options)).toEqual([]);
    }
  });

  it('ranks embedded active memories by similarity and skips unembedded ones', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'a', text: 'a', embedding: [1, 0, 0] }));
    await store.put(rec({ id: 'b', text: 'b', embedding: [0, 1, 0] }));
    await store.put(rec({ id: 'c', text: 'c (no vector)' }));
    const retriever = new InProcessRetriever(store);

    const out = await retriever.retrieve('userA', [1, 0, 0], { now: '2026-02-01T00:00:00Z', limit: 5, embeddingModel: 'test-embed' });
    expect(out.map((s) => s.memory.id)).toEqual(['a', 'b']);
    expect(out[0].relevance).toBeCloseTo(1);
    expect(out[1].relevance).toBe(0);
  });

  it('excludes temporally invalid memories and respects the limit', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'valid', text: 'valid', embedding: [1, 0, 0] }));
    await store.put(rec({ id: 'expired', text: 'expired', embedding: [1, 0, 0], invalidAt: '2026-01-15T00:00:00Z' }));
    const retriever = new InProcessRetriever(store);

    const out = await retriever.retrieve('userA', [1, 0, 0], { now: '2026-02-01T00:00:00Z', limit: 1, embeddingModel: 'test-embed' });
    expect(out.map((s) => s.memory.id)).toEqual(['valid']);
  });

  it('returns nothing for an empty query vector', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'a', text: 'a', embedding: [1, 0, 0] }));
    const retriever = new InProcessRetriever(store);
    expect(await retriever.retrieve('userA', [], { now: '2026-02-01T00:00:00Z', limit: 5, embeddingModel: 'test-embed' })).toEqual([]);
  });
});
