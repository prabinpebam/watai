import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InProcessRetriever } from '../adapters/memory/inProcessRetriever';
import { MemoryContextService, renderMemoryContext } from './memoryContextService';
import { memoryEmbeddingTextHash, parseMemoryContextBlock, parseMemoryRecord, type MemoryRecord } from '../domain/memory';
import type { Embedder } from '../ports/embedder';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { MemoryService } from './memoryService';
import { encode as encodeCl100k } from 'gpt-tokenizer/encoding/cl100k_base';
import { encode as encodeO200k } from 'gpt-tokenizer/encoding/o200k_base';

const tokenCount = (text: string) => Math.max(encodeCl100k(text, { disallowedSpecial: new Set() }).length,
  encodeO200k(text, { disallowedSpecial: new Set() }).length);

const settingsReader = () => ({ get: async () => ({ ...DEFAULT_SETTINGS }) });

/** Deterministic stub embedder: maps known phrases to a fixed 3-axis space (dog / deploy / food),
 *  encoding the *semantic* synonymy ("pup" → dog) the real model provides so ranking is testable. */
const stubEmbed = (text: string): number[] => {
  const t = text.toLowerCase();
  return [
    /dog|pup|puppy|chopper|lhasa|canine/.test(t) ? 1 : 0,
    /deploy|resource group|rg-|azure|watai/.test(t) ? 1 : 0,
    /pizza|food|eat|cuisine|meal|sushi/.test(t) ? 1 : 0,
  ];
};
const stubEmbedder: Embedder = { model: 'stub', embed: async (_c, text) => stubEmbed(text) };

const rec = (over: Partial<MemoryRecord> & { id: string; text: string }): MemoryRecord =>
  parseMemoryRecord({
    userId: 'userA',
    kind: 'fact',
    status: 'active',
    confidence: 0.9,
    salience: 0.7,
    pinned: false,
    sensitive: false,
    visibility: 'normal',
    embeddingModel: stubEmbedder.model,
    embeddingTextHash: memoryEmbeddingTextHash(over.text),
    useCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    origin: 'manual',
    confirmation: 'approved',
    revision: 1,
    ...over,
  });

const CREDS = { baseUrl: 'b', key: 'k' };
const NOW = '2026-01-02T00:00:00Z';

