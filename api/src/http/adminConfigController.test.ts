import { describe, expect, it } from 'vitest';
import { InMemoryAppConfigStore } from '../adapters/memory/appConfigStore';
import { MemoryModelService } from '../application/memoryModelService';
import { createAdminConfigController } from './adminConfigController';
import type { ApiRequest } from './types';

function makeController(env?: string) {
  const store = new InMemoryAppConfigStore();
  let t = 0;
  const clock = { newId: () => `id_${t}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  return createAdminConfigController(new MemoryModelService(store, () => env, clock));
}

const req = (body?: unknown, sub = 'admin@example.com'): ApiRequest => ({ claims: { sub }, body }) as ApiRequest;

describe('adminConfigController', () => {
  it('returns the effective memory model config', async () => {
    const ctrl = makeController('gpt-5.4-mini');
    const res = await ctrl.getMemoryModel(req());
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ memoryModel: 'gpt-5.4-mini', source: 'env' });
  });

  it('sets an override and reflects it on the next read', async () => {
    const ctrl = makeController('gpt-5.4-mini');
    const set = await ctrl.setMemoryModel(req({ memoryModel: 'gpt-6-mini' }));
    expect(set.status).toBe(200);
    expect(set.body).toMatchObject({ memoryModel: 'gpt-6-mini', source: 'override' });

    const get = await ctrl.getMemoryModel(req());
    expect(get.body).toMatchObject({ memoryModel: 'gpt-6-mini', source: 'override' });
  });

  it('maps invalid input to a validation error envelope', async () => {
    const ctrl = makeController('gpt-5.4-mini');
    const res = await ctrl.setMemoryModel(req({ memoryModel: 123 }));
    expect(res.status).toBe(400);
  });
});
