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
    expect(res.body).toMatchObject({ revision: 0, appearance: { theme: 'system' } });
  });

  it('PATCH merges a section, preserving siblings → 200', async () => {
    const ctrl = setup();
    const res = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { appearance: { theme: 'dark' } } } });
    expect(res.status).toBe(200);
    const body = res.body as { revision: number; appearance: { theme: string; density: string } };
    expect(body.revision).toBe(1);
    expect(body.appearance.theme).toBe('dark');
    expect(body.appearance.density).toBe('comfortable');
  });

  it('persists across get after patch → 200', async () => {
    const ctrl = setup();
    await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { voice: { autoSend: true } } } });
    const res = await ctrl.get({ claims: { sub: 'userA' } });
    const settings = res.body as { voice: { autoStopDictation: boolean; autoSend?: boolean } };
    expect(settings.voice.autoStopDictation).toBe(true);
    expect(settings.voice.autoSend).toBeUndefined();
  });

  it('unauthenticated → 401', async () => {
    const ctrl = setup();
    const res = await ctrl.get({ claims: {} });
    expect(res.status).toBe(401);
  });

  it('invalid patch → 400', async () => {
    const ctrl = setup();
    const res = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { appearance: { theme: 'neon' } } } });
    expect(res.status).toBe(400);
  });

  it('rejects device-only microphone identifiers', async () => {
    const ctrl = setup();
    const res = await ctrl.patch({
      claims: { sub: 'userA' },
      body: { expectedRevision: 0, patch: { voice: { inputDeviceId: 'local-microphone' } } },
    });
    expect(res.status).toBe(400);
  });

  it('returns 409 for a stale revision', async () => {
    const ctrl = setup();
    await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { personalization: { memoryEnabled: false } } } });
    const stale = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { personalization: { memoryEnabled: true } } } });
    expect(stale.status).toBe(409);
  });
});
