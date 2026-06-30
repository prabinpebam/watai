import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InMemoryMemoryJobStore } from '../adapters/memory/memoryJobStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { parseMemoryRecord } from '../domain/memory';
import type { Embedder } from '../ports/embedder';
import { MemoryExtractionService, type MemoryExtractorPort, type MemoryQueuePort } from './memoryExtractionService';

function setup(extractor: MemoryExtractorPort, embedder?: Embedder) {
  const memoryStore = new InMemoryMemoryStore();
  const jobStore = new InMemoryMemoryJobStore();
  const messageStore = new InMemoryMessageStore();
  const threadStore = new InMemoryThreadStore();
  const enqueued: string[] = [];
  const queue: MemoryQueuePort = { enqueue: async (job) => void enqueued.push(job.id) };
  let n = 0;
  let t = 0;
  const clock = { newId: () => `id_${++n}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  const settings = { get: async () => ({ ...DEFAULT_SETTINGS, data: { ...DEFAULT_SETTINGS.data, sync: true } }) };
  const credentials = { getDecrypted: async () => ({ baseUrl: 'https://example.com/openai/v1', key: 'k', models: { chat: 'gpt-4.1' } }) };
  const sends: Array<{ target: string; payload: unknown }> = [];
  const signalr = { negotiate: () => ({}) as never, sendToUser: async (_userId: string, target: string, payload: unknown) => void sends.push({ target, payload }) };
  const svc = new MemoryExtractionService({ memoryStore, jobStore, messageStore, threadStore, queue, settings, credentials, extractor, embedder, signalr: signalr as never, clock });
  return { svc, memoryStore, jobStore, messageStore, threadStore, enqueued, sends };
}

async function seedThread(ctx: ReturnType<typeof setup>, temporary = false, userContent = 'I prefer concise implementation plans.') {
  await ctx.threadStore.put({
    id: 't1',
    userId: 'userA',
    title: 'T',
    pinned: false,
    archived: false,
    temporary,
    messageCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  });
  await ctx.messageStore.append({ id: 'u1', threadId: 't1', userId: 'userA', role: 'user', content: userContent, status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:01Z', deletedAt: null });
  await ctx.messageStore.append({ id: 'a1', threadId: 't1', userId: 'userA', role: 'assistant', content: 'Got it.', status: 'complete', createdAt: '2026-01-01T00:00:02Z', orderAt: '2026-01-01T00:00:02Z', deletedAt: null });
}

describe('MemoryExtractionService', () => {
  it('enqueues turn jobs idempotently and applies LLM add output', async () => {
    const ctx = setup(async () => ({
      operations: [{ op: 'add', kind: 'preference', text: 'User prefers concise implementation plans.', confidence: 0.92, salience: 0.8, sourceMessageIds: ['u1'], reason: 'Stable preference.' }],
    }));
    await seedThread(ctx);
    const first = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    const second = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(first?.id).toBe(second?.id);
    expect(ctx.enqueued).toEqual([first?.id]);

    await ctx.svc.processJob('userA', first!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ kind: 'preference', text: 'User prefers concise implementation plans.' });
    expect(memories[0].sourceRefs[0]).toMatchObject({ type: 'message', threadId: 't1', messageId: 'u1' });
    expect((await ctx.jobStore.get('userA', first!.id))?.status).toBe('completed');
    expect(ctx.sends).toEqual([{ target: 'memory', payload: expect.objectContaining({ acceptedCount: 1, threadId: 't1', assistantMessageId: 'a1' }) }]);
  });

  it('records ignored decisions and rejects one-off/low-confidence output', async () => {
    const ctx = setup(async () => ({
      operations: [{ op: 'add', kind: 'preference', text: 'User wants this answer to be poetic.', confidence: 0.2, salience: 0.2, sourceMessageIds: ['u1'], reason: 'Too weak.' }],
    }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await ctx.jobStore.get('userA', job!.id))?.status).toBe('ignored');
    expect(ctx.sends).toEqual([]);
  });

  it('requires stronger scores for automatic turn extraction than explicit command extraction', async () => {
    const extractor: MemoryExtractorPort = async () => ({
      operations: [{ op: 'add', kind: 'preference', text: 'User prefers occasional poetic phrasing.', confidence: 0.75, salience: 0.6, sourceMessageIds: ['u1'], reason: 'Moderate signal.' }],
    });
    const automatic = setup(extractor);
    await seedThread(automatic);
    const turnJob = await automatic.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await automatic.svc.processJob('userA', turnJob!.id);
    expect((await automatic.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await automatic.jobStore.get('userA', turnJob!.id))?.status).toBe('ignored');

    const explicit = setup(extractor);
    await seedThread(explicit);
    const commandJob = await explicit.svc.enqueueCommand('userA', 't1', 'u1', 'run1');
    await explicit.svc.processJob('userA', commandJob!.id);
    expect((await explicit.memoryStore.list('userA', { status: 'active' })).memories).toHaveLength(1);
    expect((await explicit.jobStore.get('userA', commandJob!.id))?.status).toBe('completed');
  });

  it('enqueues substantive turns and lets the extractor decide to ignore non-durable content', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'No durable memory.' }] }));
    await seedThread(ctx, false, 'Write a debounce hook in TypeScript.');

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(job).not.toBeNull();
    await ctx.svc.processJob('userA', job!.id);

    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await ctx.jobStore.get('userA', job!.id))?.status).toBe('ignored');
    expect(ctx.sends).toEqual([]);
  });

  it('captures a keyword-free personal fact spread across short turns', async () => {
    const ctx = setup(async () => ({
      operations: [{ op: 'add', kind: 'fact', text: 'User has a dog named Chopper, a Lhasa Apso.', confidence: 0.9, salience: 0.85, sourceMessageIds: ['u2'], reason: 'Durable personal fact.' }],
    }));
    // No gate keyword ("my dog", "I have") anywhere — the extractor alone decides.
    await ctx.threadStore.put({ id: 't1', userId: 'userA', title: 'T', pinned: false, archived: false, temporary: false, messageCount: 4, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'u1', threadId: 't1', userId: 'userA', role: 'user', content: 'we finally caved and got a little guy', status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:01Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'a1', threadId: 't1', userId: 'userA', role: 'assistant', content: 'congrats! tell me about him', status: 'complete', createdAt: '2026-01-01T00:00:02Z', orderAt: '2026-01-01T00:00:02Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'u2', threadId: 't1', userId: 'userA', role: 'user', content: "he's a lhasa apso, we went with Chopper", status: 'complete', createdAt: '2026-01-01T00:00:03Z', orderAt: '2026-01-01T00:00:03Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'a2', threadId: 't1', userId: 'userA', role: 'assistant', content: 'Chopper is a great name!', status: 'complete', createdAt: '2026-01-01T00:00:04Z', orderAt: '2026-01-01T00:00:04Z', deletedAt: null });

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a2', 'run1');
    expect(job).not.toBeNull();
    await ctx.svc.processJob('userA', job!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ kind: 'fact', text: 'User has a dog named Chopper, a Lhasa Apso.' });
  });

  it('passes the full threaded conversation (not just the last few messages) to the extractor', async () => {
    let seen: Array<{ id: string; role: string }> = [];
    const ctx = setup(async (_creds, input) => {
      seen = input.messages.map((m) => ({ id: m.id, role: m.role }));
      return { operations: [{ op: 'ignore', reason: 'context only' }] };
    });
    await ctx.threadStore.put({ id: 't1', userId: 'userA', title: 'T', pinned: false, archived: false, temporary: false, messageCount: 8, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });
    // The thread's framing ("a speech for my son") is the FIRST message — outside the old 5-message
    // window. The extractor must still receive it so it can attribute the later speech lines correctly.
    const seq: Array<[string, 'user' | 'assistant', string]> = [
      ['u1', 'user', 'Help me write a school speech for my 5-year-old son.'],
      ['a1', 'assistant', 'Sure — share the details.'],
      ['u2', 'user', 'one moment'],
      ['a2', 'assistant', 'Take your time.'],
      ['u3', 'user', 'here goes'],
      ['a3', 'assistant', 'Ready.'],
      ['u4', 'user', 'My school is Keystone. I like cars. My favorite place is Fun Zone.'],
      ['a4', 'assistant', 'Done — here is the speech.'],
    ];
    let s = 1;
    for (const [id, role, content] of seq) {
      await ctx.messageStore.append({ id, threadId: 't1', userId: 'userA', role, content, status: 'complete', createdAt: `2026-01-01T00:00:0${s}Z`, orderAt: `2026-01-01T00:00:0${s}Z`, deletedAt: null });
      s++;
    }
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a4', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    // All eight messages reach the extractor (the old window would have dropped u1/a1/u2).
    expect(seen.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });

  it('mechanically skips trivial windows without calling the extractor', async () => {
    let called = false;
    const ctx = setup(async () => {
      called = true;
      return { operations: [{ op: 'ignore', reason: 'x' }] };
    });
    await seedThread(ctx, false, 'ok');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(job).toBeNull();
    expect(ctx.enqueued).toEqual([]);
    expect(called).toBe(false);
  });

  it('does not enqueue for temporary threads', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'x' }] }));
    await seedThread(ctx, true);
    await expect(ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1')).resolves.toBeNull();
    expect(ctx.enqueued).toEqual([]);
  });

  it('persists the routed target proposed by the planner', async () => {
    const ctx = setup(async () => ({
      operations: [{
        op: 'add',
        kind: 'fact',
        text: 'User has a daughter named Laija who is 9 years old.',
        target: {
          layer: 'long_term_profile',
          profilePath: 'user.family.children',
          entity: { type: 'family_member', name: 'Laija' },
          relationship: { predicate: 'HAS_FAMILY_MEMBER', object: { type: 'family_member', name: 'Laija' }, attributes: { relationship: 'daughter', age: 9 } },
          temporal: { bucket: 'long_term' },
          evidenceStrategy: 'merge',
        },
        confidence: 0.94,
        salience: 0.88,
        sourceMessageIds: ['u1'],
        reason: 'Stable family profile fact.',
      }],
    }));
    await seedThread(ctx, false, 'My daughter is named Laija and she is 9.');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0].route).toMatchObject({ layer: 'long_term_profile', profilePath: 'user.family.children' });
    expect(memories[0].route?.relationship?.attributes).toMatchObject({ relationship: 'daughter', age: 9 });
  });

  it('backfills embeddings for active memories that lack a current-model vector', async () => {
    const embedder: Embedder = { model: 'stub-embed', embed: async (_c, text) => [text.length % 5, 1, 0] };
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'nothing durable' }] }), embedder);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'old', userId: 'userA', kind: 'fact', status: 'active', text: 'User likes tea.',
      confidence: 0.9, salience: 0.7, pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    }));

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    const healed = (await ctx.memoryStore.list('userA', { status: 'active' })).memories.find((m) => m.id === 'old');
    expect(healed?.embedding?.length).toBeGreaterThan(0);
    expect(healed?.embeddingModel).toBe('stub-embed');
  });
});