import type { Container } from '@azure/cosmos';
import type { CredentialRecord, CredentialStore } from '../../ports/credentialStore';
import { getCosmosDatabase } from './cosmosClient';

/** Cosmos-backed credential vault. Container `credentials`, partition key /userId, one doc
 *  (`id: "cred"`) per user. Stores ciphertext only. */
export class CosmosCredentialStore implements CredentialStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('credentials');
  }

  async get(userId: string): Promise<CredentialRecord | null> {
    try {
      const { resource } = await this.container.item('cred', userId).read<CredentialRecord>();
      return resource ?? null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async put(record: CredentialRecord): Promise<CredentialRecord> {
    await this.container.items.upsert(record);
    return record;
  }

  async delete(userId: string): Promise<void> {
    try {
      await this.container.item('cred', userId).delete();
    } catch (err) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
  }
}
