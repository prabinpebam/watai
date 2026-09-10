import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { CosmosSettingsStore } from './settingsStore';
import { getCosmosDatabase } from './cosmosClient';
import { DEFAULT_SETTINGS } from '../../domain/settings';

describe('CosmosSettingsStore (integration)', () => {
  let store: CosmosSettingsStore;
  const userId = `it-set-${Date.now()}`;

  beforeAll(() => {
    store = new CosmosSettingsStore();
  });

  afterAll(async () => {
    await getCosmosDatabase().container('settings').item(userId, userId).delete().catch(() => undefined);
  });

  it('get returns null before anything is written', async () => {
    expect(await store.get(userId)).toBeNull();
  });

  it('put + get round-trips with compare-and-set revisions', async () => {
    await store.put(userId, DEFAULT_SETTINGS, null);
    const first = await store.get(userId);
    expect(first?.value.appearance.theme).toBe('system');
    expect(first?.revision).toBe(1);

    const updated = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' as const } };
    await store.put(userId, updated, first);
    const second = await store.get(userId);
    expect(second?.value.appearance.theme).toBe('dark');
    expect(second?.revision).toBe(2);
  });
});
