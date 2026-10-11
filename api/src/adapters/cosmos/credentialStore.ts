import type { Container } from '@azure/cosmos';
import type { CredentialRecord, CredentialStore, StoredCredential } from '../../ports/credentialStore';
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

  async getForUpdate(userId: string): Promise<StoredCredential | null> {
    try {
      const { resource } = await this.container.item('cred', userId).read<CredentialRecord & { _etag?: string }>();
      if (!resource) return null;
      if (!resource._etag || resource.userId !== userId) throw new Error('Credential update requires an owner-bound version token.');
      return { record: resource, versionToken: resource._etag };
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async put(record: CredentialRecord, expected: StoredCredential | null): Promise<CredentialRecord | null> {
    if (expected && (!expected.versionToken || expected.record.userId !== record.userId)) {
      throw new Error('Credential update requires an owner-bound version token.');
    }
    try {
      if (expected) {
        await this.container.item('cred', record.userId).replace(record, {
          accessCondition: { type: 'IfMatch', condition: expected.versionToken },
        });
      } else {
        await this.container.items.create(record);
      }
      return record;
    } catch (error) {
      if ([404, 409, 412].includes((error as { code?: number }).code ?? 0)) return null;
      throw error;
    }
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
