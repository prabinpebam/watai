import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processRun, type RunWorkerDeps } from './runWorker';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import type { RunRecord } from '../ports/runStore';
import type { RunStatus } from '../domain/run';
import type { AgentEvent, RunAgentParams } from '../ai/orchestrator';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { AppError } from '../domain/errors';

type RunAgentFn = NonNullable<RunWorkerDeps['runAgent']>;

function setup(opts?: { credError?: boolean; tavily?: boolean }) {
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
        ...(opts?.tavily ? { tavilyKey: 'tav-key' } : {}),
      };
    },
  };
  const deps = (runAgent: RunAgentFn): RunWorkerDeps => ({
    runStore,
    messageStore,
    threadStore,
    credentials,
    runAgent,
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

function script(events: AgentEvent[]): RunAgentFn {
  return async function* () {
    for (const e of events) yield e;
  };
}

describe('processRun', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));

  it('streams the agent answer into a finalized assistant message and completes the run', async () => {
    await seed(ctx);
    await processRun(
      ctx.deps(script([{ type: 'text', delta: 'Hi ' }, { type: 'text', delta: 'there' }, { type: 'done' }])),
      't1',
      'r1',
    );

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.content).toBe('Hi there');
    expect(msg?.status).toBe('complete');
    expect(msg?.model).toBe('gpt-5.4');
    expect(msg?.orderAt).toBe('2026-06-01T00:00:02Z'); // sorts after the user message

    const run = await ctx.runStore.get('t1', 'r1');
    expect(run?.status).toBe('complete');
    expect((await ctx.threadStore.get('userA', 't1'))?.lastMessagePreview).toBe('Hi there');
  });

  it('builds turns: a system prompt then the prior user/assistant history (no in-progress msg)', async () => {
    await seed(ctx);
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect(seen[0].model).toBe('gpt-5.4');
    expect(seen[0].turns[0].role).toBe('system');
    expect(seen[0].turns[1]).toEqual({ role: 'user', text: 'hello' });
    expect(seen[0].tools).toEqual([]); // no Tavily key -> no web_search tool
  });

  it('personalizes the system prompt from the user settings (about-you / response-style)', async () => {
    await seed(ctx);
    const settings = {
      get: async () => ({
        ...DEFAULT_SETTINGS,
        personalization: {
          ...DEFAULT_SETTINGS.personalization,
          aboutYou: 'I am a chef.',
          howRespond: 'Be terse.',
        },
      }),
    };
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun({ ...ctx.deps(runAgent), settings }, 't1', 'r1');
    const sys = seen[0].turns[0].text;
    expect(sys).toContain('I am a chef.');
    expect(sys).toContain('Be terse.');
  });

  it('auto-names an untitled thread from the first exchange', async () => {
    await seed(ctx);
    const t = await ctx.threadStore.get('userA', 't1');
    await ctx.threadStore.put({ ...t!, title: 'New chat' });
    const fetchImpl = (async () => ({
      ok: true,
      status: 200,
      json: async () => ({ choices: [{ message: { content: '"Greeting Exchange"' } }] }),
    })) as unknown as typeof fetch;
    await processRun(
      { ...ctx.deps(script([{ type: 'text', delta: 'Hi!' }, { type: 'done' }])), fetchImpl },
      't1',
      'r1',
    );
    expect((await ctx.threadStore.get('userA', 't1'))?.title).toBe('Greeting Exchange');
  });

  it('does not rename a thread that already has a title', async () => {
    await seed(ctx); // seeded title is 'T'
    let titleCall = false;
    const fetchImpl = (async () => {
      titleCall = true;
      return { ok: true, status: 200, json: async () => ({ choices: [{ message: { content: 'X' } }] }) };
    }) as unknown as typeof fetch;
    await processRun(
      { ...ctx.deps(script([{ type: 'text', delta: 'Hi!' }, { type: 'done' }])), fetchImpl },
      't1',
      'r1',
    );
    expect((await ctx.threadStore.get('userA', 't1'))?.title).toBe('T');
    expect(titleCall).toBe(false);
  });

  it('offers the web_search tool when a Tavily key is configured', async () => {
    const c = setup({ tavily: true });
    await seed(c);
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(c.deps(runAgent), 't1', 'r1');
    expect(seen[0].tools.map((t) => t.name)).toContain('web_search');
  });

  it('offers code_interpreter + file_search when the run requests them and a vector store exists', async () => {
    const run = await seed(ctx);
    await ctx.runStore.put({ ...run, tools: ['web_search', 'code_interpreter', 'file_search'] });
    const thread = await ctx.threadStore.get('userA', 't1');
    await ctx.threadStore.put({ ...thread!, vectorStoreId: 'vs1' });
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    const types = seen[0].tools.map((t) => t.type);
    expect(types).toContain('code_interpreter');
    expect(types).toContain('file_search');
    expect(seen[0].tools.find((t) => t.type === 'file_search')?.vector_store_ids).toEqual(['vs1']);
  });

  it('uploads a generated image and attaches it to the message', async () => {
    await seed(ctx);
    const uploads: Array<{ imageId: string; len: number }> = [];
    const uploadImage = async (
      userId: string,
      threadId: string,
      imageId: string,
      bytes: Uint8Array,
    ): Promise<string> => {
      uploads.push({ imageId, len: bytes.length });
      return `${userId}/${threadId}/${imageId}.png`;
    };
    const runAgent: RunAgentFn = script([
      { type: 'tool', name: 'generate_image', status: 'running', callId: 'g1' },
      {
        type: 'image',
        b64: Buffer.from('PNGDATA').toString('base64'),
        partial: false,
        prompt: 'a cat',
        size: '1024x1024',
        callId: 'g1',
      },
      { type: 'tool', name: 'generate_image', status: 'done', callId: 'g1' },
      { type: 'text', delta: "Here's your image." },
      { type: 'done' },
    ]);
    await processRun({ ...ctx.deps(runAgent), uploadImage }, 't1', 'r1');
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.images?.length).toBe(1);
    expect(msg?.images?.[0]).toMatchObject({ prompt: 'a cat', size: '1024x1024', outputFormat: 'png' });
    expect(msg?.images?.[0].blobPath).toContain('.png');
    expect(uploads[0].len).toBeGreaterThan(0);
    expect(msg?.toolCalls?.find((t) => t.id === 'g1')?.kind).toBe('image');
  });

  it('accumulates tool cards and citations onto the message', async () => {
    await seed(ctx);
    await processRun(
      ctx.deps(
        script([
          { type: 'tool', name: 'web_search', status: 'running', callId: 'c1', args: { query: 'x' } },
          { type: 'citation', citation: { source: 'web', url: 'https://example.com', title: 'E', content: 'snip' } },
          { type: 'tool', name: 'web_search', status: 'done', callId: 'c1' },
          { type: 'text', delta: 'Per the web.' },
          { type: 'done' },
        ]),
      ),
      't1',
      'r1',
    );
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.content).toBe('Per the web.');
    expect(msg?.toolCalls).toEqual([{ id: 'c1', kind: 'web_search', name: 'web_search', status: 'done' }]);
    expect(msg?.citations?.[0]).toMatchObject({ source: 'web', url: 'https://example.com', title: 'E', content: 'snip' });
    expect(msg?.status).toBe('complete');
  });

  it('writes a streaming message before the final one (incremental upserts)', async () => {
    await seed(ctx);
    const spy = vi.spyOn(ctx.messageStore, 'append');
    await processRun(
      ctx.deps(script([{ type: 'text', delta: 'a' }, { type: 'text', delta: 'b' }, { type: 'done' }])),
      't1',
      'r1',
    );
    const statuses = spy.mock.calls.map((c) => c[0].status);
    expect(statuses).toContain('streaming');
    expect(statuses[statuses.length - 1]).toBe('complete');
  });

  it('is a no-op for a run that is not active', async () => {
    await seed(ctx, 'complete');
    await processRun(ctx.deps(script([{ type: 'text', delta: 'x' }])), 't1', 'r1');
    expect(await ctx.messageStore.get('t1', 'am1')).toBeNull();
  });

  it('marks the message + run errored on an agent error', async () => {
    await seed(ctx);
    await processRun(ctx.deps(script([{ type: 'error', message: '429' }])), 't1', 'r1');
    expect((await ctx.messageStore.get('t1', 'am1'))?.status).toBe('error');
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('error');
  });

  it('errors cleanly when credentials are missing', async () => {
    const c = setup({ credError: true });
    await seed(c);
    await processRun(c.deps(script([{ type: 'text', delta: 'x' }])), 't1', 'r1');
    expect((await c.runStore.get('t1', 'r1'))?.status).toBe('error');
    expect((await c.messageStore.get('t1', 'am1'))?.status).toBe('error');
  });

  it('finalizes as interrupted when the run is canceled mid-stream', async () => {
    const run = await seed(ctx);
    const cancelingAgent: RunAgentFn = async function* () {
      yield { type: 'text', delta: 'partial' };
      await ctx.runStore.put({ ...run, status: 'canceled' });
      yield { type: 'text', delta: ' more' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(cancelingAgent), 't1', 'r1');
    expect((await ctx.messageStore.get('t1', 'am1'))?.status).toBe('interrupted');
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('canceled');
  });
});
