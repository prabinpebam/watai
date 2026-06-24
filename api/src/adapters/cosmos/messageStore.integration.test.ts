import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { CosmosMessageStore } from './messageStore';
import { getCosmosDatabase } from './cosmosClient';
import type { MessageRecord } from '../../ports/messageStore';

// Only runs when pointed at a real Cosmos account (skipped in the normal offline suite).
const RUN = !!process.env.COSMOS_ENDPOINT;

function msg(threadId: string, id: string, over: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id,
    threadId,
    userId: 'owner',
    role: 'user',
    content: id,
    status: 'complete',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
    ...over,
  };
}

describe.runIf(RUN)('CosmosMessageStore (integration)', () => {
  let store: CosmosMessageStore;
  const threadA = `it-mA-${Date.now()}`;
  const threadB = `it-mB-${Date.now()}`;
  const created: { threadId: string; id: string }[] = [];

  beforeAll(() => {
    store = new CosmosMessageStore();
  });

  afterAll(async () => {
    const c = getCosmosDatabase().container('messages');
    for (const { threadId, id } of created) {
      await c.item(id, threadId).delete().catch(() => undefined);
    }
  });

  it('append + get round-trips within the thread partition', async () => {
    created.push({ threadId: threadA, id: 'm1' });
    await store.append(msg(threadA, 'm1', { createdAt: '2026-01-01T00:00:01Z' }));
    const got = await store.get(threadA, 'm1');
    expect(got?.content).toBe('m1');
  });

  it('cross-thread get returns null (partition isolation)', async () => {
    expect(await store.get(threadB, 'm1')).toBeNull();
  });

  it('list returns non-deleted oldest-first; since + limit narrow the window', async () => {
    created.push(
      { threadId: threadA, id: 'm2' },
      { threadId: threadA, id: 'm3' },
      { threadId: threadA, id: 'm4' },
    );
    await store.append(msg(threadA, 'm2', { createdAt: '2026-01-01T00:00:02Z' }));
    await store.append(msg(threadA, 'm3', { createdAt: '2026-01-01T00:00:03Z' }));
    await store.append(msg(threadA, 'm4', { createdAt: '2026-01-01T00:00:04Z', deletedAt: '2026-01-01T00:00:05Z' }));

    const ids = (await store.list(threadA)).map((m) => m.id);
    expect(ids).toEqual(['m1', 'm2', 'm3']);

    const since = (await store.list(threadA, { since: '2026-01-01T00:00:01Z' })).map((m) => m.id);
    expect(since).toEqual(['m2', 'm3']);

    const limited = (await store.list(threadA, { limit: 2 })).map((m) => m.id);
    expect(limited).toEqual(['m1', 'm2']);
  });
});
