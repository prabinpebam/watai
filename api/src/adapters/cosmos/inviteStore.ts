import type { Container } from '@azure/cosmos';
import { normalizeEmail } from '../../domain/invite';
import type { InviteRecord, InviteStore } from '../../ports/inviteStore';
import { getCosmosDatabase } from './cosmosClient';

// All invites live in a single logical partition so the admin can list them cheaply.
const PK = 'invite';

interface InviteDoc {
  id: string;
  pk: string;
  email: string;
  invitedBy: string;
  createdAt: string;
}

/** Cosmos-backed InviteStore. Container `invites`, partition key `/pk` (constant). */
export class CosmosInviteStore implements InviteStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('invites');
  }

  async get(email: string): Promise<InviteRecord | null> {
    try {
      const { resource } = await this.container.item(normalizeEmail(email), PK).read<InviteDoc>();
      return resource ? toRecord(resource) : null;
    } catch (err) {
      if ((err as { code?: number }).code === 404) return null;
      throw err;
    }
  }

  async list(): Promise<InviteRecord[]> {
    const { resources } = await this.container.items
      .query<InviteDoc>(
        { query: 'SELECT * FROM c WHERE c.pk = @pk', parameters: [{ name: '@pk', value: PK }] },
        { partitionKey: PK },
      )
      .fetchAll();
    return resources.map(toRecord);
  }

  async put(record: InviteRecord): Promise<InviteRecord> {
    const email = normalizeEmail(record.email);
    const doc: InviteDoc = { id: email, pk: PK, email, invitedBy: record.invitedBy, createdAt: record.createdAt };
    await this.container.items.upsert(doc);
    return toRecord(doc);
  }

  async remove(email: string): Promise<void> {
    try {
      await this.container.item(normalizeEmail(email), PK).delete();
    } catch (err) {
      if ((err as { code?: number }).code === 404) return;
      throw err;
    }
  }
}

function toRecord(doc: InviteDoc): InviteRecord {
  return { email: doc.email, invitedBy: doc.invitedBy, createdAt: doc.createdAt };
}
