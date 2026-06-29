import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InProcessRetriever } from '../adapters/memory/inProcessRetriever';
import { MemoryService } from './memoryService';
import { MemoryContextService } from './memoryContextService';
import { parseMemoryRecord, type MemoryRecord } from '../domain/memory';
import type { Embedder } from '../ports/embedder';
import { DEFAULT_SETTINGS, type Settings } from '../domain/settings';

function makeServices(settings?: Partial<Settings>) {
  const store = new InMemoryMemoryStore();
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `mem_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const memory = new MemoryService(store, clock);
  const ctx = new MemoryContextService(store, {
    get: async () => ({ ...DEFAULT_SETTINGS, ...settings, personalization: { ...DEFAULT_SETTINGS.personalization, ...settings?.personalization } }),
  });
  return { memory, ctx, store };
}

describe('MemoryContextService', () => {
  it('selects bounded active memories by lexical relevance', async () => {
    const { memory, ctx } = makeServices();
    const deploy = await memory.createManual('userA', { text: 'Watai deploy target is rg-watai-dev.', kind: 'project_context' });
    await memory.createManual('userA', { text: 'User prefers short implementation plans.', kind: 'preference' });
    const suppressed = await memory.createManual('userA', { text: 'Watai deploy target is rg-old-demo.', kind: 'project_context' });
    await memory.patch('userA', suppressed.id, { status: 'suppressed' });

    const block = await ctx.buildForRun({
      userId: 'userA',
      threadId: 'thr_1',
      latestUserText: 'What resource group should I deploy Watai to?',
      now: '2026-01-01T00:01:00Z',
    });

    expect(block.retrievalMode).toBe('lexical');
    expect(block.memories.map((m) => m.id)).toEqual([deploy.id]);
    expect(block.sourceRefs).toEqual([{ memoryId: deploy.id }]);
    expect(block.tokenEstimate).toBeGreaterThan(0);
  });

  it('returns an empty context when memory is disabled or query has no support', async () => {
    const off = makeServices({
      personalization: {
        memoryEnabled: false,
        memory: { enabled: false, paused: false, referenceSaved: false, referenceHistory: false, autoExtract: false },
      },
    });
    await off.memory.createManual('userA', { text: 'Watai deploy target is rg-watai-dev.', kind: 'project_context' });
    expect((await off.ctx.buildForRun({ userId: 'userA', threadId: 'thr_1', latestUserText: 'deploy?', now: '2026-01-01T00:01:00Z' })).memories).toEqual([]);

    const on = makeServices();
    await on.memory.createManual('userA', { text: 'User prefers short implementation plans.', kind: 'preference' });
    const block = await on.ctx.buildForRun({ userId: 'userA', threadId: 'thr_1', latestUserText: 'What is the weather?', now: '2026-01-01T00:01:00Z' });
    expect(block.retrievalMode).toBe('empty');
    expect(block.memories).toEqual([]);
  });

  it('does not touch memory storage for generic prompts without memory intent', async () => {
    const { memory, ctx, store } = makeServices();
    await memory.createManual('userA', { text: 'User prefers concise implementation plans.', kind: 'preference' });
    const list = vi.spyOn(store, 'list');

    const block = await ctx.buildForRun({
      userId: 'userA',
      threadId: 'thr_1',
      latestUserText: 'Write a debounce hook in TypeScript.',
      now: '2026-01-01T00:01:00Z',
    });

    expect(block.retrievalMode).toBe('empty');
    expect(list).not.toHaveBeenCalled();
  });

  it('retrieves personal memory only when the prompt asks for it', async () => {
    const { memory, ctx } = makeServices();
    const chopper = await memory.createManual('userA', { text: 'User has a dog named Chopper inspired by One Piece.', kind: 'fact' });

    const block = await ctx.buildForRun({
      userId: 'userA',
      threadId: 'thr_1',
      latestUserText: "What is my dog's name?",
      now: '2026-01-01T00:01:00Z',
    });

    expect(block.retrievalMode).toBe('lexical');
    expect(block.memories.map((m) => m.id)).toEqual([chopper.id]);
  });

  it('caps default memory context to a small relevant set', async () => {
    const { memory, ctx } = makeServices();
    for (let i = 0; i < 6; i++) {
      await memory.createManual('userA', { text: `Watai Azure deploy note ${i}: use the dev resource group for deployment checks.`, kind: 'project_context' });
    }

    const block = await ctx.buildForRun({
      userId: 'userA',
      threadId: 'thr_1',
      latestUserText: 'How should I deploy Watai on Azure?',
      now: '2026-01-01T00:01:00Z',
    });

    expect(block.memories).toHaveLength(3);
    expect(block.tokenEstimate).toBeLessThanOrEqual(400);
  });

  const settingsReader = () => ({ get: async () => ({ ...DEFAULT_SETTINGS }) });
  const stubEmbed = (text: string): number[] => {
    const t = text.toLowerCase();
    return [
      /dog|pup|puppy|chopper|lhasa|canine/.test(t) ? 1 : 0,
      /deploy|resource group|rg-|azure|watai/.test(t) ? 1 : 0,
      /pizza|food|eat|cuisine|meal|sushi/.test(t) ? 1 : 0,
    ];
  };
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
      useCount: 0,
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
      ...over,
    });

  it('retrieves by semantic similarity, not lexical overlap', async () => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async (_c, text) => stubEmbed(text) };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));
    await store.put(rec({ id: 'mem_deploy', kind: 'project_context', text: 'Watai deploys to rg-watai-dev.', embedding: stubEmbed('deploy resource group') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my pup's name?", now: '2026-01-02T00:00:00Z', creds: { baseUrl: 'b', key: 'k' } });
    expect(block.retrievalMode).toBe('vector');
    expect(block.memories.map((m) => m.id)).toEqual(['mem_dog']);
  });

  it('returns an empty block when nothing clears the relevance floor', async () => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async (_c, text) => stubEmbed(text) };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: '2026-01-02T00:00:00Z', creds: { baseUrl: 'b', key: 'k' } });
    expect(block.memories).toEqual([]);
    expect(block.retrievalMode).toBe('empty');
  });

  it('falls back to lexical retrieval when the embedder fails (no regression)', async () => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async () => { throw new Error('boom'); } };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', kind: 'fact', text: 'User has a dog named Chopper.', embedding: [1, 0, 0] }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what is my dog's name?", now: '2026-01-02T00:00:00Z', creds: { baseUrl: 'b', key: 'k' } });
    expect(block.retrievalMode).toBe('lexical');
    expect(block.memories.map((m) => m.id)).toEqual(['mem_dog']);
  });

  it('keeps pinned memories even below the relevance floor', async () => {
    const store = new InMemoryMemoryStore();
    const embedder: Embedder = { model: 'stub', embed: async (_c, text) => stubEmbed(text) };
    const ctx = new MemoryContextService(store, settingsReader(), { embedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_pinned', kind: 'preference', text: 'User prefers British English.', pinned: true, embedding: [0, 1, 0] }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'tell me about my dog', now: '2026-01-02T00:00:00Z', creds: { baseUrl: 'b', key: 'k' } });
    expect(block.memories.map((m) => m.id)).toEqual(['mem_pinned']);
  });

  it('injects an always-on identity profile and never includes sensitive memories', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9 }));
    await store.put(rec({ id: 'm2', kind: 'fact', text: 'User SSN reference kept on file.', sensitive: true, salience: 0.95 }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: '2026-01-02T00:00:00Z' });
    expect(block.profile ?? '').toContain('Prabin');
    expect(block.profile ?? '').not.toContain('SSN');
    expect(block.retrievalMode).toBe('profile');
  });
});