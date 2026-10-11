import { describe, it, expect } from 'vitest';
import { createSettingsController } from './settingsController';
import { SettingsService } from '../application/settingsService';
import { InMemorySettingsStore } from '../adapters/memory/settingsStore';
import { DEFAULT_MEMORY_SETTINGS, DEFAULT_SETTINGS, effectiveMemoryPolicy } from '../domain/settings';

function setup() {
  return createSettingsController(new SettingsService(new InMemorySettingsStore()));
}

describe('settingsController', () => {
  it.each([
    { referenceSaved: false }, { paused: true }, { autoExtract: false }, { learnChats: 'review' },
  ])('accepts client-shaped partial memory changes without losing siblings: %j', async change => {
    const ctrl = setup();
    const seeded = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0,
      patch: { personalization: { memoryEnabled: true, memory: DEFAULT_MEMORY_SETTINGS } } } });
    expect(seeded.status).toBe(200);
    const result = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 1,
      patch: { personalization: { memory: change } } } });
    expect(result.status).toBe(200);
    expect((await ctrl.get({ claims: { sub: 'userA' } })).body).toMatchObject({ revision: 2,
      personalization: { memoryEnabled: true, memory: { ...DEFAULT_MEMORY_SETTINGS, ...change } } });
    const stale = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 1,
      patch: { personalization: { memory: { enabled: false } } } } });
    expect(stale.status).toBe(409);
    expect((await ctrl.get({ claims: { sub: 'userA' } })).body).toMatchObject({ revision: 2,
      personalization: { memory: { ...DEFAULT_MEMORY_SETTINGS, ...change } } });
  });

  it('does not enable a new account through its first partial memory preference patch', async () => {
    const ctrl = setup();
    const result = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0,
      patch: { personalization: { memory: { referenceSaved: true } } } } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ revision: 1, personalization: { memoryEnabled: false } });
    expect(effectiveMemoryPolicy(result.body as typeof DEFAULT_SETTINGS)).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('does not auto-enable the master opt-out while editing nested preferences', async () => {
    const ctrl = setup();
    await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { personalization: { memoryEnabled: false } } } });
    const result = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 1, patch: { personalization: { memory: { referenceSaved: true } } } } });
    expect(result.status).toBe(200);
    expect(effectiveMemoryPolicy(result.body as typeof DEFAULT_SETTINGS)).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('rejects unknown nested memory fields without writing settings', async () => {
    const ctrl = setup();
    expect((await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0,
      patch: { personalization: { memory: { referenceSaved: false, unexpected: true } } } } })).status).toBe(400);
    expect((await ctrl.get({ claims: { sub: 'userA' } })).body).toMatchObject({ revision: 0 });
  });

  it('GET returns defaults for a new user → 200', async () => {
    const ctrl = setup();
    const res = await ctrl.get({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ revision: 0, appearance: { theme: 'system' } });
    expect(effectiveMemoryPolicy(res.body as typeof DEFAULT_SETTINGS)).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('keeps new-account memory controls stable through unrelated persistence and explicit opt-in', async () => {
    const ctrl = setup();
    const initial = await ctrl.get({ claims: { sub: 'userA' } });
    const first = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 0, patch: { appearance: { theme: 'dark' } } } });
    expect((first.body as typeof DEFAULT_SETTINGS).personalization).toEqual((initial.body as typeof DEFAULT_SETTINGS).personalization);
    const enabled = await ctrl.patch({ claims: { sub: 'userA' }, body: { expectedRevision: 1, patch: { personalization: { memoryEnabled: true } } } });
    expect(enabled.status).toBe(200);
    expect(effectiveMemoryPolicy(enabled.body as typeof DEFAULT_SETTINGS)).toEqual({ readSaved: true, learnChats: 'off' });
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
