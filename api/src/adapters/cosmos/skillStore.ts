import type { Container } from '@azure/cosmos';
import type { SkillRecord, SkillStore } from '../../ports/skillStore';
import { getCosmosDatabase } from './cosmosClient';

/**
 * Cosmos-backed SkillStore. Container `skills`, partition key `/userId`. Each doc is either a
 * user-uploaded skill or a "default disabled" toggle (see SkillRecord). The container must be
 * created out-of-band (surgically, via `az cosmosdb sql container create`) to avoid an infra
 * redeploy; this adapter only reads/writes it.
 */
export class CosmosSkillStore implements SkillStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('skills');
  }

  async list(userId: string): Promise<SkillRecord[]> {
    const { resources } = await this.container.items
      .query<SkillRecord>({
        query: 'SELECT * FROM c WHERE c.userId = @userId',
        parameters: [{ name: '@userId', value: userId }],
      })
      .fetchAll();
    return resources;
  }

  async get(userId: string, id: string): Promise<SkillRecord | null> {
    try {
      const { resource } = await this.container.item(id, userId).read<SkillRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: SkillRecord): Promise<void> {
    await this.container.items.upsert(record);
  }

  async remove(userId: string, id: string): Promise<void> {
    try {
      await this.container.item(id, userId).delete();
    } catch (err) {
      if ((err as { code?: number }).code !== 404) throw err;
    }
  }
}
