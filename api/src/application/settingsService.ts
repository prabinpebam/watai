import { DEFAULT_SETTINGS, mergeSettings, normalizeSettings, type Settings, type SettingsPatch } from '../domain/settings';
import type { SettingsStore } from '../ports/settingsStore';
import { AppError } from '../domain/errors';

export type SettingsSnapshot = Settings & { revision: number };

function initialAccountSettings(): Settings {
  return {
    ...structuredClone(DEFAULT_SETTINGS),
    personalization: {
      ...DEFAULT_SETTINGS.personalization,
      memoryEnabled: false,
      memory: { enabled: true, paused: false, referenceSaved: true, referenceHistory: false, autoExtract: false, learnChats: 'off' },
    },
  };
}

/** Application service for per-user settings and authoritative account snapshots. */
export class SettingsService {
  constructor(private readonly store: SettingsStore) {}

  async get(userId: string): Promise<Settings> {
    const stored = await this.store.get(userId);
    return stored ? normalizeSettings(stored.value) : DEFAULT_SETTINGS;
  }

  async getForMemory(userId: string): Promise<Settings> {
    const stored = await this.store.get(userId);
    const settings = stored ? normalizeSettings(stored.value) : DEFAULT_SETTINGS;
    const memory = stored?.value.personalization.memory;
    const enabled = stored?.value.personalization.memoryEnabled === true && memory?.enabled === true;
    return {
      ...settings,
      personalization: {
        ...settings.personalization,
        memoryEnabled: enabled,
        memory: {
          enabled,
          paused: memory?.paused !== false,
          referenceSaved: enabled && memory?.referenceSaved === true,
          referenceHistory: enabled && memory?.referenceHistory === true,
          autoExtract: enabled && memory?.autoExtract === true,
          learnChats: memory?.learnChats === 'automatic' || memory?.learnChats === 'review' || memory?.learnChats === 'off'
            ? memory.learnChats
            : memory?.learnChats === undefined && memory?.autoExtract === true && memory?.referenceHistory === true ? 'automatic' : 'off',
        },
      },
    };
  }

  async getSnapshot(userId: string): Promise<SettingsSnapshot> {
    const stored = await this.store.get(userId);
    return stored
      ? { ...normalizeSettings(stored.value), revision: stored.revision }
      : { ...initialAccountSettings(), revision: 0 };
  }

  async update(userId: string, patch: SettingsPatch, expectedRevision: number): Promise<SettingsSnapshot> {
    const stored = await this.store.get(userId);
    if ((stored?.revision ?? 0) !== expectedRevision) {
      throw new AppError('conflict', 'Settings changed on another device. Reload before saving.');
    }
    const next = mergeSettings(stored ? normalizeSettings(stored.value) : initialAccountSettings(), patch);
    const saved = await this.store.put(userId, next, stored);
    if (!saved) throw new AppError('conflict', 'Settings changed on another device. Reload before saving.');
    return { ...normalizeSettings(saved.value), revision: saved.revision };
  }
}
