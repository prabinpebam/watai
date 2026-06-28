import { describe, expect, it } from 'vitest';
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
  return { memory, ctx };
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
    const off = makeServices({ personalization: { memoryEnabled: false } });
    await off.memory.createManual('userA', { text: 'Watai deploy target is rg-watai-dev.', kind: 'project_context' });
    expect((await off.ctx.buildForRun({ userId: 'userA', threadId: 'thr_1', latestUserText: 'deploy?', now: '2026-01-01T00:01:00Z' })).memories).toEqual([]);

    const on = makeServices();
    await on.memory.createManual('userA', { text: 'User prefers short implementation plans.', kind: 'preference' });
    const block = await on.ctx.buildForRun({ userId: 'userA', threadId: 'thr_1', latestUserText: 'What is the weather?', now: '2026-01-01T00:01:00Z' });
    expect(block.retrievalMode).toBe('empty');
    expect(block.memories).toEqual([]);
  });
});