import type { Settings } from '../../domain/settings';
import type { SettingsStore, StoredSettings } from '../../ports/settingsStore';

/** In-memory SettingsStore for unit tests and local dev. */
export class InMemorySettingsStore implements SettingsStore {
  private byUser = new Map<string, StoredSettings>();

  async get(userId: string): Promise<StoredSettings | null> {
    return structuredClone(this.byUser.get(userId) ?? null);
  }

  async put(userId: string, settings: Settings, expected: StoredSettings | null): Promise<StoredSettings | null> {
    const current = this.byUser.get(userId) ?? null;
    if ((current?.revision ?? 0) !== (expected?.revision ?? 0)) return null;
    const stored = { value: structuredClone(settings), revision: (current?.revision ?? 0) + 1 };
    this.byUser.set(userId, stored);
    return structuredClone(stored);
  }
}
