import type { MemoryModelConfig } from '../domain/appConfig';

/** Global (non-user-scoped) admin configuration. A single memory-model document today. */
export interface AppConfigStore {
  getMemoryConfig(): Promise<MemoryModelConfig | null>;
  putMemoryConfig(config: MemoryModelConfig): Promise<MemoryModelConfig>;
}
