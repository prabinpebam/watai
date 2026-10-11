import { describe, it, expect, beforeEach, vi } from 'vitest';
import { ThreadService } from './threadService';
import { MessageService } from './messageService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { AppError } from '../domain/errors';
import { libraryItemIdFor } from '../domain/library';
import { libraryFixture } from '../test/libraryFixtures';
import type { LibraryStore } from '../ports/libraryStore';

function makeCtx() {
  const threadStore = new InMemoryThreadStore();
  const messageStore = new InMemoryMessageStore();
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `id_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const threads = new ThreadService(threadStore, clock);
  const messages = new MessageService(threadStore, messageStore, clock);
  return { threadStore, messageStore, threads, messages };
}

function makeCtxWithScheduler() {
  const threadStore = new InMemoryThreadStore();
  const messageStore = new InMemoryMessageStore();
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `id_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const scheduled: string[] = [];
  const threads = new ThreadService(threadStore, clock);
  const messages = new MessageService(threadStore, messageStore, clock, {
    enqueueAfterMessage: async (record) => void scheduled.push(`${record.role}:${record.id}`),
  });
  return { threadStore, messageStore, threads, messages, scheduled };
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('MessageService.append', () => {
  let ctx: ReturnType<typeof makeCtx>;
  beforeEach(() => (ctx = makeCtx()));

  it.each(['missing', 'owner', 'thread', 'id'] as const)('does not acknowledge an unconfirmed creation winner or enqueue followups: %s', async change => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const winner = { id: change === 'id' ? 'other' : 'same', userId: change === 'owner' ? 'userB' : 'userA',
      threadId: change === 'thread' ? 'other-thread' : thread.id, role: 'user' as const, content: 'Existing',
      status: 'complete' as const, createdAt: '2026-01-01T00:00:00Z', deletedAt: null };
    vi.spyOn(ctx.messageStore, 'get').mockResolvedValueOnce(null).mockResolvedValue(change === 'missing' ? null : winner);
    const create = vi.spyOn(ctx.messageStore, 'createIfAbsent').mockResolvedValue(null);
    const upsert = vi.spyOn(ctx.messageStore, 'append');
    const scheduled = vi.fn(async () => {});
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'same', now: () => '2026-01-01T00:00:01Z' }, { enqueueAfterMessage: scheduled });
    await expect(service.append('userA', thread.id, { role: 'user', content: 'New' })).rejects.toMatchObject({ code: 'conflict' });
    expect(create).toHaveBeenCalledOnce();
    expect(upsert).not.toHaveBeenCalled();
    expect(scheduled).not.toHaveBeenCalled();
    expect((await ctx.threads.get('userA', thread.id)).messageCount).toBe(0);
  });

  it('does not recreate a retained message tombstone through create-only storage', async () => {
    const record = { id: 'retained', userId: 'userA', threadId: 'thread', role: 'user' as const,
      content: '', status: 'complete' as const, createdAt: '2026-01-01T00:00:00Z', deletedAt: '2026-01-02T00:00:00Z' };
    await ctx.messageStore.append(record);
    expect(await ctx.messageStore.createIfAbsent({ ...record, content: 'Recreated', deletedAt: null })).toBeNull();
    expect(await ctx.messageStore.get('userA', 'thread', 'retained')).toEqual(record);
  });

  it('accepts concurrent same-ID submissions once without replacing the winning chronology', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    let observedMissing = 0;
    let release!: () => void;
    const bothMissing = new Promise<void>(resolve => { release = resolve; });
    const get = ctx.messageStore.get.bind(ctx.messageStore);
    vi.spyOn(ctx.messageStore, 'get').mockImplementation(async (...args) => {
      if (observedMissing < 2) {
        observedMissing += 1;
        if (observedMissing === 2) release();
        await bothMissing;
        return null;
      }
      return get(...args);
    });
    const scheduled = vi.fn(async () => {});
    let tick = 0;
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'm', now: () => `2026-01-01T00:00:0${++tick}Z` }, { enqueueAfterMessage: scheduled });
    const results = await Promise.all([
      service.append('userA', thread.id, { id: 'same', role: 'user', content: 'First', orderAt: '2020-01-01T00:00:00Z' }),
      service.append('userA', thread.id, { id: 'same', role: 'user', content: 'Second', orderAt: '2021-01-01T00:00:00Z' }),
    ]);
    expect(results[0]).toEqual(results[1]);
    expect(await get('userA', thread.id, 'same')).toEqual(results[0]);
    expect((await ctx.threads.get('userA', thread.id)).messageCount).toBe(1);
    expect(scheduled).toHaveBeenCalledOnce();
  });

  it('stops message persistence when Library preparation observes a deleted thread', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const itemId = libraryItemIdFor('userA', 'chat_attachment', 'att-new');
    const libraryStore = { get: async () => null, createIfAbsent: async (item: ReturnType<typeof libraryFixture>) => {
      await ctx.threads.softDelete('userA', thread.id);
      return item;
    } } as unknown as LibraryStore;
    const scheduled = vi.fn(async () => {});
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'm', now: () => '2026-01-01T00:00:01Z' }, { enqueueAfterMessage: scheduled }, libraryStore);
    await expect(service.append('userA', thread.id, { role: 'user', content: 'See attached',
      attachments: [{ id: 'att-new', kind: 'image', blobPath: `userA/library/${itemId}.png`, mime: 'image/png', bytes: 25 }] }))
      .rejects.toMatchObject({ code: 'not_found' });
    expect(await ctx.messageStore.get('userA', thread.id, 'm')).toBeNull();
    expect(scheduled).not.toHaveBeenCalled();
    expect((await ctx.threadStore.get('userA', thread.id))?.deletedAt).toBeTruthy();
  });

  it.each(['missing', 'no-etag', 'blank-etag', 'foreign'] as const)('rejects unusable final thread versions without writes or learning: %s', async state => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const version = state === 'missing' ? null : { record: { ...thread, userId: state === 'foreign' ? 'userB' : 'userA' },
      etag: state === 'no-etag' ? undefined : state === 'blank-etag' ? ' ' : 'version' };
    vi.spyOn(ctx.threadStore, 'getForUpdate').mockResolvedValue(version as never);
    const conditional = vi.spyOn(ctx.threadStore, 'putIfMatch');
    const scheduled = vi.fn(async () => {});
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'm', now: () => '2026-01-01T00:00:01Z' }, { enqueueAfterMessage: scheduled });
    await expect(service.append('userA', thread.id, { role: 'user', content: 'Hello' }))
      .rejects.toMatchObject({ code: state === 'missing' || state === 'foreign' ? 'not_found' : 'conflict' });
    expect(conditional).not.toHaveBeenCalled();
    expect(scheduled).not.toHaveBeenCalled();
    expect(await ctx.threadStore.get('userA', thread.id)).toEqual(thread);
  });

  it.each(['updated', 'deleted', 'conflict', 'retry'] as const)('fences thread metadata after message persistence: %s', async state => {
    const thread = await ctx.threads.create('userA', { title: 'Original', temporary: false });
    const putThread = ctx.threadStore.put.bind(ctx.threadStore);
    const append = ctx.messageStore.createIfAbsent.bind(ctx.messageStore);
    const changed = { ...thread, title: 'Newer title', pinned: true, messageCount: 4,
      files: [{ fileId: 'new-file', name: 'new.pdf', bytes: 1, status: 'ready' as const, createdAt: '2026-01-01T00:00:05Z' }],
      updatedAt: '2026-01-01T00:00:05Z', deletedAt: state === 'deleted' ? '2026-01-01T00:00:05Z' : null };
    vi.spyOn(ctx.messageStore, 'createIfAbsent').mockImplementation(async record => {
      await putThread(changed);
      return append(record);
    });
    const unconditional = vi.spyOn(ctx.threadStore, 'put');
    const conditional = vi.spyOn(ctx.threadStore, 'putIfMatch');
    if (state === 'conflict') conditional.mockResolvedValue(null);
    if (state === 'retry') conditional.mockImplementationOnce(async () => {
      await putThread({ ...changed, title: 'Latest title', messageCount: 5 });
      return null;
    });
    const scheduled = vi.fn(async () => {});
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'm', now: () => '2026-01-01T00:00:01Z' }, { enqueueAfterMessage: scheduled });
    const work = service.append('userA', thread.id, { role: 'user', content: 'Hello', orderAt: '2020-01-01T00:00:00Z' });
    if (state === 'deleted' || state === 'conflict') {
      await expect(work).rejects.toMatchObject({ code: state === 'deleted' ? 'not_found' : 'conflict' });
      expect(await ctx.threadStore.get('userA', thread.id)).toEqual(changed);
      expect(scheduled).not.toHaveBeenCalled();
      expect(conditional).toHaveBeenCalledTimes(state === 'deleted' ? 0 : 3);
    } else {
      expect(await work).toMatchObject({ orderAt: '2020-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:01Z' });
      expect(await ctx.threadStore.get('userA', thread.id)).toMatchObject({
        title: state === 'retry' ? 'Latest title' : changed.title, pinned: true, files: changed.files,
        messageCount: state === 'retry' ? 6 : 5, updatedAt: changed.updatedAt, lastMessagePreview: 'Hello',
      });
      expect(scheduled).toHaveBeenCalledOnce();
    }
    expect(unconditional).not.toHaveBeenCalled();
    expect(await ctx.messageStore.get('userA', thread.id, 'm')).not.toBeNull();
  });

  it.each(['new', 'active', 'purged', 'race', 'foreign', 'wrong-id'] as const)('preserves Library publication identity and tombstones during append: %s', async state => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const itemId = libraryItemIdFor('userA', 'chat_attachment', 'att-new');
    const retained = libraryFixture({ id: state === 'wrong-id' ? 'other' : itemId,
      userId: state === 'foreign' ? 'userB' : 'userA', kind: 'image', origin: 'chat_upload',
      state: state === 'purged' || state === 'race' ? 'purged' : 'active',
      blobPath: `userA/library/${itemId}.png` });
    let current = state === 'new' ? null : retained;
    const put = vi.fn(async (item: typeof retained) => { current = item; return item; });
    const createIfAbsent = vi.fn(async (item: typeof retained) => {
      if (current) return null;
      current = item;
      return item;
    });
    const libraryStore = { get: async () => state === 'race' ? null : current, put, createIfAbsent } as unknown as LibraryStore;
    const scheduled = vi.fn(async () => {});
    const service = new MessageService(ctx.threadStore, ctx.messageStore,
      { newId: () => 'm', now: () => '2026-01-01T00:00:01Z' }, { enqueueAfterMessage: scheduled }, libraryStore);
    const work = service.append('userA', thread.id, { role: 'user', content: 'See attached', orderAt: '2020-01-01T00:00:00Z',
      attachments: [{ id: 'att-new', kind: 'image', blobPath: `userA/library/${itemId}.png`, mime: 'image/png', bytes: 25 }] });
    if (state === 'new' || state === 'active') {
      expect(await work).toMatchObject({ orderAt: '2020-01-01T00:00:00Z', createdAt: '2026-01-01T00:00:01Z' });
      expect(current).toMatchObject({ id: itemId, userId: 'userA', state: 'active' });
    } else {
      await expect(work).rejects.toMatchObject({ code: 'conflict' });
      expect(current).toEqual(retained);
      expect(await ctx.messageStore.get('userA', thread.id, 'm')).toBeNull();
      expect((await ctx.threads.get('userA', thread.id)).messageCount).toBe(0);
      expect(scheduled).not.toHaveBeenCalled();
    }
    expect(put).not.toHaveBeenCalled();
  });

  it('appends and bumps the thread (count, preview, updatedAt)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const msg = await ctx.messages.append('userA', thread.id, { role: 'user', content: 'Hello there' });

    expect(msg).toMatchObject({ threadId: thread.id, userId: 'userA', role: 'user', content: 'Hello there', status: 'complete', deletedAt: null });

    const after = await ctx.threads.get('userA', thread.id);
    expect(after.messageCount).toBe(1);
    expect(after.lastMessagePreview).toBe('Hello there');
    expect(after.updatedAt > thread.updatedAt).toBe(true);
  });

  it('preserves the client orderAt (chronology) while createdAt stays server-assigned (cursor)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    // An assistant message finalized late but logically created earlier.
    const msg = await ctx.messages.append('userA', thread.id, {
      role: 'assistant',
      content: 'answer',
      orderAt: '2020-01-01T00:00:00.000Z',
    });
    expect(msg.orderAt).toBe('2020-01-01T00:00:00.000Z');
    // createdAt is the server append time (used as the delta-sync cursor), NOT the client orderAt.
    expect(msg.createdAt).not.toBe('2020-01-01T00:00:00.000Z');
    expect(msg.createdAt).toMatch(/^2026-/);
  });

  it('defaults orderAt to the server time when the client omits it', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const msg = await ctx.messages.append('userA', thread.id, { role: 'user', content: 'hi' });
    expect(msg.orderAt).toBe(msg.createdAt);
  });

  it('is idempotent on a client-supplied id (no duplicate, no double count)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const a = await ctx.messages.append('userA', thread.id, { id: 'm1', role: 'user', content: 'x' });
    const b = await ctx.messages.append('userA', thread.id, { id: 'm1', role: 'user', content: 'x' });
    expect(b.id).toBe(a.id);
    expect((await ctx.threads.get('userA', thread.id)).messageCount).toBe(1);
    expect((await ctx.messages.list('userA', thread.id)).length).toBe(1);
  });

  it('fails closed when appending to another user’s thread (IDOR)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    expect(await code(() => ctx.messages.append('userB', thread.id, { role: 'user', content: 'sneak' }))).toBe('not_found');
    expect((await ctx.threads.get('userA', thread.id)).messageCount).toBe(0);
  });

  it('persists image refs and previews image-only messages as "Image"', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const img = {
      id: 'img_1',
      blobPath: 'userA/' + thread.id + '/img_1.png',
      prompt: 'a fox',
      size: '1024x1536',
      outputFormat: 'png' as const,
      createdAt: '2026-01-01T00:00:00Z',
    };
    const msg = await ctx.messages.append('userA', thread.id, { role: 'assistant', content: '', images: [img] });
    expect(msg.images).toEqual([{ ...img, libraryItemId: libraryItemIdFor('userA', 'chat_generated_image', 'img_1') }]);

    const stored = await ctx.messageStore.get('userA', thread.id, msg.id);
    expect(stored?.images).toEqual([{ ...img, libraryItemId: libraryItemIdFor('userA', 'chat_generated_image', 'img_1') }]);
    expect((await ctx.threads.get('userA', thread.id)).lastMessagePreview).toBe('Image');
  });

  it('assigns deterministic Library ids to durable attachments', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const libraryItemId = libraryItemIdFor('userA', 'chat_attachment', 'att-1');
    const msg = await ctx.messages.append('userA', thread.id, {
      role: 'user',
      content: '',
      attachments: [{ id: 'att-1', kind: 'file', blobPath: `userA/library/${libraryItemId}.pdf`, mime: 'application/pdf', bytes: 12 }],
    });
    expect(msg.attachments?.[0].libraryItemId).toBe(libraryItemId);
  });

  it('rejects a foreign raw attachment path before persistence', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });

    await expect(ctx.messages.append('userA', thread.id, {
      role: 'user',
      content: 'Read this',
      attachments: [{ id: 'att-foreign', kind: 'file', blobPath: 'userB/library/foreign.pdf', mime: 'application/pdf', bytes: 12 }],
    })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.messages.list('userA', thread.id)).resolves.toEqual([]);
  });

  it('rejects a foreign generated-image path before persistence', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    await expect(ctx.messages.append('userA', thread.id, {
      role: 'assistant',
      content: '',
      images: [{ id: 'img-foreign', blobPath: 'userB/images/img.png', prompt: 'x', size: '1024x1024', outputFormat: 'png', createdAt: '2026' }],
    })).rejects.toMatchObject({ code: 'validation' });
    await expect(ctx.messages.list('userA', thread.id)).resolves.toEqual([]);
  });

  it('resolves an active Library attachment server-side without copying its blob', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const item = libraryFixture({ id: 'lib-1', userId: 'userA', kind: 'pdf', origin: 'library_upload', state: 'active', blobPath: 'userA/library/lib-1.pdf', name: 'Source.pdf', mime: 'application/pdf', bytes: 44 });
    const libraryStore = { get: async (userId: string, id: string) => userId === 'userA' && id === item.id ? item : null } as unknown as LibraryStore;
    const service = new MessageService(ctx.threadStore, ctx.messageStore, { newId: () => 'm', now: () => '2026-01-01T00:00:00Z' }, undefined, libraryStore);
    const message = await service.append('userA', thread.id, {
      role: 'user', content: 'Read this',
      attachments: [{ id: 'selection-1', libraryItemId: item.id, kind: 'file', mime: item.mime, bytes: item.bytes, reuseMode: 'attach' }],
    });
    expect(message.attachments?.[0]).toMatchObject({ libraryItemId: item.id, blobPath: item.blobPath, name: 'Source.pdf', reuseMode: 'attach' });
    expect(libraryStore.get).toBeDefined();
  });

  it('rejects reuse of a trashed Library item', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const item = libraryFixture({ id: 'lib-trash', userId: 'userA', kind: 'pdf', origin: 'library_upload', state: 'trashed' });
    const libraryStore = { get: async () => item } as unknown as LibraryStore;
    const service = new MessageService(ctx.threadStore, ctx.messageStore, { newId: () => 'm', now: () => '2026-01-01T00:00:00Z' }, undefined, libraryStore);
    await expect(service.append('userA', thread.id, {
      role: 'user', content: 'Read this',
      attachments: [{ id: 'selection-1', libraryItemId: item.id, kind: 'file', mime: item.mime, bytes: item.bytes }],
    })).rejects.toMatchObject({ code: 'conflict' });
  });

  it('indexes a new non-temporary chat upload on its existing Library blob path', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const itemId = libraryItemIdFor('userA', 'chat_attachment', 'att-new');
    const records = new Map<string, ReturnType<typeof libraryFixture>>();
    const libraryStore = {
      get: async (_userId: string, id: string) => records.get(id) ?? null,
      createIfAbsent: async (item: ReturnType<typeof libraryFixture>) => {
        if (records.has(item.id)) return null;
        records.set(item.id, item);
        return item;
      },
    } as unknown as LibraryStore;
    const service = new MessageService(ctx.threadStore, ctx.messageStore, { newId: () => 'm', now: () => '2026-01-01T00:00:00Z' }, undefined, libraryStore);
    await service.append('userA', thread.id, {
      role: 'user', content: 'See attached',
      attachments: [{ id: 'att-new', kind: 'image', blobPath: `userA/library/${itemId}.png`, mime: 'image/png', bytes: 25, name: 'photo.png' }],
    });
    expect(records.get(itemId)).toMatchObject({ state: 'active', origin: 'chat_upload', blobPath: `userA/library/${itemId}.png`, source: { threadId: thread.id } });
  });

  it('persists memoryRefs for assistant messages', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const msg = await ctx.messages.append('userA', thread.id, {
      role: 'assistant',
      content: 'Deploy to rg-watai-dev.',
      memoryRefs: [
        {
          memoryId: 'mem_1',
          kind: 'project_context',
          text: 'Watai deploy target is rg-watai-dev.',
          score: 0.91,
        },
      ],
    });
    expect(msg.memoryRefs).toEqual([
      { memoryId: 'mem_1', kind: 'project_context', text: 'Watai deploy target is rg-watai-dev.', score: 0.91 },
    ]);
  });

  it('schedules memory extraction after newly appended messages', async () => {
    const local = makeCtxWithScheduler();
    const thread = await local.threads.create('userA', { title: 'A', temporary: false });
    await local.messages.append('userA', thread.id, { id: 'u1', role: 'user', content: 'Remember that I prefer concise plans.' });
    await local.messages.append('userA', thread.id, { id: 'a1', role: 'assistant', content: 'Saved.' });
    await Promise.resolve();
    expect(local.scheduled).toEqual(['user:u1', 'assistant:a1']);
  });
});

