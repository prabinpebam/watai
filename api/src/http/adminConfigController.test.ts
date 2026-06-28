import { describe, expect, it } from 'vitest';
import { InMemoryAppConfigStore } from '../adapters/memory/appConfigStore';
import { MemoryModelService } from '../application/memoryModelService';
import { createAdminConfigController } from './adminConfigController';
import type { ApiRequest } from './types';

function makeController(baseEnv?: string, deepEnv?: string) {
  const store = new InMemoryAppConfigStore();
  let t = 0;
  const clock = { newId: () => `id_${t}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  return createAdminConfigController(new MemoryModelService(store, () => baseEnv, () => deepEnv, clock));
}

const req = (body?: unknown, sub = 'admin@example.com'): ApiRequest => ({ claims: { sub }, body }) as ApiRequest;

describe('adminConfigController', () => {
  it('returns the effective memory model config for both tiers', async () => {
    const ctrl = makeController('gpt-5.4-mini', 'gpt-5.4');
    const res = await ctrl.getMemoryModel(req());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ base: { model: 'gpt-5.4-mini', source: 'env' }, deep: { model: 'gpt-5.4', source: 'env' } });
  });

  it('sets overrides for both tiers and reflects them on the next read', async () => {
    const ctrl = makeController('gpt-5.4-mini', 'gpt-5.4');
    const set = await ctrl.setMemoryModel(req({ memoryModel: 'gpt-6-mini', memoryDeepModel: 'gpt-6' }));
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ base: { model: 'gpt-6-mini', source: 'override' }, deep: { model: 'gpt-6', source: 'override' } });

    const get = await ctrl.getMemoryModel(req());
    expect(get.body).toMatchObject({ base: { override: 'gpt-6-mini' }, deep: { override: 'gpt-6' } });
  });

  it('maps invalid input to a validation error envelope', async () => {
    const ctrl = makeController('gpt-5.4-mini', 'gpt-5.4');
    const res = await ctrl.setMemoryModel(req({ memoryModel: 123 }));
    expect(res.status).toBe(400);
  });
});
