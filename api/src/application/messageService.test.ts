import { describe, it, expect, beforeEach } from 'vitest';
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

    const stored = await ctx.messageStore.get(thread.id, msg.id);
    expect(stored?.images).toEqual([{ ...img, libraryItemId: libraryItemIdFor('userA', 'chat_generated_image', 'img_1') }]);
    expect((await ctx.threads.get('userA', thread.id)).lastMessagePreview).toBe('Image');
  });

  it('assigns deterministic Library ids to durable attachments', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const msg = await ctx.messages.append('userA', thread.id, {
      role: 'user',
      content: '',
      attachments: [{ id: 'att-1', kind: 'file', blobPath: 'userA/t/att-1.pdf', mime: 'application/pdf', bytes: 12 }],
    });
    expect(msg.attachments?.[0].libraryItemId).toBe(libraryItemIdFor('userA', 'chat_attachment', 'att-1'));
  });

  it('resolves an active Library attachment server-side without copying its blob', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const item = libraryFixture({ id: 'lib-1', kind: 'pdf', origin: 'library_upload', state: 'active', blobPath: 'userA/library/lib-1.pdf', name: 'Source.pdf', mime: 'application/pdf', bytes: 44 });
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
    const item = libraryFixture({ id: 'lib-trash', kind: 'pdf', origin: 'library_upload', state: 'trashed' });
    const libraryStore = { get: async () => item } as unknown as LibraryStore;
    const service = new MessageService(ctx.threadStore, ctx.messageStore, { newId: () => 'm', now: () => '2026-01-01T00:00:00Z' }, undefined, libraryStore);
    await expect(service.append('userA', thread.id, {
      role: 'user', content: 'Read this',
      attachments: [{ id: 'selection-1', libraryItemId: item.id, kind: 'file', mime: item.mime, bytes: item.bytes }],
    })).rejects.toMatchObject({ code: 'conflict' });
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
    expect((await ctx.messages.list('userA', thread.id, { since: m1.createdAt })).map((m) => m.id)).toEqual([m2.id, m3.id]);
    expect((await ctx.messages.list('userA', thread.id, { limit: 2 })).map((m) => m.id)).toEqual([m1.id, m2.id]);
  });

  it('fails closed for another user (IDOR)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    await ctx.messages.append('userA', thread.id, { role: 'user', content: '1' });
    expect(await code(() => ctx.messages.list('userB', thread.id))).toBe('not_found');
  });
});
