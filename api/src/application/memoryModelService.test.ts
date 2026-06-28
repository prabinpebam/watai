import { describe, expect, it } from 'vitest';
import { InMemoryAppConfigStore } from '../adapters/memory/appConfigStore';
import { MemoryModelService } from './memoryModelService';

function makeService(env?: string) {
  const store = new InMemoryAppConfigStore();
  let t = 0;
  const clock = { newId: () => `id_${t}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  return { store, svc: new MemoryModelService(store, () => env, clock) };
}

describe('MemoryModelService', () => {
  it('falls back to the user chat model when no override or env is set', async () => {
    const { svc } = makeService(undefined);
    expect(await svc.effectiveModel()).toBeUndefined();
    expect(await svc.getConfig()).toMatchObject({ memoryModel: null, source: 'chat', envDefault: null, override: null });
  });

  it('uses the env default when no admin override is set', async () => {
    const { svc } = makeService('gpt-5.4-mini');
    expect(await svc.effectiveModel()).toBe('gpt-5.4-mini');
    expect(await svc.getConfig()).toMatchObject({ memoryModel: 'gpt-5.4-mini', source: 'env', envDefault: 'gpt-5.4-mini', override: null });
  });

  it('prefers an admin override over the env default and records who set it', async () => {
    const { svc } = makeService('gpt-5.4-mini');
    const view = await svc.setModel({ memoryModel: 'gpt-6-mini' }, 'admin@example.com');
    expect(view).toMatchObject({ memoryModel: 'gpt-6-mini', source: 'override', envDefault: 'gpt-5.4-mini', override: 'gpt-6-mini', updatedBy: 'admin@example.com' });
    expect(await svc.effectiveModel()).toBe('gpt-6-mini');
  });

  it('clears the override with an empty string and reverts to the env default', async () => {
    const { svc } = makeService('gpt-5.4-mini');
    await svc.setModel({ memoryModel: 'gpt-6-mini' }, 'admin@example.com');
    const view = await svc.setModel({ memoryModel: '' }, 'admin@example.com');
    expect(view).toMatchObject({ memoryModel: 'gpt-5.4-mini', source: 'env', override: null });
    expect(await svc.effectiveModel()).toBe('gpt-5.4-mini');
  });

  it('rejects invalid model updates', async () => {
    const { svc } = makeService('gpt-5.4-mini');
    await expect(svc.setModel({ memoryModel: 123 })).rejects.toThrow(/Invalid memory model update/);
    await expect(svc.setModel({ unknown: 'x' })).rejects.toThrow(/Invalid memory model update/);
  });
});
