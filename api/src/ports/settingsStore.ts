import type { Settings } from '../domain/settings';

export interface StoredSettings {
  value: Settings;
  revision: number;
  versionToken?: string;
}

/** Persistence port for per-user settings (Cosmos `settings` container, one doc per user). */
export interface SettingsStore {
  get(userId: string): Promise<StoredSettings | null>;
  put(userId: string, settings: Settings, expected: StoredSettings | null): Promise<StoredSettings | null>;
}
