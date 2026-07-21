import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, type Settings, type SettingsPatch } from '../domain/settings';
import type { SettingsStore } from '../ports/settingsStore';

/** Application service for per-user settings. New users start from DEFAULT_SETTINGS. */
export class SettingsService {
  constructor(private readonly store: SettingsStore) {}

  async get(userId: string): Promise<Settings> {
    const stored = await this.store.get(userId);
    return stored ? normalizeSettings(stored) : DEFAULT_SETTINGS;
  }

  async update(userId: string, patch: SettingsPatch): Promise<Settings> {
    const current = await this.get(userId);
    const next = mergeSettings(current, patch);
    return this.store.put(userId, next);
  }
}
