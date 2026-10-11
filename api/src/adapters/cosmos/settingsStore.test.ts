import type { Container } from '@azure/cosmos';
import { describe, expect, it, vi } from 'vitest';
import { DEFAULT_SETTINGS } from '../../domain/settings';
import { CosmosSettingsStore } from './settingsStore';

function fakeContainer() {
  let document: Record<string, unknown> | null = null;
  let version = 0;
  const container = {
    item: () => ({
      read: async () => {
        if (!document) throw { code: 404 };
        return { resource: { ...document, _etag: String(version) } };
      },
      replace: async (next: Record<string, unknown>, options?: { accessCondition?: { condition: string } }) => {
        if (!document) throw { code: 404 };
        if (options?.accessCondition?.condition !== String(version)) throw { code: 412 };
        document = { ...next };
        version += 1;
        return { resource: { ...document, _etag: String(version) } };
      },
    }),
    items: {
      create: async (next: Record<string, unknown>) => {
        if (document) throw { code: 409 };
        document = { ...next };
        version = 1;
        return { resource: { ...document, _etag: String(version) } };
      },
    },
  } as unknown as Container;
  return { container, value: () => document };
}

describe('CosmosSettingsStore', () => {
  it.each(['owner', 'id'] as const)('does not return another settings identity: %s', async change => {
    const resource = { id: change === 'id' ? 'other' : 'owner', userId: change === 'owner' ? 'other' : 'owner', value: DEFAULT_SETTINGS };
    const store = new CosmosSettingsStore({ item: () => ({ read: async () => ({ resource }) }) } as never);
    await expect(store.get('owner')).rejects.toThrow('Settings owner binding failed.');
  });

  it.each([undefined, '', ' '])('never replaces consent without a version token: %j', async versionToken => {
    const replace = vi.fn();
    const store = new CosmosSettingsStore({ item: () => ({ replace }) } as never);
    await expect(store.put('owner', DEFAULT_SETTINGS, { value: DEFAULT_SETTINGS, revision: 1, versionToken })).rejects.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });

  it('uses revision and ETag compare-and-set so stale writes cannot replace newer privacy settings', async () => {
    const fake = fakeContainer();
    const store = new CosmosSettingsStore(fake.container);
    const first = await store.put('user-a', DEFAULT_SETTINGS, null);
    expect(first?.revision).toBe(1);

    const optedOut = {
      ...DEFAULT_SETTINGS,
      personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: false },
    };
    const second = await store.put('user-a', optedOut, first);
    expect(second?.revision).toBe(2);

    await expect(store.put('user-a', DEFAULT_SETTINGS, first)).resolves.toBeNull();
    await expect(store.get('user-a')).resolves.toMatchObject({
      revision: 2,
      value: { personalization: { memoryEnabled: false } },
    });
    expect(fake.value()).toMatchObject({ revision: 2 });
  });
});