describe('MemoryContextService — relevance channel', () => {
  it('settles a caller-cancelled policy read before the underlying request returns', async () => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const store = new InMemoryMemoryStore();
      const list = vi.spyOn(store, 'list');
      const controller = new AbortController();
      const remove = vi.spyOn(controller.signal, 'removeEventListener');
      const service = new MemoryContextService(store, { get: async () => { await blocked; return DEFAULT_SETTINGS; } }, { profile: true });
      const work = service.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Recall', now: NOW, signal: controller.signal });
      controller.abort();
      expect(await work).toMatchObject({ degradedReason: 'cancelled', memories: [], latencyBudgetMs: 500 });
      expect(remove).toHaveBeenCalledWith('abort', expect.any(Function));
      release(); await vi.advanceTimersByTimeAsync(0);
      expect(list).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it('cleans a successful recall deadline without later aborting the completed work', async () => {
    vi.useFakeTimers();
    try {
      const store = new InMemoryMemoryStore();
      await store.put(rec({ id: 'saved', text: 'Approved preference', embedding: [1, 0, 0] }));
      let signal: AbortSignal | undefined;
      const embed: Embedder['embed'] = async (_credentials, _text, options) => { signal = options?.signal; return [1, 0, 0]; };
      const service = new MemoryContextService(store, settingsReader(), { embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store) });
      const block = await service.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Recall', now: NOW, creds: CREDS });
      expect(block.memories).toHaveLength(1);
      expect(block.degradedReason).toBeUndefined();
      expect(parseMemoryContextBlock(block)).toEqual(block);
      expect(vi.getTimerCount()).toBe(0);
      await vi.advanceTimersByTimeAsync(501);
      expect(signal?.aborted).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each(['settings', 'inventory', 'embedding', 'selected'] as const)('bounds stalled recall at %s and suppresses its late continuation', async stage => {
    vi.useFakeTimers();
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const store = new InMemoryMemoryStore();
      await store.put(rec({ id: 'saved', text: 'A saved preference.', embedding: [1, 0, 0] }));
      const listOriginal = store.list.bind(store);
      const list = vi.spyOn(store, 'list').mockImplementation(async (...args) => { if (stage === 'inventory') await blocked; return listOriginal(...args); });
      const getOriginal = store.get.bind(store);
      vi.spyOn(store, 'get').mockImplementation(async (...args) => { if (stage === 'selected') await blocked; return getOriginal(...args); });
      const excluded = vi.spyOn(store, 'isExcluded');
      let signal: AbortSignal | undefined;
      const embed = vi.fn<Embedder['embed']>(async (_credentials, _text, options) => {
        signal = options?.signal;
        if (stage === 'embedding') await blocked;
        return [1, 0, 0];
      });
      const service = new MemoryContextService(store, { get: async () => { if (stage === 'settings') await blocked; return DEFAULT_SETTINGS; } },
        { embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store) });
      let observed: Awaited<ReturnType<MemoryContextService['buildForRun']>> | undefined;
      const work = service.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Recall', now: NOW, creds: CREDS })
        .then(result => { observed = result; });
      await vi.advanceTimersByTimeAsync(501);
      const atDeadline = observed;
      release(); await work; await vi.advanceTimersByTimeAsync(0);
      expect(atDeadline).toMatchObject({ degradedReason: 'timeout', latencyBudgetMs: 500, memories: [], tokenEstimate: 0 });
      expect(list).toHaveBeenCalledTimes(stage === 'settings' ? 0 : 1);
      expect(embed).toHaveBeenCalledTimes(stage === 'settings' || stage === 'inventory' ? 0 : 1);
      expect(excluded).not.toHaveBeenCalled();
      if (signal) expect(signal.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it.each(['profile', 'vector', 'combined'].flatMap(mode => [200, 800].map(budget => ({ mode, budget }))))
    ('fits whole multilingual context under both real token encodings: %j', async ({ mode, budget }) => {
    const store = new InMemoryMemoryStore();
    const records = Array.from({ length: 3 }, (_, index) => rec({ id: `dense-${index}`,
      text: `${index}: ${'\u6771\u4eac\u3067\u4f1a\u8b70\u3092\u958b\u304d\u307e\u3059\u3002'.repeat(budget === 800 ? 30 : 8)}`,
      embedding: [1, 0, 0], salience: 0.9 - index * 0.1 }));
    for (const record of records) await store.put(record);
    const ctx = new MemoryContextService(store, settingsReader(), { profile: mode !== 'vector',
      ...(mode === 'profile' ? {} : { embedder: { model: 'stub', embed: async () => [1, 0, 0] }, retriever: new InProcessRetriever(store) }),
    });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Relevant memory', now: NOW, creds: CREDS, tokenBudget: budget });
    const rendered = renderMemoryContext(block);
    expect(encodeCl100k(rendered).length).toBeLessThanOrEqual(budget);
    expect(encodeO200k(rendered).length).toBeLessThanOrEqual(budget);
    expect(block.tokenEstimate).toBe(tokenCount(rendered));
    expect(block.memories.length).toBeGreaterThan(0);
    for (const supplied of block.memories) {
      expect(supplied.text).toBe(records.find(record => record.id === supplied.id)!.text);
      expect(rendered).toContain(supplied.text);
      expect(block.sourceRefs.some(source => source.memoryId === supplied.id)).toBe(true);
    }
  });

  it('counts special-token-looking memory as ordinary text rather than throwing or discounting it', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'literal', text: 'Keep <|endoftext|> and <|im_start|> as literal examples.' }));
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Hello', now: NOW });
    expect(block.memories).toHaveLength(1);
    expect(block.tokenEstimate).toBe(tokenCount(renderMemoryContext(block)));
  });

  it('does not supply a memory whose ID remains excluded after legacy content changes', async () => {
    const store = new InMemoryMemoryStore();
    const original = rec({ id: 'excluded-id', text: 'Changed active legacy content.', sourceHash: 'new-hash' });
    await store.put(original);
    await store.exclude(original, { id: 'memory-exclusion-excluded-id', userId: 'userA', memoryId: original.id,
      sourceHash: 'old-hash', sourceKeys: [], excludedAt: NOW }, 1);
    const service = new MemoryContextService(store, settingsReader(), { profile: true });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Hello', now: NOW });
    expect(result.memories).toEqual([]);
    expect(result.profile).toBeUndefined();
  });

  it.each(['duplicate', 'conflict', 'sensitive', 'automatic', 'foreign'] as const)
    ('keeps bounded pinned candidates private and consistent: %s', async change => {
      const store = new InMemoryMemoryStore();
      const pinned = rec({ id: 'pin', text: 'Explicit saved preference.', pinned: true, salience: 1 });
      await store.put(pinned);
      const supplemental = { ...pinned,
        ...(change === 'conflict' ? { text: 'Conflicting snapshot', revision: 2 } : {}),
        ...(change === 'sensitive' ? { sensitive: true } : {}),
        ...(change === 'automatic' ? { confirmation: 'automatic' as const } : {}),
        ...(change === 'foreign' ? { userId: 'foreign' } : {}),
      };
      vi.spyOn(store, 'list').mockResolvedValueOnce({ memories: change === 'duplicate' || change === 'conflict' ? [pinned] : [], cursor: 'next' })
        .mockResolvedValueOnce({ memories: [supplemental], cursor: 'still-more' });
      const service = new MemoryContextService(store, { get: async () => ({ ...DEFAULT_SETTINGS, personalization: {
        ...DEFAULT_SETTINGS.personalization, memory: { ...DEFAULT_SETTINGS.personalization.memory!, learnChats: 'off' },
      } }) }, { profile: true });
      const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Hello', now: NOW });
      expect(result.memories.map(memory => memory.id)).toEqual(change === 'duplicate' ? ['pin'] : []);
      expect(store.list).toHaveBeenCalledTimes(2);
    });

  it.each([1, 2])('stops pinned candidate work after cancellation at read %s', async cancelledRead => {
    const store = new InMemoryMemoryStore();
    const controller = new AbortController();
    let calls = 0;
    vi.spyOn(store, 'list').mockImplementation(async () => {
      if (++calls === cancelledRead) controller.abort();
      return { memories: [], cursor: 'next' };
    });
    const embed = vi.fn(async () => [1, 0, 0]);
    const service = new MemoryContextService(store, settingsReader(), { profile: true,
      embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store) });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Hello', now: NOW, creds: CREDS, signal: controller.signal });
    expect(result.memories).toEqual([]);
    expect(store.list).toHaveBeenCalledTimes(cancelledRead);
    expect(embed).not.toHaveBeenCalled();
  });

  it.each([50, 200, 201, 1000])('considers an older explicit pin with bounded reads among %s saved records', async count => {
    const store = new InMemoryMemoryStore();
    for (let index = 1; index < count; index += 1) {
      await store.put(rec({ id: `recent-${index}`, text: `Recent fact ${index}.`, salience: 0.1 }));
    }
    await store.put(rec({ id: 'older-pin', text: 'Approved older important preference.', pinned: true, salience: 1,
      createdAt: '2020-01-01T00:00:00Z', updatedAt: '2020-01-01T00:00:00Z' }));
    const list = vi.spyOn(store, 'list');
    const service = new MemoryContextService(store, { get: async () => ({ ...DEFAULT_SETTINGS, personalization: {
      ...DEFAULT_SETTINGS.personalization, memory: { ...DEFAULT_SETTINGS.personalization.memory!, learnChats: 'off' },
    } }) }, { profile: true });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Hello', now: NOW });
    expect(result.memories.some(memory => memory.id === 'older-pin')).toBe(true);
    expect(result.profile).toContain('Approved older important preference.');
    expect(result.tokenEstimate).toBeLessThanOrEqual(800);
    expect(list).toHaveBeenCalledTimes(count > 200 ? 2 : 1);
    if (count > 200) expect(list.mock.calls[1]).toEqual(['userA', {
      status: 'active', limit: 16, confirmations: ['approved'], excludeKinds: ['project_context'], pinned: true,
    }]);
  });

  it.each(['before', 'inventory', 'embedding', 'selected'] as const)('stops recall work after cancellation at %s', async stage => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'cancellable', text: 'Approved preference', embedding: [1, 0, 0] }));
    const controller = new AbortController();
    const listOriginal = store.list.bind(store);
    const list = vi.spyOn(store, 'list').mockImplementation(async (...args) => {
      const result = await listOriginal(...args);
      if (stage === 'inventory') controller.abort();
      return result;
    });
    const getOriginal = store.get.bind(store);
    const get = vi.spyOn(store, 'get').mockImplementation(async (...args) => {
      const result = await getOriginal(...args);
      if (stage === 'selected') controller.abort();
      return result;
    });
    const excluded = vi.spyOn(store, 'isExcluded');
    let observedSignal: AbortSignal | undefined;
    const embed = vi.fn(async (_credentials: unknown, _text: string, options?: { signal?: AbortSignal }) => {
      observedSignal = options?.signal;
      if (stage === 'embedding') controller.abort();
      return [1, 0, 0];
    });
    if (stage === 'before') controller.abort();
    const service = new MemoryContextService(store, settingsReader(), { embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store) });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Preference', now: NOW, creds: CREDS, signal: controller.signal });
    expect(result.memories).toEqual([]);
    expect(list).toHaveBeenCalledTimes(stage === 'before' ? 0 : 1);
    expect(embed).toHaveBeenCalledTimes(stage === 'before' || stage === 'inventory' ? 0 : 1);
    if (stage === 'embedding' || stage === 'selected') expect(observedSignal?.aborted).toBe(true);
    expect(get).toHaveBeenCalledTimes(stage === 'selected' ? 1 : 0);
    expect(excluded).not.toHaveBeenCalled();
  });

  it.each([2000, Infinity, NaN, -1])('keeps caller budgets within the product context ceiling: %s', async tokenBudget => {
    const store = new InMemoryMemoryStore();
    for (let index = 0; index < 3; index += 1) {
      await store.put(rec({ id: `budget-${index}`, text: `Preference ${index}: ${'detailed '.repeat(130)}`.trim(),
        embedding: [1, 0, 0], pinned: true }));
    }
    const service = new MemoryContextService(store, settingsReader(), {
      embedder: { model: 'stub', embed: async () => [1, 0, 0] }, retriever: new InProcessRetriever(store), profile: true,
    });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Preferences',
      now: NOW, creds: CREDS, tokenBudget });
    expect(result.tokenEstimate).toBeLessThanOrEqual(800);
    if (!Number.isFinite(tokenBudget) || tokenBudget < 0) expect(result.memories).toEqual([]);
    else expect(result.memories.length).toBeGreaterThan(0);
  });

  it('does not read memory or call a model when the master opt-out conflicts with enabled nested settings', async () => {
    const store = new InMemoryMemoryStore();
    const list = vi.spyOn(store, 'list');
    const embed = vi.fn(async () => [1, 0, 0]);
    const settings = { ...DEFAULT_SETTINGS, personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false } };
    const service = new MemoryContextService(store, { get: async () => settings }, {
      profile: true, embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store),
    });
    const result = await service.buildForRun({ userId: 'userA', threadId: 'thread', latestUserText: 'Hello', now: NOW, creds: CREDS });
    expect(result.memories).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['missing', 'stale', 'current', 'wrong-dimension', 'zero'] as const)('requires a current usable vector to open the profile relevance gate: %s', async state => {
    const store = new InMemoryMemoryStore();
    const text = 'User has a dog named Chopper.';
    await store.put(rec({ id: 'profile', text, pinned: true, salience: 0.95,
      embedding: state === 'wrong-dimension' ? [1, 0] : state === 'zero' ? [0, 0, 0] : [1, 0, 0],
      embeddingTextHash: state === 'missing' ? undefined : memoryEmbeddingTextHash(state === 'stale' ? 'Old unrelated text.' : text),
    }));
    const context = new MemoryContextService(store, settingsReader(), {
      embedder: stubEmbedder, retriever: { retrieve: async () => [] }, profile: true,
    });
    const block = await context.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    if (state === 'current') expect(block.profile).toContain(text);
    else expect(block.memories).toEqual([]);
  });

  it('keeps unrelated approved profile memories available after forgetting a manual memory', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'forgotten', text: 'Forgotten preference.', sourceHash: 'forgotten-hash' }));
    await store.put(rec({ id: 'retained', text: 'Retained preference.', sourceHash: 'retained-hash' }));
    await new MemoryService(store, { now: () => NOW, newId: () => 'unused' }).delete('userA', 'forgotten');
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'hello', now: NOW });
    expect(block.memories.map(memory => memory.id)).toEqual(['retained']);
  });

  it.each(['vector', 'profile', 'combined', 'empty'] as const)('budgets the actual serialized %s context including headings and separators', async mode => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'main', text: 'User prefers concise implementation plans. '.repeat(4).trim(), salience: 0.9, embedding: stubEmbed('dog') }));
    await store.put(rec({ id: 'extra', text: 'Additional profile fact.', salience: 0.8 }));
    const ctx = new MemoryContextService(store, settingsReader(), {
      ...(mode !== 'profile' ? { embedder: stubEmbedder, retriever: new InProcessRetriever(store) } : {}),
      profile: mode === 'profile' || mode === 'combined',
    });
    const tokenBudget = mode === 'profile' ? 50 : mode === 'combined' ? 90 : mode === 'empty' ? 1 : 60;
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS, tokenBudget });
    const serialized = renderMemoryContext(block);
    expect(block.tokenEstimate).toBe(tokenCount(serialized));
    expect(block.tokenEstimate).toBeLessThanOrEqual(tokenBudget);
    if (mode === 'empty') expect(serialized).toBe('');
    else expect(block.memories.length).toBeGreaterThan(0);
    if (mode === 'combined') expect(block.profile).toContain('Additional profile fact.');
  });

  it('logs a fixed diagnostic instead of the query embedding error payload', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const store = new InMemoryMemoryStore();
      const embedder: Embedder = { model: 'stub', embed: async () => { throw new Error('Private query; provider credential=synthetic'); } };
      const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
      await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
      expect(warn.mock.calls).toEqual([['[memory] query embed failed']]);
    } finally {
      warn.mockRestore();
    }
  });

  it.each([false, true].flatMap(profile => ['deleted', 'edited', 'excluded', 'read-failed'].map(change => ({ profile, change }))))('drops stale assembled context after a memory change: %j', async ({ profile, change }) => {
    const store = new InMemoryMemoryStore();
    const record = rec({ id: 'selected', text: 'User prefers concise plans.', sourceHash: 'content-hash', salience: 0.9, embedding: stubEmbed('dog') });
    await store.put(record);
    const embedder: Embedder = { model: 'stub', embed: async () => {
      if (change === 'deleted') await store.put({ ...record, status: 'deleted', revision: 2 });
      if (change === 'edited') await store.put({ ...record, text: 'New approved preference.', revision: 2 });
      if (change === 'excluded') await store.exclude(record, { id: 'exclusion', userId: 'userA', memoryId: record.id, sourceHash: record.sourceHash, sourceKeys: [], excludedAt: NOW }, record.revision ?? 1);
      if (change === 'read-failed') vi.spyOn(store, 'get').mockRejectedValue(new Error('Read unavailable'));
      return stubEmbed('dog');
    } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: profile ? { retrieve: async () => [] } : new InProcessRetriever(store), profile });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
    expect(block.instructions).toEqual([]);
    expect(block.profile).toBeUndefined();
    expect(block.tokenEstimate).toBe(0);
  });

  it.each([false, true])('revalidates only unique selected IDs, with no extra reads for empty context (selected=%s)', async selected => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'selected', text: 'User prefers concise plans.', embedding: stubEmbed('dog'), salience: 0.9 }));
    const get = vi.spyOn(store, 'get');
    const excluded = vi.spyOn(store, 'isExcluded');
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: selected ? 'my dog' : 'unrelated', now: NOW, creds: CREDS });
    expect(block.memories).toHaveLength(selected ? 1 : 0);
    expect(get).toHaveBeenCalledTimes(selected ? 1 : 0);
    expect(excluded).toHaveBeenCalledTimes(selected ? 1 : 0);
  });

  it('returns empty under release containment without reading settings, memories, or embeddings', async () => {
    const store = new InMemoryMemoryStore();
    const settings = { get: async () => { throw new Error('must not read settings'); } };
    const embedder: Embedder = { model: 'blocked', embed: async () => { throw new Error('must not embed'); } };
    const ctx = new MemoryContextService(store, settings, {
      embedder,
      retriever: new InProcessRetriever(store),
      profile: true,
      contained: () => true,
    });

    await expect(ctx.buildForRun({ userId: 'userA', threadId: 't1', latestUserText: 'hello', now: NOW, creds: CREDS }))
      .resolves.toMatchObject({ memories: [], instructions: [], retrievalMode: 'empty' });
  });

  it('retrieves by semantic similarity, not lexical overlap', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));
    await store.put(rec({ id: 'mem_deploy', kind: 'project_context', text: 'Watai deploys to rg-watai-dev.', embedding: stubEmbed('deploy resource group') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my pup's name?", now: NOW, creds: CREDS });
    expect(block.retrievalMode).toBe('vector');
    expect(block.memories.map((m) => m.id)).toEqual(['mem_dog']);
  });

  it('never injects project_context memories, even a relevant one (threads are isolated by design)', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_proj', kind: 'project_context', text: 'Watai deploys to rg-watai-dev.', embedding: stubEmbed('deploy resource group') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what resource group do we deploy Watai to?', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
  });

  it('returns an empty block when nothing clears the relevance floor', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('keeps pinned memories even below the relevance floor', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_pinned', kind: 'preference', text: 'User prefers British English.', pinned: true, embedding: [0, 1, 0] }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'tell me about my dog', now: NOW, creds: CREDS });
    expect(block.memories.map((m) => m.id)).toEqual(['mem_pinned']);
  });

  it('does NOT inject a top_of_mind memory that is below the relevance floor (ranking lift only)', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    // High-salience identity fact, auto-marked top_of_mind, unrelated to the query (deploy axis vs dog axis).
    await store.put(rec({ id: 'mem_tom', kind: 'fact', text: 'User has a daughter named Laija.', visibility: 'top_of_mind', embedding: [0, 1, 0] }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'tell me about my dog', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
  });

  it('fails open to an empty block when the embedder throws (reply never blocked)', async () => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async () => { throw new Error('boom'); } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog.', embedding: [1, 0, 0] }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'tell me about my dog', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('returns empty retrieval when no embedder is configured', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader());
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my dog's name?", now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('returns empty when memory is disabled in settings', async () => {
    const store = new InMemoryMemoryStore();
    const disabled = {
      get: async () => ({
        ...DEFAULT_SETTINGS,
        personalization: {
          ...DEFAULT_SETTINGS.personalization,
          memoryEnabled: false,
          memory: { enabled: false, paused: false, referenceSaved: false, referenceHistory: false, autoExtract: false },
        },
      }),
    };
    const ctx = new MemoryContextService(store, disabled, { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog.', embedding: stubEmbed('dog') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my dog's name?", now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
  });

  it('keeps saved-memory reads available while learning is paused', async () => {
    const store = new InMemoryMemoryStore();
    const paused = { get: async () => ({
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, paused: true, learnChats: 'automatic' as const },
      },
    }) };
    const ctx = new MemoryContextService(store, paused, { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'saved', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog') }));
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    expect(block.memories.map((memory) => memory.id)).toEqual(['saved']);
  });

  it('serves only approved records in saved-only mode and stays within the total token budget', async () => {
    const store = new InMemoryMemoryStore();
    const savedOnly = { get: async () => ({
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, learnChats: 'off' as const, autoExtract: false },
      },
    }) };
    const ctx = new MemoryContextService(store, savedOnly, { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({ id: 'approved', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog') }));
    await store.put(rec({ id: 'automatic', text: 'Automatic dog claim.', origin: 'inferred', confirmation: 'automatic', embedding: stubEmbed('dog') }));
    await store.put(rec({ id: 'legacy', text: 'Legacy dog claim.', origin: undefined, confirmation: undefined, embedding: stubEmbed('dog') }));
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS, tokenBudget: 800 });
    expect(block.memories.map((memory) => memory.id)).toEqual(['approved']);
    expect(block.profile ?? '').not.toContain('Automatic dog claim');
    expect(block.profile ?? '').not.toContain('Legacy dog claim');
    expect(block.tokenEstimate).toBeLessThanOrEqual(800);
  });

  it('fails closed to empty context when policy cannot be loaded', async () => {
    const store = new InMemoryMemoryStore();
    const unavailable = { get: async () => { throw new Error('settings unavailable'); } };
    const ctx = new MemoryContextService(store, unavailable, { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({ id: 'secret', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog') }));
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    expect(block).toMatchObject({ memories: [], instructions: [], retrievalMode: 'empty' });
    expect(block.profile).toBeUndefined();
  });

  it('drops assembled context when policy is revoked during retrieval', async () => {
    const store = new InMemoryMemoryStore();
    let enabled = true;
    const reader = { get: async () => ({
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memoryEnabled: enabled,
        memory: { enabled, paused: false, referenceSaved: enabled, referenceHistory: enabled, autoExtract: enabled },
      },
    }) };
    const embedder: Embedder = { model: 'stub', embed: async () => { enabled = false; return stubEmbed('dog'); } };
    const ctx = new MemoryContextService(store, reader, { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'secret', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog') }));
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    expect(block.memories).toEqual([]);
  });
});

describe('MemoryContextService — profile channel', () => {
  it('filters ineligible records before the candidate limit so older approved saves remain available', async () => {
    const store = new InMemoryMemoryStore();
    await store.put(rec({ id: 'older-approved', text: 'Use concise explanations.', updatedAt: '2026-01-01T00:00:00Z' }));
    for (let index = 0; index < 201; index++) {
      await store.put(rec({ id: `unknown-${index}`, text: `Unverified ${index}`, confirmation: 'unknown', updatedAt: NOW }));
      await store.put(rec({ id: `project-${index}`, text: `Project ${index}`, kind: 'project_context', updatedAt: NOW }));
    }
    const reader = { get: async () => ({ ...DEFAULT_SETTINGS, personalization: {
      ...DEFAULT_SETTINGS.personalization,
      memory: { enabled: true, paused: true, referenceSaved: true, referenceHistory: true, autoExtract: true },
    } }) };
    const list = vi.spyOn(store, 'list');
    const ctx = new MemoryContextService(store, reader, { profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'Explain deployment.', now: NOW });
    expect(block.memories.map(memory => memory.id)).toEqual(['older-approved']);
    expect(list).toHaveBeenCalledOnce();
  });

  it.each([true, false])('uses current approved saves without embeddings when learning is paused (saved reads=%s)', async readSaved => {
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, { newId: () => 'manual-save', now: () => NOW });
    const saved = await service.createManual('userA', { text: 'Use concise explanations.', kind: 'preference' });
    await store.put(rec({ id: 'automatic', text: 'Unapproved inference.', origin: 'inferred', confirmation: 'automatic' }));
    await store.put(rec({ id: 'unknown', text: 'Unverified import.', origin: 'imported', confirmation: 'unknown' }));
    const reader = { get: async () => ({ ...DEFAULT_SETTINGS, personalization: {
      ...DEFAULT_SETTINGS.personalization,
      memory: { enabled: true, paused: true, referenceSaved: readSaved, referenceHistory: true, autoExtract: true },
    } }) };
    const embed = vi.fn(stubEmbedder.embed);
    const ctx = new MemoryContextService(store, reader, { profile: true, embedder: { model: 'stub', embed }, retriever: new InProcessRetriever(store) });
    const input = { userId: 'userA', threadId: 't', latestUserText: 'Explain deployment options.', now: NOW, creds: CREDS };
    const first = await ctx.buildForRun(input);
    expect(first.memories.map(memory => memory.id)).toEqual(readSaved ? [saved.id] : []);
    await service.patch('userA', saved.id, { expectedRevision: 1, text: 'Use detailed explanations.' });
    const corrected = await ctx.buildForRun(input);
    expect(corrected.memories.map(memory => memory.text)).toEqual(readSaved ? ['Use detailed explanations.'] : []);
    expect(embed).not.toHaveBeenCalled();
    if (readSaved) {
      expect(corrected.retrievalMode).toBe('profile');
      expect(corrected.memories[0].revision).toBe(2);
      expect(corrected.tokenEstimate).toBe(tokenCount(renderMemoryContext(corrected)));
    }
  });

  it.each(['omitted', 'deleted', 'excluded'] as const)('does not use a %s nonemitted record to open unrelated profile context', async condition => {
    const store = new InMemoryMemoryStore();
    const witness = rec({ id: 'not-emitted', text: 'Long private evidence. '.repeat(60).trim(), sourceHash: 'witness-hash', embedding: stubEmbed('dog') });
    await store.put(witness);
    await store.put(rec({ id: 'unrelated', text: 'Unrelated saved preference.', salience: 0.9, embedding: stubEmbed('food') }));
    const embedder: Embedder = { model: 'stub', embed: async () => {
      if (condition === 'deleted') await store.put({ ...witness, status: 'deleted', revision: 2 });
      if (condition === 'excluded') await store.exclude(witness, { id: 'exclusion', userId: 'userA', memoryId: witness.id, sourceHash: witness.sourceHash, sourceKeys: [], excludedAt: NOW }, witness.revision ?? 1);
      return stubEmbed('dog');
    } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: { retrieve: async () => [] }, profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS, tokenBudget: 50 });
    expect(block.profile).toBeUndefined();
    expect(block.memories).toEqual([]);
  });

  it('limits profile disclosure to the context schema record cap', async () => {
    const store = new InMemoryMemoryStore();
    for (let index = 0; index < 20; index++) {
      await store.put(rec({ id: `fact-${index}`, text: `Fact ${index}`, kind: 'fact' }));
      await store.put(rec({ id: `preference-${index}`, text: `Preference ${index}`, kind: 'preference' }));
    }
    const get = vi.spyOn(store, 'get');
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'hello', now: NOW });
    expect(block.memories.length).toBeGreaterThan(0);
    expect(block.memories.length).toBeLessThanOrEqual(16);
    expect(get.mock.calls.length).toBeLessThanOrEqual(16);
    expect(() => parseMemoryContextBlock(block)).not.toThrow();
  });

  it.each(['duplicate', 'prefix'] as const)('tracks only actually emitted profile records instead of %s text matches', async condition => {
    const store = new InMemoryMemoryStore();
    const text = 'User prefers concise plans, especially for architecture.';
    await store.put(rec({ id: 'included', text, salience: 0.95 }));
    await store.put(rec({ id: 'omitted', text: condition === 'duplicate' ? text : 'User prefers concise plans', salience: 0.7 }));
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    const tokenBudget = tokenCount(renderMemoryContext({ profile: `About the user:\n- ${text}`, instructions: [], memories: [] }));
    expect(tokenCount(renderMemoryContext({ profile: `About the user:\n- ${text}\n- User prefers concise plans`, instructions: [], memories: [] }))).toBeGreaterThan(tokenBudget);
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'hello', now: NOW, tokenBudget });
    expect(block.profile).toContain(text);
    expect(block.memories.map(memory => memory.id)).toEqual(['included']);
    expect(block.sourceRefs.map(source => source.memoryId)).toEqual(['included']);
    expect(block.tokenEstimate).toBeLessThanOrEqual(tokenBudget);
  });

  it('omits a read-race truncated profile rather than emitting an untracked multiline fragment', async () => {
    const store = new InMemoryMemoryStore();
    const record = rec({ id: 'multiline', text: `Private first line\n${'Private second line '.repeat(20)}`, salience: 0.9, embedding: stubEmbed('dog') });
    await store.put(record);
    const embedder: Embedder = { model: 'stub', embed: async () => {
      await store.put({ ...record, status: 'deleted', revision: 2 });
      return stubEmbed('dog');
    } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store), profile: true });
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS, tokenBudget: 20 });
    expect(block.profile).toBeUndefined();
    expect(block.memories).toEqual([]);
    expect(block.tokenEstimate).toBe(0);
  });

  it.each(['wrong-model', 'unknown-model', 'query-failed'] as const)('does not open the profile gate on incompatible or unavailable relevance: %s', async condition => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async () => {
      if (condition === 'query-failed') throw new Error('Embedding unavailable');
      return stubEmbed('dog');
    } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({
      id: 'identity', text: 'User name is Prabin.', salience: 0.9, embedding: stubEmbed('dog'),
      embeddingModel: condition === 'unknown-model' ? undefined : condition === 'wrong-model' ? 'other-model' : 'stub',
    }));
    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'my dog', now: NOW, creds: CREDS });
    expect(block.profile).toBeUndefined();
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('falls back to an always-on identity profile when no embedder is configured (cannot judge relevance), and never includes sensitive memories', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9 }));
    await store.put(rec({ id: 'm2', kind: 'fact', text: 'User SSN reference kept on file.', sensitive: true, salience: 0.95 }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: NOW });
    expect(block.profile ?? '').toContain('Prabin');
    expect(block.profile ?? '').not.toContain('SSN');
    expect(block.retrievalMode).toBe('profile');
  });

  it('relevance-gates the profile: no profile for a query unrelated to anything known', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9, embedding: stubEmbed('dog') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: NOW, creds: CREDS });
    expect(block.profile).toBeUndefined();
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('injects the profile when the query relates to something known (gate opens)', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9, embedding: stubEmbed('dog') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'tell me about my dog', now: NOW, creds: CREDS });
    expect(block.profile ?? '').toContain('Prabin');
  });

  it('combines profile with vector retrieval when both are enabled', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store), profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9, embedding: [0, 0, 0] }));
    await store.put(rec({ id: 'mem_dog', kind: 'fact', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my pup's name?", now: NOW, creds: CREDS });
    expect(block.retrievalMode).toBe('vector');
    expect(block.memories.map((m) => m.id)).toContain('mem_dog');
    expect(block.profile ?? '').toContain('Prabin');
  });
});
