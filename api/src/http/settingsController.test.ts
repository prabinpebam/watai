import { describe, it, expect } from 'vitest';
import { createSettingsController } from './settingsController';
import { SettingsService } from '../application/settingsService';
import { InMemorySettingsStore } from '../adapters/memory/settingsStore';

function setup() {
  return createSettingsController(new SettingsService(new InMemorySettingsStore()));
}

describe('settingsController', () => {
  it('GET returns defaults for a new user → 200', async () => {
    const ctrl = setup();
    const res = await ctrl.get({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect((res.body as { appearance: { theme: string } }).appearance.theme).toBe('system');
  });

  it('PATCH merges a section, preserving siblings → 200', async () => {
    const ctrl = setup();
    const res = await ctrl.patch({ claims: { sub: 'userA' }, body: { appearance: { theme: 'dark' } } });
    expect(res.status).toBe(200);
    const body = res.body as { appearance: { theme: string; density: string } };
    expect(body.appearance.theme).toBe('dark');
    expect(body.appearance.density).toBe('comfortable');
  });

  it('persists across get after patch → 200', async () => {
    const ctrl = setup();
    await ctrl.patch({ claims: { sub: 'userA' }, body: { voice: { autoSend: false } } });
    const res = await ctrl.get({ claims: { sub: 'userA' } });
    expect((res.body as { voice: { autoSend: boolean } }).voice.autoSend).toBe(false);
  });

  it('unauthenticated → 401', async () => {
    const ctrl = setup();
    const res = await ctrl.get({ claims: {} });
    expect(res.status).toBe(401);
  });

  it('invalid patch → 400', async () => {
    const ctrl = setup();
    const res = await ctrl.patch({ claims: { sub: 'userA' }, body: { appearance: { theme: 'neon' } } });
    expect(res.status).toBe(400);
  });
});
