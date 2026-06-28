import type { Container } from '@azure/cosmos';
import type { MemoryModelConfig } from '../../domain/appConfig';
import type { AppConfigStore } from '../../ports/appConfigStore';
import { getCosmosDatabase } from './cosmosClient';

/** Reserved partition for global admin config docs in the per-user `settings` container.
 *  Real user ids are oids/subs, so this sentinel never collides with a user partition. */
const CONFIG_PARTITION = '__app_config__';
const MEMORY_DOC_ID = 'memory-model';

interface AppConfigDoc {
  id: string;
  userId: string;
  value: MemoryModelConfig;
}

/**
 * Global admin configuration backed by the existing `settings` container (partition key
 * `/userId`). Storing one sentinel-partition document avoids provisioning a new container
 * while keeping the value editable at runtime (no redeploy needed to change the memory model).
 */
export class CosmosAppConfigStore implements AppConfigStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('settings');
  }

  async getMemoryConfig(): Promise<MemoryModelConfig | null> {
    try {
      const { resource } = await this.container.item(MEMORY_DOC_ID, CONFIG_PARTITION).read<AppConfigDoc>();
      return resource?.value ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async putMemoryConfig(config: MemoryModelConfig): Promise<MemoryModelConfig> {
    const doc: AppConfigDoc = { id: MEMORY_DOC_ID, userId: CONFIG_PARTITION, value: config };
    await this.container.items.upsert(doc);
    return config;
  }
}
