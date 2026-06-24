import type { Settings } from '../../domain/settings';
import type { SettingsStore } from '../../ports/settingsStore';

/** In-memory SettingsStore for unit tests and local dev. */
export class InMemorySettingsStore implements SettingsStore {
  private byUser = new Map<string, Settings>();

  async get(userId: string): Promise<Settings | null> {
    return this.byUser.get(userId) ?? null;
  }

  async put(userId: string, settings: Settings): Promise<Settings> {
    this.byUser.set(userId, structuredClone(settings));
    return settings;
  }
}
