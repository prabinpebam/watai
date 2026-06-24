import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { CosmosInviteStore } from './inviteStore';
import { getCosmosDatabase } from './cosmosClient';

// Only runs when pointed at a real Cosmos account (skipped in the normal offline suite).
const RUN = !!process.env.COSMOS_ENDPOINT;

describe.runIf(RUN)('CosmosInviteStore (integration)', () => {
  let store: CosmosInviteStore;
  const email = `it-invite-${Date.now()}@example.com`;

  beforeAll(() => {
    store = new CosmosInviteStore();
  });

  afterAll(async () => {
    await getCosmosDatabase()
      .container('invites')
      .item(email.toLowerCase(), 'invite')
      .delete()
      .catch(() => undefined);
  });

  it('round-trips an invite case-insensitively, lists it, and removes it', async () => {
    expect(await store.get(email)).toBeNull();

    await store.put({ email, invitedBy: 'admin@example.com', createdAt: '2026-01-01T00:00:00Z' });
    const got = await store.get(email.toUpperCase());
    expect(got?.email).toBe(email.toLowerCase());

    const list = await store.list();
    expect(list.some((i) => i.email === email.toLowerCase())).toBe(true);

    await store.remove(email);
    expect(await store.get(email)).toBeNull();
  });
});
