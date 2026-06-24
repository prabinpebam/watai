import { describe, it, expect } from 'vitest';
import { createMessagesController } from './messagesController';
import { MessageService } from '../application/messageService';
import { ThreadService } from '../application/threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';

function setup() {
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
  return { threads, ctrl: createMessagesController(messages) };
}

describe('messagesController', () => {
  it('appends a message to an owned thread → 201', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.append({
      claims: { sub: 'userA' },
      params: { threadId: thread.id },
      body: { role: 'user', content: 'hello' },
    });
    expect(res.status).toBe(201);
    expect(res.body).toMatchObject({ content: 'hello', userId: 'userA' });
  });

  it('lists messages oldest-first → 200', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    await ctrl.append({ claims: { sub: 'userA' }, params: { threadId: thread.id }, body: { role: 'user', content: 'one' } });
    await ctrl.append({ claims: { sub: 'userA' }, params: { threadId: thread.id }, body: { role: 'assistant', content: 'two' } });
    const res = await ctrl.list({ claims: { sub: 'userA' }, params: { threadId: thread.id } });
    expect(res.status).toBe(200);
    expect((res.body as { messages: { content: string }[] }).messages.map((m) => m.content)).toEqual(['one', 'two']);
  });

  it('cross-user append to another user’s thread → 404 (IDOR fails closed)', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.append({
      claims: { sub: 'userB' },
      params: { threadId: thread.id },
      body: { role: 'user', content: 'x' },
    });
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    const { ctrl } = setup();
    const res = await ctrl.list({ claims: {}, params: { threadId: 't1' } });
    expect(res.status).toBe(401);
  });

  it('invalid body → 400', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.append({
      claims: { sub: 'userA' },
      params: { threadId: thread.id },
      body: { role: 'bad', content: '' },
    });
    expect(res.status).toBe(400);
  });
});
