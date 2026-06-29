import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InProcessRetriever } from '../adapters/memory/inProcessRetriever';
import { MemoryContextService } from './memoryContextService';
import { parseMemoryRecord, type MemoryRecord } from '../domain/memory';
import type { Embedder } from '../ports/embedder';
import { DEFAULT_SETTINGS } from '../domain/settings';

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
    useCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    ...over,
  });

const CREDS = { baseUrl: 'b', key: 'k' };
const NOW = '2026-01-02T00:00:00Z';

describe('MemoryContextService — relevance channel', () => {
  it('retrieves by semantic similarity, not lexical overlap', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { embedder: stubEmbedder, retriever: new InProcessRetriever(store) });
    await store.put(rec({ id: 'mem_dog', text: 'User has a dog named Chopper.', embedding: stubEmbed('dog chopper') }));
    await store.put(rec({ id: 'mem_deploy', kind: 'project_context', text: 'Watai deploys to rg-watai-dev.', embedding: stubEmbed('deploy resource group') }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: "what's my pup's name?", now: NOW, creds: CREDS });
    expect(block.retrievalMode).toBe('vector');
    expect(block.memories.map((m) => m.id)).toEqual(['mem_dog']);
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
});

describe('MemoryContextService — profile channel', () => {
  it('injects an always-on identity profile and never includes sensitive memories', async () => {
    const store = new InMemoryMemoryStore();
    const ctx = new MemoryContextService(store, settingsReader(), { profile: true });
    await store.put(rec({ id: 'm1', kind: 'fact', text: 'User name is Prabin.', salience: 0.9 }));
    await store.put(rec({ id: 'm2', kind: 'fact', text: 'User SSN reference kept on file.', sensitive: true, salience: 0.95 }));

    const block = await ctx.buildForRun({ userId: 'userA', threadId: 't', latestUserText: 'what is the capital of France?', now: NOW });
    expect(block.profile ?? '').toContain('Prabin');
    expect(block.profile ?? '').not.toContain('SSN');
    expect(block.retrievalMode).toBe('profile');
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
