import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processRun, type RunWorkerDeps } from './runWorker';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import type { RunRecord } from '../ports/runStore';
import type { RunStatus } from '../domain/run';
import type { ChatStreamEvent, StreamChatParams } from '../ai/chat';
import { AppError } from '../domain/errors';

function setup(opts?: { credError?: boolean }) {
  const runStore = new InMemoryRunStore();
  const messageStore = new InMemoryMessageStore();
  const threadStore = new InMemoryThreadStore();
  let t = 0;
  const clock = {
    newId: () => 'id',
    now: () => `2026-06-01T00:01:${String(t++).padStart(2, '0')}Z`,
  };
  const credentials = {
    getDecrypted: async () => {
      if (opts?.credError) throw new AppError('not_found', 'no creds');
      return {
        baseUrl: 'https://r.services.ai.azure.com/openai/v1',
        key: 'k',
        models: { chat: 'gpt-5.4' },
      };
    },
  };
  const deps = (streamChat: RunWorkerDeps['streamChat']): RunWorkerDeps => ({
    runStore,
    messageStore,
    threadStore,
    credentials,
    streamChat,
    clock,
    flushIntervalMs: 0,
  });
  return { runStore, messageStore, threadStore, clock, credentials, deps };
}

async function seed(ctx: ReturnType<typeof setup>, runStatus: RunStatus = 'queued'): Promise<RunRecord> {
  await ctx.threadStore.put({
    id: 't1',
    userId: 'userA',
    title: 'T',
    pinned: false,
    archived: false,
    temporary: false,
    messageCount: 1,
    createdAt: '2026-06-01T00:00:00Z',
    updatedAt: '2026-06-01T00:00:00Z',
    deletedAt: null,
  });
  await ctx.messageStore.append({
    id: 'um1',
    threadId: 't1',
    userId: 'userA',
    role: 'user',
    content: 'hello',
    status: 'complete',
    createdAt: '2026-06-01T00:00:01Z',
    orderAt: '2026-06-01T00:00:01Z',
    deletedAt: null,
  });
  const run: RunRecord = {
    id: 'r1',
    threadId: 't1',
    userId: 'userA',
    assistantMessageId: 'am1',
    status: runStatus,
    instanceId: 'inst',
    tools: [],
    allowDestructive: [],
    createdAt: '2026-06-01T00:00:02Z',
    heartbeatAt: '2026-06-01T00:00:02Z',
  };
  await ctx.runStore.put(run);
  return run;
}

async function* script(events: ChatStreamEvent[]): AsyncGenerator<ChatStreamEvent> {
  for (const e of events) yield e;
}

describe('processRun', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));

  it('streams a completion into a finalized assistant message and completes the run', async () => {
    await seed(ctx);
    const stream = () =>
      script([
        { type: 'delta', textDelta: 'Hi ' },
        { type: 'delta', textDelta: 'there' },
        { type: 'done', usage: { completionTokens: 2 } },
      ]);
    await processRun(ctx.deps(stream), 't1', 'r1');

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.content).toBe('Hi there');
    expect(msg?.status).toBe('complete');
    expect(msg?.model).toBe('gpt-5.4');
    expect(msg?.orderAt).toBe('2026-06-01T00:00:02Z'); // sorts after the user message

    const run = await ctx.runStore.get('t1', 'r1');
    expect(run?.status).toBe('complete');
    expect((await ctx.threadStore.get('userA', 't1'))?.lastMessagePreview).toBe('Hi there');
  });

  it('passes only prior user/assistant turns as history (not the in-progress assistant message)', async () => {
    await seed(ctx);
    const seen: StreamChatParams[] = [];
    const stream = (p: StreamChatParams) => {
      seen.push(p);
      return script([{ type: 'delta', textDelta: 'ok' }, { type: 'done' }]);
    };
    await processRun(ctx.deps(stream), 't1', 'r1');
    expect(seen[0].messages).toEqual([{ role: 'user', content: 'hello' }]);
    expect(seen[0].model).toBe('gpt-5.4');
  });

  it('writes a streaming message before the final one (incremental upserts)', async () => {
    await seed(ctx);
    const spy = vi.spyOn(ctx.messageStore, 'append');
    await processRun(
      ctx.deps(() => script([{ type: 'delta', textDelta: 'a' }, { type: 'delta', textDelta: 'b' }, { type: 'done' }])),
      't1',
      'r1',
    );
    const statuses = spy.mock.calls.map((c) => c[0].status);
    expect(statuses).toContain('streaming');
    expect(statuses[statuses.length - 1]).toBe('complete');
  });

  it('is a no-op for a run that is not active', async () => {
    await seed(ctx, 'complete');
    await processRun(ctx.deps(() => script([{ type: 'delta', textDelta: 'x' }])), 't1', 'r1');
    expect(await ctx.messageStore.get('t1', 'am1')).toBeNull();
  });

  it('marks the message + run errored on a stream error', async () => {
    await seed(ctx);
    await processRun(
      ctx.deps(() => script([{ type: 'error', error: { code: 'rate_limited', message: '429' } }])),
      't1',
      'r1',
    );
    expect((await ctx.messageStore.get('t1', 'am1'))?.status).toBe('error');
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('error');
  });

  it('errors cleanly when credentials are missing', async () => {
    const c = setup({ credError: true });
    await seed(c);
    await processRun(c.deps(() => script([{ type: 'delta', textDelta: 'x' }])), 't1', 'r1');
    expect((await c.runStore.get('t1', 'r1'))?.status).toBe('error');
    expect((await c.messageStore.get('t1', 'am1'))?.status).toBe('error');
  });

  it('finalizes as interrupted when the run is canceled mid-stream', async () => {
    const run = await seed(ctx);
    const cancelingStream = async function* (): AsyncGenerator<ChatStreamEvent> {
      yield { type: 'delta', textDelta: 'partial' };
      await ctx.runStore.put({ ...run, status: 'canceled' });
      yield { type: 'delta', textDelta: ' more' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(() => cancelingStream()), 't1', 'r1');
    expect((await ctx.messageStore.get('t1', 'am1'))?.status).toBe('interrupted');
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('canceled');
  });
});
