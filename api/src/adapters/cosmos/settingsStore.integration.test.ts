import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { CosmosSettingsStore } from './settingsStore';
import { getCosmosDatabase } from './cosmosClient';
import { DEFAULT_SETTINGS } from '../../domain/settings';

// Only runs when pointed at a real Cosmos account (skipped in the normal offline suite).
const RUN = !!process.env.COSMOS_ENDPOINT;

describe.runIf(RUN)('CosmosSettingsStore (integration)', () => {
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

  it('put + get round-trips and upsert overwrites', async () => {
    await store.put(userId, DEFAULT_SETTINGS);
    const first = await store.get(userId);
    expect(first?.appearance.theme).toBe('system');

    const updated = { ...DEFAULT_SETTINGS, appearance: { ...DEFAULT_SETTINGS.appearance, theme: 'dark' as const } };
    await store.put(userId, updated);
    const second = await store.get(userId);
    expect(second?.appearance.theme).toBe('dark');
  });
});
