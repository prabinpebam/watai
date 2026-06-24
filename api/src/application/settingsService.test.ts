import { describe, it, expect, beforeEach } from 'vitest';
import { SettingsService } from './settingsService';
import { InMemorySettingsStore } from '../adapters/memory/settingsStore';
import { DEFAULT_SETTINGS } from '../domain/settings';

function makeService() {
  const store = new InMemorySettingsStore();
  return { store, svc: new SettingsService(store) };
}

describe('SettingsService', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it('returns defaults for a new user', async () => {
    expect(await ctx.svc.get('userA')).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial patch, preserving untouched fields and sections', async () => {
    const updated = await ctx.svc.update('userA', { appearance: { theme: 'dark' } });
    expect(updated.appearance.theme).toBe('dark');
    // other appearance fields preserved
    expect(updated.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    // other sections preserved
    expect(updated.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('accumulates successive patches and persists per-user', async () => {
    await ctx.svc.update('userA', { appearance: { theme: 'dark' } });
    await ctx.svc.update('userA', { data: { sync: true, temporaryDefault: false, retention: '30d' } });
    const a = await ctx.svc.get('userA');
    expect(a.appearance.theme).toBe('dark');
    expect(a.data.retention).toBe('30d');
    // a different user is unaffected
    expect(await ctx.svc.get('userB')).toEqual(DEFAULT_SETTINGS);
  });
});
