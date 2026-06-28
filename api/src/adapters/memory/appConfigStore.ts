import type { MemoryModelConfig } from '../../domain/appConfig';
import type { AppConfigStore } from '../../ports/appConfigStore';

/** In-memory AppConfigStore for unit tests. */
export class InMemoryAppConfigStore implements AppConfigStore {
  private memory: MemoryModelConfig | null = null;

  async getMemoryConfig(): Promise<MemoryModelConfig | null> {
    return this.memory ? { ...this.memory } : null;
  }

  async putMemoryConfig(config: MemoryModelConfig): Promise<MemoryModelConfig> {
    this.memory = { ...config };
    return config;
  }
}
