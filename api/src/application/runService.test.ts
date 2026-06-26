import { describe, it, expect, beforeEach } from 'vitest';
import { RunService } from './runService';
import { MessageService } from './messageService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import type { RunStarter } from '../ports/runStarter';
import type { RunRecord } from '../ports/runStore';
import { AppError } from '../domain/errors';

function setup(opts?: { failStart?: boolean }) {
  const threadStore = new InMemoryThreadStore();
  const messageStore = new InMemoryMessageStore();
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `id_${++n}`,
    now: () => `2026-06-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const messages = new MessageService(threadStore, messageStore, clock);
  const runStore = new InMemoryRunStore();
  const started: RunRecord[] = [];
  const canceled: RunRecord[] = [];
  const starter: RunStarter = {
    async start(run) {
      if (opts?.failStart) throw new Error('boom');
      started.push(run);
      return { instanceId: `inst_${run.id}` };
    },
    async cancel(run) {
      canceled.push(run);
    },
  };
  const svc = new RunService(threadStore, messages, runStore, starter, clock);
  return { threadStore, messageStore, runStore, started, canceled, svc };
}

async function seedThread(store: InMemoryThreadStore, userId = 'userA', id = 't1') {
  await store.put({
    id,
    userId,
    title: 'T',
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 0,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  });
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('RunService.submit', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await seedThread(ctx.threadStore);
  });

  it('persists the user message and starts a queued run', async () => {
    const run = await ctx.svc.submit('userA', 't1', { text: 'hello there' });
    expect(run.status).toBe('queued');
    expect(run.instanceId).toBe(`inst_${run.id}`);
    expect(ctx.started).toHaveLength(1);

    const msgs = await ctx.messageStore.list('t1');
    expect(msgs.find((m) => m.role === 'user')?.content).toBe('hello there');
  });

  it('uses the client message id (idempotent user message)', async () => {
    await ctx.svc.submit('userA', 't1', { text: 'hi', clientMessageId: 'cm1' });
    const msgs = await ctx.messageStore.list('t1');
    expect(msgs.some((m) => m.id === 'cm1')).toBe(true);
  });

  it('rejects a second concurrent run on the same thread (409)', async () => {
    await ctx.svc.submit('userA', 't1', { text: 'first' });
    expect(await code(() => ctx.svc.submit('userA', 't1', { text: 'second' }))).toBe('conflict');
  });

  it('allows a new run once the previous one is terminal', async () => {
    const first = await ctx.svc.submit('userA', 't1', { text: 'first' });
    await ctx.runStore.put({ ...first, status: 'complete' });
    const second = await ctx.svc.submit('userA', 't1', { text: 'second' });
    expect(second.status).toBe('queued');
  });

  it('throws not_found for a missing thread', async () => {
    expect(await code(() => ctx.svc.submit('userA', 'nope', { text: 'x' }))).toBe('not_found');
  });

  it('rejects an empty prompt', async () => {
    expect(await code(() => ctx.svc.submit('userA', 't1', {}))).toBe('validation');
  });

  it('carries the tool + destructive allowlists onto the run', async () => {
    const run = await ctx.svc.submit('userA', 't1', {
      text: 'x',
      tools: ['web_search'],
      allowDestructive: ['delete_thread'],
    });
    expect(run.tools).toEqual(['web_search']);
    expect(run.allowDestructive).toEqual(['delete_thread']);
  });

  it('marks the run errored (not stuck active) when the worker fails to start', async () => {
    const failing = setup({ failStart: true });
    await seedThread(failing.threadStore);
    expect(await code(() => failing.svc.submit('userA', 't1', { text: 'x' }))).toBe('internal');
    // No active run remains → the thread is not locked forever.
    expect(await failing.runStore.listActive('t1')).toHaveLength(0);
  });
});

describe('RunService.get / cancel', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(async () => {
    ctx = setup();
    await seedThread(ctx.threadStore);
  });

  it('gets a run; cross-user access fails closed', async () => {
    const run = await ctx.svc.submit('userA', 't1', { text: 'x' });
    expect((await ctx.svc.get('userA', 't1', run.id)).id).toBe(run.id);
    expect(await code(() => ctx.svc.get('userB', 't1', run.id))).toBe('not_found');
  });

  it('cancels an active run and signals the worker', async () => {
    const run = await ctx.svc.submit('userA', 't1', { text: 'x' });
    const canceled = await ctx.svc.cancel('userA', 't1', run.id);
    expect(canceled.status).toBe('canceled');
    expect(ctx.canceled).toHaveLength(1);
    // Cancellation frees the thread for a new run.
    expect(await ctx.runStore.listActive('t1')).toHaveLength(0);
  });

  it('cancel is idempotent on a terminal run', async () => {
    const run = await ctx.svc.submit('userA', 't1', { text: 'x' });
    await ctx.runStore.put({ ...run, status: 'complete' });
    const out = await ctx.svc.cancel('userA', 't1', run.id);
    expect(out.status).toBe('complete');
    expect(ctx.canceled).toHaveLength(0);
  });
});
