import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { AppError } from '../domain/errors';
import { MemoryService } from './memoryService';

function makeService() {
  const store = new InMemoryMemoryStore();
  let n = 0;
  let t = 0;
  const service = new MemoryService(store, {
    newId: () => `mem_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  });
  return { service, store };
}

function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  return fn()
    .then(() => undefined)
    .catch((e) => (e as AppError).code);
}

describe('MemoryService', () => {
  it('creates manual memories with server-owned defaults', async () => {
    const { service } = makeService();
    const record = await service.createManual('userA', {
      text: '  Remember that Watai deploys to rg-watai-dev.  ',
      kind: 'fact',
      pinned: true,
      visibility: 'top_of_mind',
    });
    expect(record).toMatchObject({
      id: 'mem_1',
      userId: 'userA',
      kind: 'fact',
      status: 'active',
      text: 'Remember that Watai deploys to rg-watai-dev.',
      normalizedText: 'remember that watai deploys to rg-watai-dev.',
      confidence: 1,
      salience: 0.7,
      pinned: true,
      sensitive: false,
      visibility: 'top_of_mind',
      useCount: 0,
    });
    expect(record.sourceRefs).toEqual([{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }]);
  });

  it('lists caller-scoped memories with status, kind, q, and limit filters', async () => {
    const { service } = makeService();
    await service.createManual('userA', { text: 'User prefers short implementation plans.', kind: 'preference' });
    await service.createManual('userA', { text: 'Watai deploys to rg-watai-dev.', kind: 'fact' });
    await service.createManual('userB', { text: 'Other user prefers verbose plans.', kind: 'preference' });

    const q = await service.list('userA', { q: 'deploy', limit: 10 });
    expect(q.memories.map((m) => m.text)).toEqual(['Watai deploys to rg-watai-dev.']);

    const prefs = await service.list('userA', { kind: 'preference' });
    expect(prefs.memories.map((m) => m.text)).toEqual(['User prefers short implementation plans.']);
  });

  it('uses deterministic pagination cursors', async () => {
    const { service } = makeService();
    await service.createManual('userA', { text: 'One' });
    await service.createManual('userA', { text: 'Two' });
    await service.createManual('userA', { text: 'Three' });

    const first = await service.list('userA', { limit: 2 });
    expect(first.memories.map((m) => m.text)).toEqual(['Three', 'Two']);
    expect(first.cursor).toBeTruthy();

    const second = await service.list('userA', { limit: 2, cursor: first.cursor });
    expect(second.memories.map((m) => m.text)).toEqual(['One']);
    expect(second.cursor).toBeUndefined();
  });

  it('patches status and excludes suppressed/deleted memories from default list', async () => {
    const { service } = makeService();
    const active = await service.createManual('userA', { text: 'Keep this.' });
    const hidden = await service.createManual('userA', { text: 'Hide this.' });
    await service.patch('userA', hidden.id, { status: 'suppressed' });
    await service.delete('userA', active.id);

    expect((await service.list('userA', {})).memories).toHaveLength(0);
    expect((await service.list('userA', { status: 'suppressed' })).memories.map((m) => m.id)).toEqual([hidden.id]);
    expect((await service.list('userA', { status: 'deleted' })).memories.map((m) => m.id)).toEqual([active.id]);
  });

  it('invalidates with invalidAt and rejects patching deleted memories', async () => {
    const { service } = makeService();
    const record = await service.createManual('userA', { text: 'Old fact.' });
    const invalidated = await service.patch('userA', record.id, { status: 'invalidated' });
    expect(invalidated.invalidAt).toBe('2026-01-01T00:00:01Z');

    await service.delete('userA', record.id);
    expect(await code(() => service.patch('userA', record.id, { text: 'New text.' }))).toBe('conflict');
  });

  it('stores and replaces the user summary', async () => {
    const { service } = makeService();
    expect(await service.getSummary('userA')).toBeNull();
    const summary = await service.putSummary('userA', '  User prefers concise engineering detail.  ');
    expect(summary).toMatchObject({ id: 'memory-summary', kind: 'summary', text: 'User prefers concise engineering detail.', version: 1 });
    const replaced = await service.putSummary('userA', 'Updated summary.');
    expect(replaced).toMatchObject({ text: 'Updated summary.', version: 2 });
  });
});