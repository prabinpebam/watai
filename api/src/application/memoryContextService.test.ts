import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { MemoryService } from './memoryService';
import { MemoryContextService } from './memoryContextService';
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
});