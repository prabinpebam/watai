import { describe, expect, it } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InMemoryMemoryJobStore } from '../adapters/memory/memoryJobStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { MemoryExtractionService, type MemoryExtractorPort, type MemoryQueuePort } from './memoryExtractionService';

function setup(extractor: MemoryExtractorPort) {
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
  const svc = new MemoryExtractionService({ memoryStore, jobStore, messageStore, threadStore, queue, settings, credentials, extractor, clock });
  return { svc, memoryStore, jobStore, messageStore, threadStore, enqueued };
}

async function seedThread(ctx: ReturnType<typeof setup>, temporary = false) {
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
  await ctx.messageStore.append({ id: 'u1', threadId: 't1', userId: 'userA', role: 'user', content: 'I prefer concise implementation plans.', status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:01Z', deletedAt: null });
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
  });

  it('does not enqueue for temporary threads', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'x' }] }));
    await seedThread(ctx, true);
    await expect(ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1')).resolves.toBeNull();
    expect(ctx.enqueued).toEqual([]);
  });
});