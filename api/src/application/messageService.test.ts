import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadService } from './threadService';
import { MessageService } from './messageService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { AppError } from '../domain/errors';

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
    expect(msg.images).toEqual([img]);

    const stored = await ctx.messageStore.get(thread.id, msg.id);
    expect(stored?.images).toEqual([img]);
    expect((await ctx.threads.get('userA', thread.id)).lastMessagePreview).toBe('Image');
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
