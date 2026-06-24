import type { Container } from '@azure/cosmos';
import type { Settings } from '../../domain/settings';
import type { SettingsStore } from '../../ports/settingsStore';
import { getCosmosDatabase } from './cosmosClient';

/** Persisted settings document: one per user, id === userId, partition key /userId. */
interface SettingsDoc {
  id: string;
  userId: string;
  value: Settings;
}

/** Cosmos-backed SettingsStore. Container `settings`, partition key /userId. */
export class CosmosSettingsStore implements SettingsStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('settings');
  }

  async get(userId: string): Promise<Settings | null> {
    try {
      const { resource } = await this.container.item(userId, userId).read<SettingsDoc>();
      return resource?.value ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(userId: string, settings: Settings): Promise<Settings> {
    const doc: SettingsDoc = { id: userId, userId, value: settings };
    await this.container.items.upsert(doc);
    return settings;
  }
}
