import type { Settings } from '../domain/settings';

/** Persistence port for per-user settings (Cosmos `settings` container, one doc per user). */
export interface SettingsStore {
  get(userId: string): Promise<Settings | null>;
  put(userId: string, settings: Settings): Promise<Settings>;
}
