import type { Container } from '@azure/cosmos';
import type { Settings } from '../../domain/settings';
import type { SettingsStore, StoredSettings } from '../../ports/settingsStore';
import { getCosmosDatabase } from './cosmosClient';

/** Persisted settings document: one per user, id === userId, partition key /userId. */
interface SettingsDoc {
  id: string;
  userId: string;
  value: Settings;
  revision?: number;
  _etag?: string;
}

/** Cosmos-backed SettingsStore. Container `settings`, partition key /userId. */
export class CosmosSettingsStore implements SettingsStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('settings');
  }

  async get(userId: string): Promise<StoredSettings | null> {
    try {
      const { resource } = await this.container.item(userId, userId).read<SettingsDoc>();
      return resource?.value
        ? { value: resource.value, revision: resource.revision ?? 1, ...(resource._etag ? { versionToken: resource._etag } : {}) }
        : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(userId: string, settings: Settings, expected: StoredSettings | null): Promise<StoredSettings | null> {
    const revision = (expected?.revision ?? 0) + 1;
    const doc: SettingsDoc = { id: userId, userId, value: settings, revision };
    try {
      const response = expected
        ? await this.container.item(userId, userId).replace(doc, expected.versionToken
            ? { accessCondition: { type: 'IfMatch', condition: expected.versionToken } }
            : undefined)
        : await this.container.items.create(doc);
      return {
        value: settings,
        revision,
        ...(response.resource?._etag ? { versionToken: response.resource._etag } : {}),
      };
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      throw error;
    }
  }
}
