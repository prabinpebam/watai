import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, type Settings, type SettingsPatch } from '../domain/settings';
import type { SettingsStore } from '../ports/settingsStore';
import { AppError } from '../domain/errors';

export type SettingsSnapshot = Settings & { revision: number };

/** Application service for per-user settings. New users start from DEFAULT_SETTINGS. */
export class SettingsService {
  constructor(private readonly store: SettingsStore) {}

  async get(userId: string): Promise<Settings> {
    const stored = await this.store.get(userId);
    return stored ? normalizeSettings(stored.value) : DEFAULT_SETTINGS;
  }

  async getSnapshot(userId: string): Promise<SettingsSnapshot> {
    const stored = await this.store.get(userId);
    return stored
      ? { ...normalizeSettings(stored.value), revision: stored.revision }
      : { ...DEFAULT_SETTINGS, revision: 0 };
  }

  async update(userId: string, patch: SettingsPatch, expectedRevision: number): Promise<SettingsSnapshot> {
    const stored = await this.store.get(userId);
    if ((stored?.revision ?? 0) !== expectedRevision) {
      throw new AppError('conflict', 'Settings changed on another device. Reload before saving.');
    }
    const next = mergeSettings(stored ? normalizeSettings(stored.value) : DEFAULT_SETTINGS, patch);
    const saved = await this.store.put(userId, next, stored);
    if (!saved) throw new AppError('conflict', 'Settings changed on another device. Reload before saving.');
    return { ...normalizeSettings(saved.value), revision: saved.revision };
  }
}
