import type { Container } from '@azure/cosmos';
import { normalizeEmail } from '../../domain/invite';
import type { InvitationPrincipal, InviteRecord, InviteStore } from '../../ports/inviteStore';
import { getCosmosDatabase } from './cosmosClient';

// All invites live in a single logical partition so the admin can list them cheaply.
const PK = 'invite';

interface InviteDoc extends InviteRecord {
  id: string;
  pk: string;
  _etag?: string;
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

  async getByPrincipal(principal: InvitationPrincipal): Promise<InviteRecord | null> {
    if (!principal.issuer.trim() || !principal.objectId.trim()) return null;
    const { resources } = await this.container.items.query<InviteDoc>({
      query: 'SELECT TOP 1 * FROM c WHERE c.pk = @pk AND c.principal.issuer = @issuer AND c.principal.objectId = @objectId',
      parameters: [{name:'@pk',value:PK},{name:'@issuer',value:principal.issuer},{name:'@objectId',value:principal.objectId}],
    }, { partitionKey: PK }).fetchAll();
    const record = resources[0];
    return record ? toRecord(record) : null;
  }

  async redeem(email: string, principal: InvitationPrincipal, redeemedAt: string): Promise<InviteRecord | null> {
    if (!principal.issuer.trim() || !principal.objectId.trim()) return null;
    const id = normalizeEmail(email);
    const item = this.container.item(id, PK);
    try {
      const { resource } = await item.read<InviteDoc>();
      if (!resource || resource.id !== id || resource.pk !== PK) return null;
      if (resource.principal) {
        return resource.principal.issuer === principal.issuer && resource.principal.objectId === principal.objectId ? toRecord(resource) : null;
      }
      if (!resource._etag) throw new Error('Invitation redemption requires a version token.');
      const bound: InviteDoc = { ...toRecord(resource), id, pk: PK, principal: { ...principal }, redeemedAt };
      await item.replace(bound, { accessCondition: { type: 'IfMatch', condition: resource._etag } });
      return toRecord(bound);
    } catch (error) {
      if ([404,409,412].includes((error as {code?:number}).code ?? 0)) return null;
      throw error;
    }
  }

  async put(record: InviteRecord): Promise<InviteRecord> {
    const email = normalizeEmail(record.email);
    const doc: InviteDoc = { id: email, pk: PK, email, invitedBy: record.invitedBy, createdAt: record.createdAt };
    try {
      await this.container.items.create(doc);
      return toRecord(doc);
    } catch (error) {
      if ((error as {code?:number}).code !== 409) throw error;
      const existing = await this.get(email);
      if (!existing) throw error;
      return existing;
    }
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
  return {
    email: doc.email, invitedBy: doc.invitedBy, createdAt: doc.createdAt,
    ...(doc.principal ? { principal: { ...doc.principal } } : {}),
    ...(doc.redeemedAt ? { redeemedAt: doc.redeemedAt } : {}),
  };
}
