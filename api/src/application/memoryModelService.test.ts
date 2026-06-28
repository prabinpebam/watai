import { describe, expect, it } from 'vitest';
import { InMemoryAppConfigStore } from '../adapters/memory/appConfigStore';
import { MemoryModelService } from './memoryModelService';

function makeService(baseEnv?: string, deepEnv?: string) {
  const store = new InMemoryAppConfigStore();
  let t = 0;
  const clock = { newId: () => `id_${t}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  return { store, svc: new MemoryModelService(store, () => baseEnv, () => deepEnv, clock) };
}

describe('MemoryModelService', () => {
  it('falls back to the user chat model when nothing is configured', async () => {
    const { svc } = makeService(undefined, undefined);
    expect(await svc.effectiveModel('turn')).toBeUndefined();
    expect(await svc.effectiveModel('rebuild')).toBeUndefined();
    const view = await svc.getConfig();
    expect(view.base).toMatchObject({ model: null, source: 'chat' });
    expect(view.deep).toMatchObject({ model: null, source: 'base' });
  });

  it('uses the env defaults for each tier when no override is set', async () => {
    const { svc } = makeService('gpt-5.4-mini', 'gpt-5.4');
    expect(await svc.effectiveModel('command')).toBe('gpt-5.4-mini');
    expect(await svc.effectiveModel('turn')).toBe('gpt-5.4-mini');
    expect(await svc.effectiveModel('rebuild')).toBe('gpt-5.4');
    const view = await svc.getConfig();
    expect(view.base).toMatchObject({ model: 'gpt-5.4-mini', source: 'env', envDefault: 'gpt-5.4-mini' });
    expect(view.deep).toMatchObject({ model: 'gpt-5.4', source: 'env', envDefault: 'gpt-5.4' });
  });

  it('dispatches routine lanes to base and rebuild to deep — they are distinct', async () => {
    const { svc } = makeService('gpt-5.4-mini', 'gpt-5.4');
    const routine = await svc.effectiveModel('turn');
    const heavy = await svc.effectiveModel('rebuild');
    expect(routine).toBe('gpt-5.4-mini');
    expect(heavy).toBe('gpt-5.4');
    expect(routine).not.toBe(heavy);
  });

  it('falls back deep to the routine model when no deep model is configured', async () => {
    const { svc } = makeService('gpt-5.4-mini', undefined);
    expect(await svc.effectiveModel('rebuild')).toBe('gpt-5.4-mini');
    const view = await svc.getConfig();
    expect(view.deep).toMatchObject({ model: 'gpt-5.4-mini', source: 'base', envDefault: null });
  });

  it('prefers admin overrides over env defaults for both tiers and records who set them', async () => {
    const { svc } = makeService('gpt-5.4-mini', 'gpt-5.4');
    const view = await svc.setModels({ memoryModel: 'gpt-6-mini', memoryDeepModel: 'gpt-6' }, 'admin@example.com');
    expect(view.base).toMatchObject({ model: 'gpt-6-mini', source: 'override', override: 'gpt-6-mini' });
    expect(view.deep).toMatchObject({ model: 'gpt-6', source: 'override', override: 'gpt-6' });
    expect(view.updatedBy).toBe('admin@example.com');
    expect(await svc.effectiveModel('turn')).toBe('gpt-6-mini');
    expect(await svc.effectiveModel('rebuild')).toBe('gpt-6');
  });

  it('clears overrides with empty strings and reverts to env defaults', async () => {
    const { svc } = makeService('gpt-5.4-mini', 'gpt-5.4');
    await svc.setModels({ memoryModel: 'gpt-6-mini', memoryDeepModel: 'gpt-6' }, 'admin@example.com');
    const view = await svc.setModels({ memoryModel: '', memoryDeepModel: '' }, 'admin@example.com');
    expect(view.base).toMatchObject({ model: 'gpt-5.4-mini', source: 'env', override: null });
    expect(view.deep).toMatchObject({ model: 'gpt-5.4', source: 'env', override: null });
  });

  it('rejects invalid model updates', async () => {
    const { svc } = makeService('gpt-5.4-mini', 'gpt-5.4');
    await expect(svc.setModels({ memoryModel: 123 })).rejects.toThrow(/Invalid memory model update/);
    await expect(svc.setModels({ unknown: 'x' })).rejects.toThrow(/Invalid memory model update/);
  });
});