describe('MessageService.list', () => {
  let ctx: ReturnType<typeof makeCtx>;
  beforeEach(() => (ctx = makeCtx()));

  it('returns messages in chronological order, supports since + limit', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const m1 = await ctx.messages.append('userA', thread.id, { role: 'user', content: '1' });
    const m2 = await ctx.messages.append('userA', thread.id, { role: 'assistant', content: '2' });
    const m3 = await ctx.messages.append('userA', thread.id, { role: 'user', content: '3' });

    expect((await ctx.messages.list('userA', thread.id)).map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    expect((await ctx.messages.list('userA', thread.id, { since: m1.createdAt })).map((m) => m.id)).toEqual([m1.id, m2.id, m3.id]);
    expect((await ctx.messages.list('userA', thread.id, { limit: 2 })).map((m) => m.id)).toEqual([m1.id, m2.id]);
  });

  it('fails closed for another user (IDOR)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    await ctx.messages.append('userA', thread.id, { role: 'user', content: '1' });
    expect(await code(() => ctx.messages.list('userB', thread.id))).toBe('not_found');
  });

  it('rejects malformed replay cursors with an explicit full-resync instruction', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    await expect(ctx.messages.list('userA', thread.id, { since: 'bad-cursor' })).rejects.toMatchObject({
      code: 'validation', details: { resyncRequired: true },
    });
  });
});
