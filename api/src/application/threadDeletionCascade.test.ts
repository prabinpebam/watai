import { describe, it, expect } from 'vitest';
import { createThreadsController } from '../http/threadsController';
import { ThreadService } from './threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadAssetStore } from '../adapters/memory/threadAssetStore';
import type { MessageRecord } from '../ports/messageStore';

function msg(threadId: string, id: string, over: Partial<MessageRecord> = {}): MessageRecord {
  return {
    id,
    threadId,
    userId: 'userA',
    role: 'user',
    content: 'hi',
    status: 'complete',
    createdAt: '2026-01-01T00:00:10Z',
    deletedAt: null,
    ...over,
  };
}

function setup() {
  const threadStore = new InMemoryThreadStore();
  const messageStore = new InMemoryMessageStore();
  const assets = new InMemoryThreadAssetStore();
  let n = 0;
  let t = 0;
  const clock = { newId: () => `thr_${++n}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  const ctrl = createThreadsController(new ThreadService(threadStore, clock), async (userId, id) => {
    await assets.deleteThreadAssets(userId, id);
    await messageStore.deleteByThread(id);
  });
  return { threadStore, messageStore, assets, ctrl };
}

describe('thread deletion cascade', () => {
  it('removes the thread, its messages, and only its own blob assets', async () => {
    const ctx = setup();
    const created = await ctx.ctrl.create({ claims: { sub: 'userA' }, body: { title: 'Trip' } });
    const id = (created.body as { id: string }).id;

    await ctx.messageStore.append(msg(id, 'm1'));
    await ctx.messageStore.append(msg(id, 'm2', { role: 'assistant', content: 'hello' }));
    ctx.assets.put(`userA/${id}/att1.png`);
    ctx.assets.put(`userA/${id}/art1.pdf`);
    // Decoys that must survive: a different thread, and a different user with the same thread-id text.
    ctx.assets.put('userA/other-thread/keep.png');
    ctx.assets.put(`userB/${id}/keep.png`);

    const res = await ctx.ctrl.remove({ claims: { sub: 'userA' }, params: { id } });
    expect(res.status).toBe(204);

    expect(await ctx.messageStore.list(id)).toEqual([]);
    expect([...ctx.assets.blobs.keys()].sort()).toEqual(
      [`userB/${id}/keep.png`, 'userA/other-thread/keep.png'].sort(),
    );
  });

  it('hard-deletes only the target thread’s messages (deleteByThread is partition-scoped)', async () => {
    const ctx = setup();
    await ctx.messageStore.append(msg('t1', 'a'));
    await ctx.messageStore.append(msg('t1', 'b'));
    await ctx.messageStore.append(msg('t2', 'c'));

    await ctx.messageStore.deleteByThread('t1');

    expect(await ctx.messageStore.list('t1')).toEqual([]);
    expect((await ctx.messageStore.list('t2')).map((m) => m.id)).toEqual(['c']);
  });

  it('never widens the prefix when a segment is empty', async () => {
    const ctx = setup();
    ctx.assets.put('userA/t1/a.png');
    await ctx.assets.deleteThreadAssets('userA', '');
    await ctx.assets.deleteThreadAssets('', 't1');
    expect([...ctx.assets.blobs.keys()]).toEqual(['userA/t1/a.png']);
  });
});
