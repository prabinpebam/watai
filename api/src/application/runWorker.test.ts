import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processRun as processRunForOwner, type RunWorkerDeps } from './runWorker';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { CosmosRunStore } from '../adapters/cosmos/runStore';
import { ownerScopedDocumentId } from '../adapters/cosmos/ownerScopedId';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InProcessRetriever } from '../adapters/memory/inProcessRetriever';
import { MemoryService } from './memoryService';
import { MemoryContextService } from './memoryContextService';
import type { RunRecord } from '../ports/runStore';
import type { MessageRecord } from '../ports/messageStore';
import { observeAgentUsage, type RunStatus } from '../domain/run';
import type { AgentEvent, RunAgentParams } from '../ai/orchestrator';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { memoryEmbeddingTextHash } from '../domain/memory';
import { DEFAULT_SKILLS } from '../skills';
import { AppError } from '../domain/errors';
import { libraryItemIdFor } from '../domain/library';
import type { LibraryItemRecord } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';

type RunAgentFn = NonNullable<RunWorkerDeps['runAgent']>;

function processRun(deps: RunWorkerDeps, threadId: string, runId: string): Promise<void> {
  return processRunForOwner(deps, 'userA', threadId, runId);
}

function setup(opts?: { credError?: boolean; tavily?: boolean; kbStore?: string; image?: boolean; reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high' }) {
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
        models: { chat: 'gpt-5.4', ...(opts?.image ? { image: 'gpt-image-1' } : {}) },
        ...(opts?.reasoningEffort ? { chatDefaults: { reasoningEffort: opts.reasoningEffort } } : {}),
        ...(opts?.tavily ? { tavilyKey: 'tav-key' } : {}),
        ...(opts?.kbStore ? { knowledgeBaseVectorStoreId: opts.kbStore } : {}),
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
  const testRunStore = {
    get: (threadId: string, runId: string) => runStore.get('userA', threadId, runId),
    put: (record: RunRecord) => runStore.put(record),
    listActive: (threadId: string) => runStore.listActive('userA', threadId),
    deleteByThread: (threadId: string) => runStore.deleteByThread('userA', threadId),
  };
  const testMessageStore = {
    get: (threadId: string, id: string) => messageStore.get('userA', threadId, id),
    list: (threadId: string) => messageStore.list('userA', threadId),
    append: (record: MessageRecord) => messageStore.append(record),
    delete: (userId: string, threadId: string, id: string) => messageStore.delete(userId, threadId, id),
    deleteByThread: (threadId: string) => messageStore.deleteByThread('userA', threadId),
  };
  return { runStore: testRunStore, messageStore: testMessageStore, workerMessageStore: messageStore, threadStore, clock, credentials, deps };
}

async function seed(ctx: ReturnType<typeof setup>, runStatus: RunStatus = 'queued', tools: string[] = [], userText = 'hello'): Promise<RunRecord> {
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
    content: userText,
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
    tools,
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

/** Mock fetch for the code-interpreter container endpoints: one assistant-generated PDF, one
 *  user-uploaded input, and several assistant reference/intermediate files that must be ignored. */
function artifactFetch(): typeof fetch {
  return (async (url: string | URL): Promise<Response> => {
    const u = String(url);
    if (u.includes('/files/cfile_1/content')) {
      return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]));
    }
    if (u.includes('/containers/cntr_x/files')) {
      return {
        ok: true,
        status: 200,
        json: async () => ({
          data: [
            { id: 'cfile_1', path: '/mnt/data/report.pdf', source: 'assistant' },
            { id: 'cfile_skill', path: '/mnt/data/skills/pdf/SKILL.md', source: 'assistant' },
            { id: 'cfile_ref', path: '/mnt/data/skills/pdf/reference.md', source: 'assistant' },
            { id: 'cfile_note', path: '/mnt/data/colorful_kids_worksheet_design_philosophy.md', source: 'assistant' },
            { id: 'cfile_preview', path: '/mnt/data/verify_images/page_1.png', source: 'assistant' },
            { id: 'cfile_in', path: '/mnt/data/input.pdf', source: 'user' },
          ],
        }),
        text: async () => '',
        headers: new Headers(),
      } as unknown as Response;
    }
    throw new Error(`unexpected fetch: ${u}`);
  }) as unknown as typeof fetch;
}

describe('processRun', () => {
  let ctx: ReturnType<typeof setup>;
  beforeEach(() => (ctx = setup()));

  it.each(['purged', 'foreign', 'wrong-id', 'create-conflict', 'cancel-upload', 'delete-thread', 'active', 'new'] as const)('protects chat image publication from invalid Library state or lost liveness: %s', async state => {
    await seed(ctx);
    const libraryItemId = libraryItemIdFor('userA', 'chat_generated_image', 'img1-am1');
    const tombstone = { id: libraryItemId, userId: 'userA', state: 'purged' } as LibraryItemRecord;
    let current: LibraryItemRecord | null = ['purged', 'foreign', 'wrong-id', 'active'].includes(state) ? {
      id: state === 'wrong-id' ? 'other' : libraryItemId, userId: state === 'foreign' ? 'userB' : 'userA',
      state: state === 'purged' ? 'purged' : 'active',
    } as LibraryItemRecord : null;
    const put = vi.fn(async (record: LibraryItemRecord) => { current = record; return record; });
    const createIfAbsent = vi.fn(async (record: LibraryItemRecord) => {
      if (state === 'create-conflict') { current = tombstone; return null; }
      current = record;
      return record;
    });
    const uploadImage = vi.fn(async () => {
      if (state === 'cancel-upload') await ctx.runStore.put({ ...(await ctx.runStore.get('t1', 'r1'))!, status: 'cancel_requested' });
      if (state === 'delete-thread') await ctx.threadStore.put({ ...(await ctx.threadStore.get('userA', 't1'))!, deletedAt: ctx.clock.now() });
      return 'userA/image.png';
    });
    await processRun({ ...ctx.deps(script([
      { type: 'tool', name: 'generate_image', status: 'running', callId: 'image-call' },
      { type: 'image', b64: Buffer.from('png').toString('base64'), partial: false, callId: 'image-call' },
      { type: 'done' },
    ])), uploadImage, libraryStore: { get: async () => current, put, createIfAbsent } as unknown as LibraryStore }, 't1', 'r1');
    const published = state === 'new' || state === 'active';
    expect(put).not.toHaveBeenCalled();
    expect(uploadImage).toHaveBeenCalledTimes(['purged', 'foreign', 'wrong-id'].includes(state) ? 0 : 1);
    expect((await ctx.messageStore.get('t1', 'am1'))?.images ?? []).toHaveLength(published ? 1 : 0);
    expect((await ctx.threadStore.get('userA', 't1'))?.files ?? []).toHaveLength(published ? 1 : 0);
    if (state === 'create-conflict') expect(current).toEqual(tombstone);
  });

  it('never upserts over a Library tombstone that wins after the absence check', async () => {
    await seed(ctx);
    const libraryItemId = libraryItemIdFor('userA', 'code_artifact', 'art1-am1');
    const tombstone = { id: libraryItemId, userId: 'userA', state: 'purged' } as LibraryItemRecord;
    let stored: LibraryItemRecord | null = null;
    const put = vi.fn(async (record: LibraryItemRecord) => { stored = tombstone; stored = record; return stored; });
    const createIfAbsent = vi.fn(async () => { stored = tombstone; return null; });
    await processRun({ ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl: artifactFetch(), uploadArtifact: async () => 'userA/artifact.pdf', artifactCaptureAttempts: 1,
      libraryStore: { get: async () => stored, put, createIfAbsent } as unknown as LibraryStore,
    }, 't1', 'r1');
    expect(put).not.toHaveBeenCalled();
    expect(createIfAbsent).toHaveBeenCalledOnce();
    expect(stored).toEqual(tombstone);
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toEqual([]);
  });

  it.each(['upload', 'library-publication'] as const)('does not attach an artifact whose library item is deleted during %s', async stage => {
    await seed(ctx);
    let stored: LibraryItemRecord | null = null;
    const libraryItemId = libraryItemIdFor('userA', 'code_artifact', 'art1-am1');
    const deleted = { id: libraryItemId, userId: 'userA', state: 'purged' } as LibraryItemRecord;
    const put = vi.fn(async (record: LibraryItemRecord) => { stored = stage === 'library-publication' ? deleted : record; return stored; });
    const uploadArtifact = vi.fn(async () => { if (stage === 'upload') stored = deleted; return 'userA/artifact.pdf'; });
    await processRun({ ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl: artifactFetch(), uploadArtifact, artifactCaptureAttempts: 1,
      libraryStore: { get: async () => stored, put, createIfAbsent: put } as unknown as LibraryStore,
    }, 't1', 'r1');
    expect(uploadArtifact).toHaveBeenCalledOnce();
    expect(put).toHaveBeenCalledTimes(stage === 'upload' ? 0 : 1);
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toEqual([]);
    expect((await ctx.threadStore.get('userA', 't1'))?.files ?? []).toEqual([]);
    expect(stored).toEqual(deleted);
  });

  it.each(['trashed', 'purging', 'purged', 'missing', 'foreign', 'active'] as const)('does not recreate artifact effects for an ineligible existing library record: %s', async state => {
    await seed(ctx);
    const libraryItemId = libraryItemIdFor('userA', 'code_artifact', 'art1-am1');
    const stored = { id: libraryItemId, userId: state === 'foreign' ? 'userB' : 'userA',
      state: state === 'foreign' ? 'active' : state, blobPath: 'retained-path' } as LibraryItemRecord;
    const get = vi.fn(async () => stored);
    const put = vi.fn();
    const uploadArtifact = vi.fn(async () => 'userA/artifact.pdf');
    await processRun({ ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl: artifactFetch(), uploadArtifact, artifactCaptureAttempts: 1,
      libraryStore: { get, put, createIfAbsent: put } as unknown as LibraryStore,
    }, 't1', 'r1');
    expect(uploadArtifact).toHaveBeenCalledTimes(state === 'active' ? 1 : 0);
    expect(put).not.toHaveBeenCalled();
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toHaveLength(state === 'active' ? 1 : 0);
    expect(stored.state).toBe(state === 'foreign' ? 'active' : state);
  });

  it.each([undefined, 'unknown', 'user', 'assistant'])('requires explicit assistant provenance before capturing provider files: %s', async source => {
    await seed(ctx);
    const originalFetch = artifactFetch();
    let downloads = 0;
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/content')) {
        downloads++;
        return originalFetch(url, init);
      }
      return new Response(JSON.stringify({ data: [{ id: 'cfile_1', path: '/mnt/data/report.pdf', source }] }), { headers: { 'Content-Type': 'application/json' } });
    }) as typeof fetch;
    const uploadArtifact = vi.fn(async () => 'userA/generated/report.pdf');
    await processRun({ ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl, uploadArtifact, artifactCaptureAttempts: 1,
    }, 't1', 'r1');
    const expected = source === 'assistant' ? 1 : 0;
    expect(downloads).toBe(expected);
    expect(uploadArtifact).toHaveBeenCalledTimes(expected);
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toHaveLength(expected);
  });

  it('does not repeat an oversized artifact download during fallback capture', async () => {
    await seed(ctx);
    let downloads = 0;
    const originalFetch = artifactFetch();
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      if (String(url).includes('/files/cfile_1/content')) {
        downloads++;
        return new Response(new Uint8Array([1]), { headers: { 'Content-Length': '999999999' } });
      }
      return originalFetch(url, init);
    }) as typeof fetch;
    const uploadArtifact = vi.fn(async () => 'unused');
    await processRun({ ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl, uploadArtifact, artifactCaptureAttempts: 3, artifactCaptureRetryMs: 0,
    }, 't1', 'r1');
    expect(downloads).toBe(1);
    expect(uploadArtifact).not.toHaveBeenCalled();
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toEqual([]);
  });

  it.each(['failed', 'conflict', 'missing', 'confirmed'] as const)('only begins completion follow-ups after terminal run persistence is confirmed: %s', async state => {
    await seed(ctx);
    const deps = ctx.deps(script([{ type: 'text', delta: 'Response' }, { type: 'done' }]));
    const transition = deps.runStore.transition.bind(deps.runStore);
    vi.spyOn(deps.runStore, 'transition').mockImplementation(async (...args) => {
      if (args[4].status === 'complete' && state !== 'confirmed') {
        if (state === 'failed') throw new Error('Terminal persistence unavailable');
        if (state === 'missing') return { outcome: 'missing' };
        return { outcome: 'unchanged', run: (await ctx.runStore.get('t1', 'r1'))! };
      }
      return transition(...args);
    });
    const enqueueTurn = vi.fn(async () => null);
    const sendToUser = vi.fn(async () => undefined);
    const work = processRun({ ...deps, memoryExtraction: { enqueueTurn } as unknown as RunWorkerDeps['memoryExtraction'],
      signalr: { sendToUser } as unknown as RunWorkerDeps['signalr'],
    }, 't1', 'r1');
    if (state === 'failed') await expect(work).rejects.toThrow('Terminal persistence unavailable');
    else await work;
    expect(enqueueTurn).toHaveBeenCalledTimes(state === 'confirmed' ? 1 : 0);
    const completePushes = sendToUser.mock.calls.filter(call => {
      const [, target, payload] = call as unknown as [string, string, { message?: { status?: string } }];
      return target === 'thread' || payload.message?.status === 'complete';
    });
    expect(completePushes).toHaveLength(state === 'confirmed' ? 2 : 0);
  });

  it('keeps snapshot ownership reads off throttled token updates while retaining final content', async () => {
    await seed(ctx);
    const reads = vi.spyOn(ctx.threadStore, 'get');
    let burstReads = -1;
    const agent: RunAgentFn = async function* () {
      yield { type: 'text', delta: 'First' };
      const before = reads.mock.calls.length;
      for (let index = 0; index < 20; index++) yield { type: 'text', delta: ' chunk' };
      burstReads = reads.mock.calls.length - before;
      yield { type: 'done' };
    };
    await processRun({ ...ctx.deps(agent), flushIntervalMs: 60_000 }, 't1', 'r1');
    expect(burstReads).toBe(0);
    expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({ status: 'complete', content: 'First' + ' chunk'.repeat(20) });
  });

  it.each(['done', 'error'] as const)('closes the agent iterator at the %s marker without consuming later events', async terminal => {
    await seed(ctx);
    let resumedAfterTerminal = false;
    let closed = false;
    const agent: RunAgentFn = async function* () {
      try {
        yield { type: 'text', delta: 'Accepted text' };
        if (terminal === 'done') yield { type: 'done' };
        else yield { type: 'error', message: 'Reported failure' };
        resumedAfterTerminal = true;
        yield { type: 'text', delta: ' unexpected late text' };
      } finally { closed = true; }
    };
    await processRun(ctx.deps(agent), 't1', 'r1');
    expect(resumedAfterTerminal).toBe(false);
    expect(closed).toBe(true);
    expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({
      content: 'Accepted text', status: terminal === 'done' ? 'complete' : 'error',
    });
  });

  it.each(['empty', 'partial', 'done'] as const)('requires an explicit terminal event before reporting successful completion: %s', async state => {
    await seed(ctx);
    const events: AgentEvent[] = state === 'empty' ? [] : [{ type: 'text', delta: 'Partial response' }];
    if (state === 'done') events.push({ type: 'done' });
    await processRun(ctx.deps(script(events)), 't1', 'r1');
    expect(await ctx.runStore.get('t1', 'r1')).toMatchObject({ status: state === 'done' ? 'complete' : 'error' });
    expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({
      status: state === 'done' ? 'complete' : 'error', content: state === 'empty' ? '' : 'Partial response',
    });
  });

  it.each(['thread-read', 'message-write', 'final-thread-read'] as const)('clears the owned heartbeat when %s fails', async stage => {
    await seed(ctx);
    const intervals = vi.spyOn(globalThis, 'setInterval');
    const clear = vi.spyOn(globalThis, 'clearInterval');
    if (stage === 'thread-read') vi.spyOn(ctx.threadStore, 'get').mockRejectedValueOnce(new Error('Read unavailable'));
    if (stage === 'message-write') vi.spyOn(ctx.workerMessageStore, 'append').mockRejectedValue(new Error('Write unavailable'));
    if (stage === 'final-thread-read') vi.spyOn(ctx.threadStore, 'getForUpdate').mockRejectedValueOnce(new Error('Read unavailable'));
    try {
      await expect(processRun(ctx.deps(script([{ type: 'text', delta: 'Response' }, { type: 'done' }])), 't1', 'r1')).rejects.toThrow('unavailable');
      const heartbeat = intervals.mock.results[0].value;
      expect(clear).toHaveBeenCalledWith(heartbeat);
    } finally {
      for (const result of intervals.mock.results) if (result.type === 'return') clearInterval(result.value);
      clear.mockRestore();
      intervals.mockRestore();
    }
  });

  it.each(['credentials', 'settings'].flatMap(stage =>
    ['cancel', 'execution', 'delete-thread'].map(change => ({ stage, change })),
  ))('does not begin provider preparation after liveness changes: %j', async ({ stage, change }) => {
    const original = await seed(ctx, 'queued', ['code_interpreter'], 'please use /pdf');
    await ctx.runStore.put({ ...original, prompt: { text: 'please use /pdf' } });
    const revoke = async () => {
      const current = (await ctx.runStore.get('t1', 'r1'))!;
      if (change === 'cancel') await ctx.runStore.put({ ...current, status: 'cancel_requested' });
      if (change === 'execution') await ctx.runStore.put({ ...current, executionToken: 'replacement' });
      if (change === 'delete-thread') await ctx.threadStore.put({ ...(await ctx.threadStore.get('userA', 't1'))!, deletedAt: ctx.clock.now() });
    };
    const agent = vi.fn<RunAgentFn>(() => script([{ type: 'done' }])({} as RunAgentParams));
    const routeTurn = vi.fn(async () => null);
    const buildForRun = vi.fn(async () => ({ memories: [], threadSummaries: [], sourceRefs: [], tokenEstimate: 0, latencyBudgetMs: 250, retrievalMode: 'empty' }));
    const ensure = vi.fn(async () => ({ fileIds: [], skills: [] }));
    await processRun({ ...ctx.deps(agent), routeTurn,
      credentials: { getDecrypted: async () => { const credentials = await ctx.credentials.getDecrypted(); if (stage === 'credentials') await revoke(); return credentials; } },
      settings: { get: async () => { if (stage === 'settings') await revoke(); return DEFAULT_SETTINGS; } },
      memoryContext: { buildForRun } as unknown as MemoryContextService,
      resolveSkills: async () => DEFAULT_SKILLS, skillProvisioner: { ensure },
    }, 't1', 'r1');
    expect(buildForRun).not.toHaveBeenCalled();
    expect(routeTurn).not.toHaveBeenCalled();
    expect(ensure).not.toHaveBeenCalled();
    expect(agent).not.toHaveBeenCalled();
  });

  it.each(['stream', 'tool', 'final-thread-read'].flatMap(stage =>
    ['complete', 'error'].map(status => ({ stage, status: status as 'complete' | 'error' })),
  ))('does not publish or execute tools after the same execution becomes terminal: %j', async ({ stage, status }) => {
    const local = setup({ tavily: true });
    await seed(local, 'queued', ['web_search']);
    let terminal: RunRecord | undefined;
    const finishElsewhere = async () => {
      terminal = { ...(await local.runStore.get('t1', 'r1'))!, status, endedAt: '2026-06-01T01:00:00Z' };
      await local.runStore.put(terminal);
      await local.messageStore.append({ id: 'am1', threadId: 't1', userId: 'userA', role: 'assistant',
        status, content: 'Existing terminal response', createdAt: '2026-06-01T01:00:00Z', deletedAt: null });
    };
    if (stage === 'final-thread-read') {
      const get = local.threadStore.getForUpdate.bind(local.threadStore);
      vi.spyOn(local.threadStore, 'getForUpdate').mockImplementationOnce(async (...args) => { await finishElsewhere(); return get(...args); });
    }
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 }));
    const agent: RunAgentFn = async function* (params) {
      if (stage !== 'final-thread-read') await finishElsewhere();
      if (stage === 'tool') await params.execute?.('web_search', { query: 'must not execute' }).catch(() => undefined);
      yield { type: 'text', delta: 'Obsolete response' };
      yield { type: 'done' };
    };
    await processRun({ ...local.deps(agent), fetchImpl }, 't1', 'r1');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await local.runStore.get('t1', 'r1')).toEqual(terminal);
    expect(await local.messageStore.get('t1', 'am1')).toMatchObject({ content: 'Existing terminal response', status });
    expect((await local.threadStore.get('userA', 't1'))?.lastMessagePreview).not.toBe('Obsolete response');
  });

  it.each(['missing-etag', 'replacement', 'success'] as const)('conditionally binds start acknowledgements to the dispatched execution: %s', async state => {
    const original = { ...(await seed(ctx)), executionToken: 'original' };
    const current = { ...original, executionToken: state === 'replacement' ? 'replacement' : original.executionToken };
    const memory = new InMemoryRunStore();
    await memory.put(current);
    const replace = vi.fn(async (record, options) => {
      expect(options).toEqual({ accessCondition: { type: 'IfMatch', condition: 'etag' } });
      return { resource: record };
    });
    const cosmos = new CosmosRunStore({ item: () => ({ read: async () => ({ resource: {
      ...current, id: ownerScopedDocumentId('run', current.userId, current.id), runId: current.id,
      _etag: state === 'missing-etag' ? undefined : 'etag',
    } }), replace }) } as never);
    const acknowledgement = cosmos.acknowledgeStart('userA', 't1', 'r1', 'new-instance', original);
    if (state === 'missing-etag') await expect(acknowledgement).rejects.toThrow('Run start acknowledgement requires a Cosmos ETag.');
    else if (state === 'replacement') {
      expect(await acknowledgement).toBeNull();
      expect(await memory.acknowledgeStart('userA', 't1', 'r1', 'new-instance', original)).toBeNull();
      expect(await memory.get('userA', 't1', 'r1')).toEqual(current);
    } else expect(await acknowledgement).toMatchObject({ instanceId: 'new-instance', executionToken: 'original' });
    expect(replace).toHaveBeenCalledTimes(state === 'success' ? 1 : 0);
  });

  it.each(['conflict', 'missing-slot-etag', 'success'] as const)('keeps terminal run and active-slot publication atomic: %s', async state => {
    const run = { ...(await seed(ctx)), status: 'running' as const };
    const runDocumentId = ownerScopedDocumentId('run', 'userA', 'r1');
    const slotId = ownerScopedDocumentId('run-slot', 'userA', 'active');
    const replace = vi.fn().mockResolvedValue({ resource: { ...run, id: runDocumentId, runId: run.id, status: 'complete' } });
    const batch = vi.fn().mockResolvedValue({ result: state === 'conflict' ? [{ statusCode: 412 }, { statusCode: 424 }] : [{ statusCode: 200 }, { statusCode: 204 }] });
    const store = new CosmosRunStore({ item: (id: string) => ({ read: async () => ({ resource: id === runDocumentId ?
      { ...run, id, runId: run.id, _etag: 'run-etag' } :
      { id: slotId, userId: 'userA', runId: run.id, _etag: state === 'missing-slot-etag' ? undefined : 'slot-etag' } }), replace }), items: { batch },
    } as never);
    const result = store.transition('userA', 't1', 'r1', ['running'], { status: 'complete' }, run);
    if (state === 'missing-slot-etag') {
      await expect(result).rejects.toThrow('Run slot release requires a Cosmos ETag.');
      expect(batch).not.toHaveBeenCalled();
    } else {
      expect(await result).toMatchObject({ outcome: state === 'success' ? 'updated' : 'unchanged', run: { status: state === 'success' ? 'complete' : 'running' } });
      expect(batch.mock.calls[0][0][1]).toEqual({ operationType: 'Delete', id: slotId, ifMatch: 'slot-etag' });
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([[], [201], [201, 201, 201], [201, 201, 201, 201, 201], undefined].map(statuses => ({ statuses })))('never acknowledges a run admission from an incomplete transaction receipt: %j', async ({ statuses }) => {
    const run = { ...(await seed(ctx)), releaseId: 'release', executionToken: 'token', dispatchAttempt: 1 };
    const store = new CosmosRunStore({ items: { batch: async () => ({ result: statuses?.map(statusCode => ({ statusCode })) }) } } as never);
    await expect(store.admit({ run, idempotencyKey: 'client-id', requestFingerprint: 'fingerprint', legacyMessageExists: false })).rejects.toThrow();
  });

  it.each([[], [200], [200, 200, 200]].map(statuses => ({ statuses })))('never acknowledges finalization from an incomplete transaction receipt: %j', async ({ statuses }) => {
    const run = { ...(await seed(ctx)), status: 'running' as const };
    const runDocumentId = ownerScopedDocumentId('run', 'userA', 'r1');
    const replace = vi.fn();
    const store = new CosmosRunStore({ item: (id: string) => ({ read: async () => ({ resource: id === runDocumentId ?
      { ...run, id, runId: 'r1', _etag: 'run-etag' } : { id, userId: 'userA', runId: 'r1', _etag: 'slot-etag' } }), replace }),
      items: { batch: async () => ({ result: statuses.map(statusCode => ({ statusCode })) }) },
    } as never);
    await expect(store.transition('userA', 't1', 'r1', ['running'], { status: 'complete' }, run)).rejects.toThrow();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['releaseId', 'executionToken', 'dispatchAttempt', 'startedAt', 'assistantMessageId'] as const)('requires the expected %s for store transitions', async field => {
    const original = { ...(await seed(ctx)), status: 'running' as const, releaseId: 'release', executionToken: 'token', dispatchAttempt: 1, startedAt: '2026-06-01T01:00:00Z' };
    const current = { ...original, [field]: field === 'dispatchAttempt' ? 2 : 'replacement' } as RunRecord;
    const memory = new InMemoryRunStore();
    await memory.put(current);
    const replace = vi.fn();
    const cosmos = new CosmosRunStore({ item: () => ({ read: async () => ({ resource: {
      ...current, id: ownerScopedDocumentId('run', current.userId, current.id), runId: current.id, _etag: 'etag',
    } }), replace }) } as never);
    for (const store of [memory, cosmos]) {
      const result = await store.transition('userA', 't1', 'r1', ['running'], { heartbeatAt: ctx.clock.now() }, original);
      expect(result).toMatchObject({ outcome: 'unchanged', run: { [field]: current[field] } });
    }
    expect(replace).not.toHaveBeenCalled();
    expect(await memory.get('userA', 't1', 'r1')).toEqual(current);
  });

  it('retains a concurrent Cosmos execution after a conditional transition conflict', async () => {
    const original = { ...(await seed(ctx)), status: 'running' as const, executionToken: 'original' };
    let current = original;
    const replacement = { ...original, executionToken: 'replacement' };
    const replace = vi.fn(async (_record, options) => {
      expect(options).toEqual({ accessCondition: { type: 'IfMatch', condition: 'etag-original' } });
      current = replacement;
      throw { code: 412 };
    });
    const cosmos = new CosmosRunStore({ item: () => ({ read: async () => ({ resource: {
      ...current, id: ownerScopedDocumentId('run', current.userId, current.id), runId: current.id, _etag: 'etag-original',
    } }), replace }) } as never);
    expect(await cosmos.transition('userA', 't1', 'r1', ['running'], { heartbeatAt: 'later' }, original)).toMatchObject({ outcome: 'unchanged', run: replacement });
    expect(replace).toHaveBeenCalledOnce();
  });

  it('does not claim a replacement that appears after the queued read', async () => {
    const original = await seed(ctx);
    const agent = vi.fn<RunAgentFn>(() => script([{ type: 'done' }])({} as RunAgentParams));
    const deps = ctx.deps(agent);
    const transition = deps.runStore.transition.bind(deps.runStore);
    const replacement = { ...original, executionToken: 'replacement' };
    vi.spyOn(deps.runStore, 'transition').mockImplementationOnce(async (...args) => {
      await ctx.runStore.put(replacement);
      return transition(...args);
    });
    await processRun(deps, 't1', 'r1');
    expect(agent).not.toHaveBeenCalled();
    expect(await ctx.runStore.get('t1', 'r1')).toEqual(replacement);
    expect(await ctx.messageStore.get('t1', 'am1')).toBeNull();
  });

  it.each(['stream', 'final-thread-read', 'provider-retry'] as const)('leaves the replacement execution and message untouched after takeover during %s', async stage => {
    await seed(ctx);
    let replacement: RunRecord | undefined;
    const takeover = async () => {
      replacement = { ...(await ctx.runStore.get('t1', 'r1'))!, executionToken: 'replacement-execution', startedAt: '2026-06-01T01:00:00Z' };
      await ctx.runStore.put(replacement);
      await ctx.messageStore.append({ id: 'am1', threadId: 't1', userId: 'userA', role: 'assistant', status: 'streaming', content: 'Replacement response', createdAt: '2026-06-01T01:00:00Z', deletedAt: null });
    };
    if (stage === 'final-thread-read') {
      const get = ctx.threadStore.getForUpdate.bind(ctx.threadStore);
      vi.spyOn(ctx.threadStore, 'getForUpdate').mockImplementationOnce(async (...args) => { await takeover(); return get(...args); });
    }
    let attempts = 0;
    const agent: RunAgentFn = async function* () {
      attempts++;
      if (stage === 'stream' || stage === 'provider-retry') await takeover();
      if (stage === 'provider-retry') throw new Error('Old execution failed');
      yield { type: 'text', delta: 'Obsolete response' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(agent), 't1', 'r1');
    expect(attempts).toBe(1);
    expect(await ctx.runStore.get('t1', 'r1')).toEqual(replacement);
    expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({ content: 'Replacement response', status: 'streaming' });
    expect((await ctx.threadStore.get('userA', 't1'))?.lastMessagePreview).not.toBe('Obsolete response');
  });

  it.each(['listing', 'download', 'upload', 'library-read', 'library-write'].flatMap(stage => ['cancel', 'delete-thread'].map(change => ({ stage, change }))))('stops subsequent artifact effects after liveness changes: %j', async ({ stage, change }) => {
    await seed(ctx);
    let revoked = false;
    const revoke = async () => {
      if (revoked) return;
      revoked = true;
      if (change === 'cancel') await ctx.runStore.put({ ...(await ctx.runStore.get('t1', 'r1'))!, status: 'cancel_requested' });
      else await ctx.threadStore.put({ ...(await ctx.threadStore.get('userA', 't1'))!, deletedAt: ctx.clock.now() });
    };
    const originalFetch = artifactFetch();
    const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
      const response = await originalFetch(url, init);
      if ((stage === 'listing' && !String(url).includes('/content')) || (stage === 'download' && String(url).includes('/content'))) await revoke();
      return response;
    }) as typeof fetch;
    const uploadArtifact = vi.fn(async () => { if (stage === 'upload') await revoke(); return 'userA/artifact.pdf'; });
    const put = vi.fn(async () => { if (stage === 'library-write') await revoke(); });
    await processRun({
      ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
      fetchImpl, uploadArtifact, artifactCaptureAttempts: 1,
      libraryStore: { get: async () => { if (stage === 'library-read') await revoke(); return null; }, put, createIfAbsent: put } as unknown as LibraryStore,
    }, 't1', 'r1');
    expect(uploadArtifact).toHaveBeenCalledTimes(['upload', 'library-write'].includes(stage) ? 1 : 0);
    expect(put).toHaveBeenCalledTimes(stage === 'library-write' ? 1 : 0);
    expect((await ctx.messageStore.get('t1', 'am1'))?.artifacts ?? []).toEqual([]);
    expect((await ctx.threadStore.get('userA', 't1'))?.files ?? []).toEqual([]);
  });

  it.each(['retry', 'skills'] as const)('omits raw provider errors from %s diagnostics while preserving recovery', async stage => {
    await seed(ctx, 'queued', ['code_interpreter'], 'please format this with /pdf');
    const logs = [vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
    const privateError = 'Private-source content; Authorization=synthetic-secret';
    let attempts = 0;
    const agent: RunAgentFn = async function* () {
      attempts++;
      if (stage === 'retry' && attempts === 1) throw new Error(privateError);
      yield { type: 'text', delta: 'Recovered response' };
      yield { type: 'done' };
    };
    try {
      await processRun({ ...ctx.deps(agent),
        ...(stage === 'skills' ? { resolveSkills: async () => DEFAULT_SKILLS,
          skillProvisioner: { ensure: async () => { throw new Error(privateError); } } } : {}),
      }, 't1', 'r1');
      expect(JSON.stringify(logs.flatMap(log => log.mock.calls))).not.toContain(privateError);
      expect(logs.reduce((count, log) => count + log.mock.calls.length, 0)).toBeGreaterThan(0);
      expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({ content: 'Recovered response', status: 'complete' });
    } finally { logs.forEach(log => log.mockRestore()); }
  });

  it.each(['success', 'list-failed', 'download-failed', 'upload-failed'] as const)('keeps artifact diagnostics free of filenames, identifiers, paths and error payloads: %s', async stage => {
    await seed(ctx);
    const logs = [vi.spyOn(console, 'log').mockImplementation(() => {}),
      vi.spyOn(console, 'warn').mockImplementation(() => {}), vi.spyOn(console, 'error').mockImplementation(() => {})];
    try {
      const originalFetch = artifactFetch();
      const fetchImpl = (async (url: string | URL, init?: RequestInit) => {
        if (stage === 'list-failed' || (stage === 'download-failed' && String(url).includes('/content'))) {
          throw new Error('Private-document detail; credential=synthetic-secret');
        }
        return originalFetch(url, init);
      }) as typeof fetch;
      await processRun({
        ...ctx.deps(script([{ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x' }, { type: 'done' }])),
        fetchImpl, artifactCaptureAttempts: 1,
        uploadArtifact: async () => {
          if (stage === 'upload-failed') throw new Error('Private-document detail; credential=synthetic-secret');
          return 'userA/private-document/report.pdf';
        },
      }, 't1', 'r1');
      const diagnostics = JSON.stringify(logs.flatMap(log => log.mock.calls));
      for (const forbidden of ['report.pdf', 'input.pdf', '/mnt/data', 'cntr_x', 'private-document', 'synthetic-secret', 'Private-document']) {
        expect(diagnostics).not.toContain(forbidden);
      }
      const message = await ctx.messageStore.get('t1', 'am1');
      if (stage === 'success') expect(message?.artifacts?.[0]).toMatchObject({ name: 'report.pdf', blobPath: 'userA/private-document/report.pdf' });
      else expect(message?.artifacts ?? []).toEqual([]);
    } finally { logs.forEach(log => log.mockRestore()); }
  });

  it('keeps the admitted logical assistant time in every persisted snapshot without changing server cursor time', async () => {
    const run = await seed(ctx);
    const messageOrder = { user: '2026-09-11T12:00:00.000Z', assistant: '2026-09-11T12:00:00.001Z' };
    await ctx.runStore.put({ ...run, messageOrder } as RunRecord);
    const snapshots: MessageRecord[] = [];
    const append = ctx.workerMessageStore.append.bind(ctx.workerMessageStore);
    vi.spyOn(ctx.workerMessageStore, 'append').mockImplementation(async record => {
      if (record.role === 'assistant') snapshots.push(structuredClone(record));
      return append(record);
    });
    await processRun(ctx.deps(script([{ type: 'text', delta: 'First' }, { type: 'text', delta: ' second' }, { type: 'done' }])), 't1', 'r1');
    expect(snapshots.length).toBeGreaterThan(1);
    expect(snapshots.every(record => record.orderAt === messageOrder.assistant)).toBe(true);
    expect(snapshots.every(record => record.createdAt.startsWith('2026-06-01'))).toBe(true);
    expect(snapshots.at(-1)?.status).toBe('complete');
    expect((await ctx.runStore.get('t1', 'r1'))?.createdAt).toBe(run.createdAt);
  });

  it('persists content-free usage before a later provider error', async () => {
    await seed(ctx);
    const observation = observeAgentUsage('resp-usage', 'model-v1', { inputTokens: 10, outputTokens: 4, totalTokens: 14 });
    let persistedBeforeFailure = false;
    const runAgent: RunAgentFn = async function* () {
      yield { type: 'usage', observation };
      persistedBeforeFailure = (await ctx.runStore.get('t1', 'r1'))?.agentUsage?.observations.length === 1;
      yield { type: 'error', message: 'Provider failed after a completed iteration' };
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect(persistedBeforeFailure).toBe(true);
    expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage).toEqual({ scope: 'agent-responses-only', observations: [observation], truncated: false });
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('error');
  });

  it('preserves already-recorded usage when cancellation follows it', async () => {
    await seed(ctx);
    const observation = observeAgentUsage('response', null, null);
    const runAgent: RunAgentFn = async function* () {
      yield { type: 'usage', observation };
      const current = (await ctx.runStore.get('t1', 'r1'))!;
      await ctx.runStore.put({ ...current, status: 'cancel_requested' });
      yield { type: 'done' };
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage?.observations).toEqual([observation]);
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('canceled');
  });

  it('does not persist new usage after cancellation has won', async () => {
    await seed(ctx);
    const runAgent: RunAgentFn = async function* () {
      const current = (await ctx.runStore.get('t1', 'r1'))!;
      await ctx.runStore.put({ ...current, status: 'cancel_requested' });
      yield { type: 'usage', observation: observeAgentUsage('response', 'model', { inputTokens: 1, outputTokens: 1, totalTokens: 2 }) };
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage).toBeUndefined();
  });

  it('deduplicates usage and retains legacy runs without fabricated zero totals', async () => {
    await seed(ctx);
    const observation = observeAgentUsage('response', 'model', { inputTokens: 0, outputTokens: 0, totalTokens: 0 });
    await processRun(ctx.deps(script([{ type: 'usage', observation }, { type: 'usage', observation }, { type: 'done' }])), 't1', 'r1');
    expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage?.observations).toEqual([observation]);
  });

  it('rereads and retries one usage transition after running-state contention', async () => {
    await seed(ctx);
    const observation = observeAgentUsage('response', 'model', { inputTokens: 1, outputTokens: 1, totalTokens: 2 });
    const deps = ctx.deps(script([{ type: 'usage', observation }, { type: 'done' }]));
    const transition = deps.runStore.transition.bind(deps.runStore);
    let attempts = 0;
    vi.spyOn(deps.runStore, 'transition').mockImplementation(async (owner, thread, run, statuses, patch) => {
      if (patch.agentUsage && ++attempts === 1) return { outcome: 'unchanged', run: (await deps.runStore.get(owner, thread, run))! };
      return transition(owner, thread, run, statuses, patch);
    });
    await processRun(deps, 't1', 'r1');
    expect(attempts).toBe(2);
    expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage?.observations).toEqual([observation]);
  });

  it('does not claim usage persistence when both conditional attempts lose', async () => {
    await seed(ctx);
    const deps = ctx.deps(script([{ type: 'usage', observation: observeAgentUsage('response', 'model', null) }, { type: 'done' }]));
    const transition = deps.runStore.transition.bind(deps.runStore);
    let attempts = 0;
    vi.spyOn(deps.runStore, 'transition').mockImplementation(async (owner, thread, run, statuses, patch) => {
      if (patch.agentUsage) { attempts += 1; return { outcome: 'unchanged', run: (await deps.runStore.get(owner, thread, run))! }; }
      return transition(owner, thread, run, statuses, patch);
    });
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      await processRun(deps, 't1', 'r1');
      expect(attempts).toBe(2);
      expect((await ctx.runStore.get('t1', 'r1'))?.agentUsage).toBeUndefined();
      expect(warning).toHaveBeenCalledWith({ event: 'usage.observation_unconfirmed', scope: 'agent-responses-only' });
    } finally { warning.mockRestore(); }
  });

  it('rejects a queue delivery whose release or execution token no longer matches', async () => {
    const record = await seed(ctx);
    await ctx.runStore.put({ ...record, releaseId: 'release-new', executionToken: 'token-new', dispatchAttempt: 2 });
    const runAgent = vi.fn(script([{ type: 'text', delta: 'must not run' }, { type: 'done' }]));

    await processRunForOwner(ctx.deps(runAgent), 'userA', 't1', 'r1', {
      releaseId: 'release-old', executionToken: 'token-old', attempt: 1,
    });

    expect(runAgent).not.toHaveBeenCalled();
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('queued');
  });

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
    expect(Date.parse(msg?.createdAt ?? '')).toBeGreaterThan(Date.parse(msg?.orderAt ?? '')); // delta-sync cursor advances

    const run = await ctx.runStore.get('t1', 'r1');
    expect(run?.status).toBe('complete');
    expect((await ctx.threadStore.get('userA', 't1'))?.lastMessagePreview).toBe('Hi there');
  });

  it('applies the vault reasoning effort to the chat run', async () => {
    const local = setup({ reasoningEffort: 'high' });
    await seed(local);
    const runAgent = vi.fn(script([{ type: 'done' }]));
    await processRun(local.deps(runAgent), 't1', 'r1');
    expect(runAgent.mock.calls[0][0].reasoning).toEqual({ effort: 'high' });
  });

  it('accumulates deduped web images from the agent onto the assistant message', async () => {
    await seed(ctx);
    await processRun(
      ctx.deps(
        script([
          { type: 'text', delta: 'Here are some cats' },
          { type: 'webImage', webImage: { url: 'https://img.example/a.jpg', description: 'a cat' } },
          { type: 'webImage', webImage: { url: 'https://img.example/a.jpg' } }, // duplicate URL — ignored
          { type: 'webImage', webImage: { url: 'https://img.example/b.jpg' } },
          { type: 'done' },
        ]),
      ),
      't1',
      'r1',
    );
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.webImages).toHaveLength(2);
    expect(msg?.webImages?.[0]).toMatchObject({ url: 'https://img.example/a.jpg', description: 'a cat' });
    expect(msg?.webImages?.[1]).toMatchObject({ url: 'https://img.example/b.jpg' });
    expect(msg?.webImages?.[0].id).toMatch(/^wimg1-/);
  });

  it('retries cleanly when the first agent attempt stalls with no output', async () => {
    await seed(ctx);
    let calls = 0;
    const flaky: RunAgentFn = async function* (): AsyncGenerator<AgentEvent> {
      calls++;
      if (calls === 1) throw new Error('This operation was aborted'); // simulate the upstream stall→abort
      yield { type: 'text', delta: 'Recovered' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(flaky), 't1', 'r1');

    expect(calls).toBe(2); // first attempt stalled, second succeeded
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.content).toBe('Recovered');
    expect(msg?.status).toBe('complete');
  });

  it('fails the run as error (no duplicate output) when every attempt stalls', async () => {
    await seed(ctx);
    let calls = 0;
    const alwaysStall: RunAgentFn = async function* (): AsyncGenerator<AgentEvent> {
      calls++;
      throw new Error('This operation was aborted');
    };
    await processRun(ctx.deps(alwaysStall), 't1', 'r1');

    expect(calls).toBe(3); // first attempt + two degrading retries (full → no-CI → no-tools), then give up
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.status).toBe('error');
    expect(msg?.content).toBe('');
  });

  it('degrades tools (drops code_interpreter) on the retry after a stall', async () => {
    await seed(ctx, 'queued', ['code_interpreter']);
    let calls = 0;
    const hadCodeInterpreter: boolean[] = [];
    const flaky: RunAgentFn = async function* (params): AsyncGenerator<AgentEvent> {
      calls++;
      hadCodeInterpreter.push(params.tools.some((t) => t.type === 'code_interpreter'));
      if (calls === 1) throw new Error('This operation was aborted');
      yield { type: 'text', delta: 'recovered' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(flaky), 't1', 'r1');

    expect(calls).toBe(2);
    expect(hadCodeInterpreter[0]).toBe(true); // attempt 1 offers the full set incl. code_interpreter
    expect(hadCodeInterpreter[1]).toBe(false); // attempt 2 drops code_interpreter so the stream recovers
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.content).toBe('recovered');
    expect(msg?.status).toBe('complete');
  });

  it('offers only generate_image when the semantic manager selects the image specialist', async () => {
    const ctx2 = setup({ image: true });
    await seed(
      ctx2,
      'queued',
      ['code_interpreter', 'generate_image'],
      'Generate a watercolor image of a woman; use the uploaded photo as reference',
    );
    let params: RunAgentParams | undefined;
    const capture: RunAgentFn = async function* (next): AsyncGenerator<AgentEvent> {
      params = next;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    };
    const routeTurn: NonNullable<RunWorkerDeps['routeTurn']> = async () => ({
      action: 'generate_image',
      imageAction: 'generate',
      referenceImageIds: [],
      rationale: 'The user requested a visual output.',
    });
    await processRun({ ...ctx2.deps(capture), routeTurn }, 't1', 'r1');
    expect(params!.tools.some((t) => t.type === 'code_interpreter')).toBe(false);
    expect(params!.tools.some((t) => t.name === 'generate_image')).toBe(true);
    expect(params).toMatchObject({ toolChoice: 'required', requiredToolName: 'generate_image' });
  });

  it('offers only code_interpreter when the semantic manager selects programmatic output', async () => {
    const ctx2 = setup({ image: true });
    await seed(ctx2, 'queued', ['code_interpreter', 'generate_image'], 'create a bar chart image from this CSV of sales');
    let tools: Array<{ type: string; name?: string }> = [];
    const capture: RunAgentFn = async function* (params): AsyncGenerator<AgentEvent> {
      tools = params.tools as Array<{ type: string; name?: string }>;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    };
    const routeTurn: NonNullable<RunWorkerDeps['routeTurn']> = async () => ({
      action: 'code_interpreter',
      imageAction: 'none',
      referenceImageIds: [],
      rationale: 'The user requested a data-driven chart.',
    });
    await processRun({ ...ctx2.deps(capture), routeTurn }, 't1', 'r1');
    expect(tools.some((t) => t.type === 'code_interpreter')).toBe(true);
    expect(tools.some((t) => t.name === 'generate_image')).toBe(false);
  });

  it('exposes no tools when the semantic manager selects a direct response', async () => {
    const ctx2 = setup({ image: true, tavily: true });
    await seed(ctx2, 'queued', ['web_search', 'code_interpreter', 'generate_image'], 'What do you think?');
    let params: RunAgentParams | undefined;
    const capture: RunAgentFn = async function* (next): AsyncGenerator<AgentEvent> {
      params = next;
      yield { type: 'text', delta: 'A direct answer.' };
      yield { type: 'done' };
    };
    const routeTurn: NonNullable<RunWorkerDeps['routeTurn']> = async () => ({
      action: 'respond',
      imageAction: 'none',
      referenceImageIds: [],
      rationale: 'No external action is required.',
    });

    await processRun({ ...ctx2.deps(capture), routeTurn }, 't1', 'r1');

    expect(params!.tools).toEqual([]);
    expect(params).toMatchObject({ toolChoice: 'none' });
    expect(params!.requiredToolName).toBeUndefined();
  });

  it('routes with the complete thread and preserves old uploaded/generated image ids', async () => {
    const ctx2 = setup({ image: true });
    await seed(ctx2, 'queued', ['code_interpreter', 'generate_image'], 'Make another one with eight groups in two columns.');
    const latest = await ctx2.messageStore.get('t1', 'um1');
    await ctx2.messageStore.append({ ...latest!, createdAt: '2026-06-01T00:00:05Z', orderAt: '2026-06-01T00:00:05Z' });
    await ctx2.messageStore.append({
      id: 'u-old',
      threadId: 't1',
      userId: 'userA',
      role: 'user',
      content: 'Use this exact sprite template and character reference.',
      status: 'complete',
      attachments: [
        { id: 'template-img', kind: 'image', blobPath: 'userA/t1/template.png', mime: 'image/png', bytes: 10, name: 'template.png', reuseMode: 'reference' },
        { id: 'character-img', kind: 'image', blobPath: 'userA/t1/character.png', mime: 'image/png', bytes: 10, name: 'character.png' },
      ],
      createdAt: '2026-06-01T00:00:01Z',
      orderAt: '2026-06-01T00:00:01Z',
      deletedAt: null,
    });
    await ctx2.messageStore.append({
      id: 'a-old',
      threadId: 't1',
      userId: 'userA',
      role: 'assistant',
      content: 'Generated the first version.',
      status: 'complete',
      images: [{
        id: 'generated-v1',
        blobPath: 'userA/t1/generated-v1.png',
        prompt: 'First worksheet image with uniform spacing.',
        size: '1024x1536',
        outputFormat: 'png',
        createdAt: '2026-06-01T00:00:02Z',
      }],
      createdAt: '2026-06-01T00:00:02Z',
      orderAt: '2026-06-01T00:00:02Z',
      deletedAt: null,
    });
    let routeParams: Parameters<NonNullable<RunWorkerDeps['routeTurn']>>[0] | undefined;
    const routeTurn: NonNullable<RunWorkerDeps['routeTurn']> = async (params) => {
      routeParams = params;
      return {
        action: 'generate_image',
        imageAction: 'edit',
        referenceImageIds: ['generated-v1', 'template-img', 'character-img'],
        rationale: 'The latest request continues the prior image workflow.',
      };
    };
    let agentParams: RunAgentParams | undefined;
    const capture: RunAgentFn = async function* (params): AsyncGenerator<AgentEvent> {
      agentParams = params;
      yield { type: 'done' };
    };

    await processRun({ ...ctx2.deps(capture), routeTurn }, 't1', 'r1');

    expect(routeParams!.imageIds).toEqual(['template-img', 'character-img', 'generated-v1']);
    const routedTranscript = routeParams!.turns.map((turn) => turn.text).join('\n');
    expect(routedTranscript).toContain('[Uploaded image id="template-img" name="template.png" reuse_mode=reference]');
    expect(routedTranscript).toContain('[Uploaded image id="character-img" name="character.png"]');
    expect(routedTranscript).toContain('[Generated image id="generated-v1"');
    expect(routedTranscript).toContain('Make another one with eight groups in two columns.');
    expect(agentParams).toMatchObject({ toolChoice: 'required', requiredToolName: 'generate_image' });
    expect(agentParams!.tools.map((tool) => tool.type === 'function' ? tool.name : tool.type)).toEqual(['generate_image']);
    expect(agentParams!.turns[0].text).toContain('generated-v1, template-img, character-img');
  });

  it('skips skill mounting for an ordinary prompt (keeps the fast code_interpreter path)', async () => {
    await seed(ctx, 'queued', ['code_interpreter'], 'how are you today?');
    let ensureCalls = 0;
    const deps: RunWorkerDeps = {
      ...ctx.deps(script([{ type: 'text', delta: 'hi' }, { type: 'done' }])),
      skillProvisioner: { ensure: async () => { ensureCalls++; return { fileIds: ['s1'], skills: [] }; } },
      resolveSkills: async () => DEFAULT_SKILLS,
    };
    await processRun(deps, 't1', 'r1');
    expect(ensureCalls).toBe(0); // no skill keyword/tag → container mounts no skill files
  });

  it('mounts skills when the prompt explicitly tags one', async () => {
    const run = await seed(ctx, 'queued', ['code_interpreter'], 'please format this with /pdf');
    let ensureCalls = 0;
    const owners: string[] = [];
    const deps: RunWorkerDeps = {
      ...ctx.deps(script([{ type: 'text', delta: 'hi' }, { type: 'done' }])),
      skillProvisioner: {
        ensure: async (_creds, _skills, userId) => {
          ensureCalls++;
          owners.push(userId);
          return { fileIds: ['s1'], skills: [{ name: 'pdf', description: 'd', path: '/mnt/data/skills/pdf/' }] };
        },
      },
      resolveSkills: async () => DEFAULT_SKILLS,
    };
    await processRun(deps, 't1', 'r1');
    expect(ensureCalls).toBe(1); // explicit /pdf tag → skills provisioned + mounted
    expect(owners).toEqual([run.userId]);
  });

  it('drops function tools when skills are mounted (avoids the code_interpreter deadlock)', async () => {
    const ctx2 = setup({ tavily: true, image: true });
    await seed(ctx2, 'queued', ['web_search', 'generate_image', 'code_interpreter'], 'please use /pdf');
    let capturedTools: Array<{ type: string; name?: string }> = [];
    const runAgent: RunAgentFn = async function* (params): AsyncGenerator<AgentEvent> {
      capturedTools = params.tools as Array<{ type: string; name?: string }>;
      yield { type: 'text', delta: 'ok' };
      yield { type: 'done' };
    };
    const deps: RunWorkerDeps = {
      ...ctx2.deps(runAgent),
      skillProvisioner: { ensure: async () => ({ fileIds: ['s1'], skills: [{ name: 'pdf', description: 'd', path: '/mnt/data/skills/pdf/' }] }) },
      resolveSkills: async () => DEFAULT_SKILLS,
    };
    await processRun(deps, 't1', 'r1');

    const names = capturedTools.map((t) => t.name ?? t.type);
    expect(names).toContain('code_interpreter');
    expect(names).not.toContain('web_search');
    expect(names).not.toContain('generate_image');
  });

  it('uses the run model override when one is supplied', async () => {
    const run = await seed(ctx);
    await ctx.runStore.put({ ...run, model: 'gpt-5.4' });
    let seenModel = '';
    const runAgent: RunAgentFn = (params) => {
      seenModel = params.model;
      return script([{ type: 'done' }])({ ...params });
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect(seenModel).toBe('gpt-5.4');
  });

  it('captures a code-interpreter artifact onto the message, thread files, and tool call', async () => {
    await seed(ctx);
    const seededThread = await ctx.threadStore.get('userA', 't1');
    await ctx.threadStore.put({
      ...seededThread!,
      files: [
        { fileId: 'input-a', name: 'a.pdf', bytes: 10, status: 'ready', createdAt: '2026-06-01T00:00:00Z', blobPath: 'userA/t1/a.pdf', mime: 'application/pdf' },
        { fileId: 'input-b', name: 'b.csv', bytes: 20, status: 'ready', createdAt: '2026-06-01T00:00:01Z', blobPath: 'userA/t1/b.csv', mime: 'text/csv' },
      ],
    });
    const uploaded: Array<{ id: string; mime: string; bytes: number }> = [];
    const library = new Map<string, LibraryItemRecord>();
    const libraryStore = {
      get: async (_userId: string, id: string) => library.get(id) ?? null,
      put: async (item: LibraryItemRecord) => { library.set(item.id, item); return item; },
      createIfAbsent: async (item: LibraryItemRecord) => {
        if (library.has(item.id)) return null;
        library.set(item.id, item);
        return item;
      },
    } as unknown as LibraryStore;
    const uploadArtifact = async (
      userId: string,
      _threadId: string,
      artifactId: string,
      bytes: Uint8Array,
      mime: string,
    ): Promise<string> => {
      uploaded.push({ id: artifactId, mime, bytes: bytes.byteLength });
      return `${userId}/library/${libraryItemIdFor(userId, 'code_artifact', artifactId)}.pdf`;
    };

    await processRun(
      {
        ...ctx.deps(
          script([
            { type: 'tool', name: 'code_interpreter', status: 'running', callId: 'ci1', containerId: 'cntr_x' },
            { type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_x', result: 'code' },
            { type: 'text', delta: 'Here is your PDF.' },
            { type: 'done' },
          ]),
        ),
        uploadArtifact,
        libraryStore,
        fetchImpl: artifactFetch(),
      },
      't1',
      'r1',
    );

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.artifacts).toHaveLength(1); // only the assistant-sourced file, not the user input
    expect(msg?.artifacts?.[0]).toMatchObject({ name: 'report.pdf', mime: 'application/pdf', kind: 'pdf', bytes: 5 });
    expect(msg?.artifacts?.[0]).toMatchObject({
      libraryItemId: libraryItemIdFor('userA', 'code_artifact', msg!.artifacts![0].id),
      sourceItemIds: [
        libraryItemIdFor('userA', 'thread_document', 'input-a'),
        libraryItemIdFor('userA', 'thread_document', 'input-b'),
      ],
      version: 1,
      provenanceComplete: true,
    });
    const ci = msg?.toolCalls?.find((t) => t.id === 'ci1');
    expect(ci?.artifactIds).toEqual([msg?.artifacts?.[0].id]);

    const thread = await ctx.threadStore.get('userA', 't1');
    const artifactFile = thread?.files?.find((f) => f.kind === 'artifact');
    expect(artifactFile).toMatchObject({ name: 'report.pdf', mime: 'application/pdf', status: 'ready' });
    expect(uploaded).toEqual([{ id: msg?.artifacts?.[0].id, mime: 'application/pdf', bytes: 5 }]);
    expect(library.get(msg!.artifacts![0].libraryItemId!)).toMatchObject({ state: 'active', origin: 'code_artifact', blobPath: msg!.artifacts![0].blobPath });
  });

  it('retries code-interpreter capture when the generated PDF appears after the done event', async () => {
    await seed(ctx);
    const uploaded: string[] = [];
    let lists = 0;
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.includes('/files/late_pdf/content')) {
        return new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46]));
      }
      if (u.includes('/containers/cntr_late/files')) {
        lists++;
        return {
          ok: true,
          status: 200,
          json: async () => ({
            data: lists < 2 ? [] : [{ id: 'late_pdf', path: '/mnt/data/late.pdf', source: 'assistant' }],
          }),
          text: async () => '',
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;

    await processRun(
      {
        ...ctx.deps(script([
          { type: 'tool', name: 'code_interpreter', status: 'running', callId: 'ci1', containerId: 'cntr_late' },
          { type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_late' },
          { type: 'text', delta: 'Done.' },
          { type: 'done' },
        ])),
        fetchImpl,
        artifactCaptureAttempts: 3,
        artifactCaptureRetryMs: 0,
        uploadArtifact: async (_userId, _threadId, artifactId) => {
          uploaded.push(artifactId);
          return `userA/t1/${artifactId}.pdf`;
        },
      },
      't1',
      'r1',
    );

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.artifacts?.[0]).toMatchObject({ name: 'late.pdf', mime: 'application/pdf' });
    expect(uploaded).toHaveLength(1);
    expect(lists).toBeGreaterThanOrEqual(2);
  });

  it('retries code-interpreter capture when PDF content is temporarily unavailable', async () => {
    await seed(ctx);
    let downloads = 0;
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.includes('/files/retry_pdf/content')) {
        downloads++;
        if (downloads === 1) throw new Error('not ready yet');
        return {
          ok: true,
          status: 200,
          body: new Response(new Uint8Array([0x25, 0x50, 0x44, 0x46])).body,
          headers: new Headers(),
        } as unknown as Response;
      }
      if (u.includes('/containers/cntr_retry/files')) {
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'retry_pdf', path: '/mnt/data/retry.pdf', source: 'assistant' }] }),
          text: async () => '',
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${u}`);
    }) as unknown as typeof fetch;

    await processRun(
      {
        ...ctx.deps(script([
          { type: 'tool', name: 'code_interpreter', status: 'running', callId: 'ci1', containerId: 'cntr_retry' },
          { type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1', containerId: 'cntr_retry' },
          { type: 'done' },
        ])),
        fetchImpl,
        artifactCaptureAttempts: 3,
        artifactCaptureRetryMs: 0,
        uploadArtifact: async (_userId, _threadId, artifactId) => `userA/t1/${artifactId}.pdf`,
      },
      't1',
      'r1',
    );

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.artifacts?.[0]).toMatchObject({ name: 'retry.pdf', mime: 'application/pdf' });
    expect(downloads).toBeGreaterThanOrEqual(2);
  });

  it('mounts ready thread documents into the code-interpreter container', async () => {
    await seed(ctx);
    const t = await ctx.threadStore.get('userA', 't1');
    await ctx.threadStore.put({
      ...t!,
      files: [
        { fileId: 'file_doc1', providerEndpoint: 'https://r.services.ai.azure.com', name: 'spec.pdf', bytes: 10, status: 'ready', kind: 'document', createdAt: 'now' },
        { fileId: 'img_skip', name: 'pic.png', bytes: 5, status: 'ready', kind: 'image', createdAt: 'now' },
      ],
    });
    const r = await ctx.runStore.get('t1', 'r1');
    await ctx.runStore.put({ ...r!, tools: ['code_interpreter'] });

    let capturedTools: Array<{ type: string; container?: { file_ids?: string[] } }> | undefined;
    const capturing: RunAgentFn = (p) => {
      capturedTools = p.tools as typeof capturedTools;
      return (async function* () {
        yield { type: 'done' } as AgentEvent;
      })();
    };
    await processRun(ctx.deps(capturing), 't1', 'r1');

    const ci = capturedTools?.find((tool) => tool.type === 'code_interpreter');
    expect(ci?.container?.file_ids).toEqual(['file_doc1']); // documents only, not the generated image
  });

  it('pushes message snapshots and a thread update over SignalR when configured', async () => {
    await seed(ctx);
    const calls: Array<{ userId: string; target: string; payload: unknown }> = [];
    const signalr = {
      negotiate: () => ({ url: '', accessToken: '' }),
      sendToUser: async (userId: string, target: string, payload: unknown) => {
        calls.push({ userId, target, payload });
      },
    };
    await processRun(
      { ...ctx.deps(script([{ type: 'text', delta: 'Hi' }, { type: 'done' }])), signalr },
      't1',
      'r1',
    );

    const messagePushes = calls.filter((c) => c.target === 'message');
    expect(messagePushes.length).toBeGreaterThan(0);
    expect(messagePushes.every((c) => c.userId === 'userA')).toBe(true);
    const last = messagePushes.at(-1)!.payload as {
      threadId: string;
      message: { content: string; status: string };
    };
    expect(last.threadId).toBe('t1');
    expect(last.message.content).toBe('Hi');
    expect(last.message.status).toBe('complete');

    const threadPush = calls.find((c) => c.target === 'thread');
    expect(threadPush).toBeTruthy();
    expect((threadPush!.payload as { thread: { id: string } }).thread.id).toBe('t1');
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

  it('attaches user-uploaded images to the user turn as resolved read urls (vision)', async () => {
    await seed(ctx);
    await ctx.messageStore.append({
      id: 'um2',
      threadId: 't1',
      userId: 'userA',
      role: 'user',
      content: 'what is this?',
      status: 'complete',
      attachments: [
        { id: 'a1', kind: 'image', blobPath: 'userA/t1/a1.png', mime: 'image/png', bytes: 10 },
        { id: 'a2', kind: 'file', blobPath: 'userA/t1/a2.pdf', mime: 'application/pdf', bytes: 20 },
      ],
      createdAt: '2026-06-01T00:00:03Z',
      orderAt: '2026-06-01T00:00:03Z',
      deletedAt: null,
    });
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    const resolveImageUrl = async (blobPath: string) => `https://blob/${blobPath}?read`;
    await processRun({ ...ctx.deps(runAgent), resolveImageUrl }, 't1', 'r1');
    const turn = seen[0].turns.find((t) => t.text.startsWith('what is this?'));
    expect(turn?.images).toEqual(['https://blob/userA/t1/a1.png?read']); // only the image, not the pdf
    expect(turn?.text).toContain('[Uploaded image id="a1"]');
  });

  it('does not resolve a foreign persisted image path', async () => {
    await seed(ctx);
    await ctx.messageStore.append({
      id: 'um2', threadId: 't1', userId: 'userA', role: 'user', content: 'foreign', status: 'complete',
      attachments: [{ id: 'a1', kind: 'image', blobPath: 'userB/t1/a1.png', mime: 'image/png', bytes: 10 }],
      createdAt: '2026-06-01T00:00:03Z', orderAt: '2026-06-01T00:00:03Z', deletedAt: null,
    });
    const resolveImageUrl = vi.fn(async () => 'https://blob/foreign');
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (params) => {
      seen.push(params);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(params);
    };
    await processRun({ ...ctx.deps(runAgent), resolveImageUrl }, 't1', 'r1');
    expect(resolveImageUrl).not.toHaveBeenCalled();
    expect(seen[0].turns.find((turn) => turn.text.startsWith('foreign'))?.images).toBeUndefined();
  });

  it('omits images when no resolver is wired (history stays text-only)', async () => {
    await seed(ctx);
    await ctx.messageStore.append({
      id: 'um2',
      threadId: 't1',
      userId: 'userA',
      role: 'user',
      content: 'what is this?',
      status: 'complete',
      attachments: [
        { id: 'a1', kind: 'image', blobPath: 'userA/t1/a1.png', mime: 'image/png', bytes: 10 },
      ],
      createdAt: '2026-06-01T00:00:03Z',
      orderAt: '2026-06-01T00:00:03Z',
      deletedAt: null,
    });
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    const turn = seen[0].turns.find((t) => t.text === 'what is this?');
    expect(turn?.images).toBeUndefined();
  });

  it('auto-enables file_search for the thread store plus the account knowledge-base fallback', async () => {
    const local = setup({ kbStore: 'vs-account' });
    await seed(local);
    const thread = await local.threadStore.get('userA', 't1');
    await local.threadStore.put({ ...thread!, vectorStoreId: 'vs-thread', vectorStoreEndpoint: 'https://r.services.ai.azure.com' });

    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(local.deps(runAgent), 't1', 'r1');

    const fs = seen[0].tools.find((t) => t.type === 'file_search') as
      | { type: 'file_search'; vector_store_ids: string[] }
      | undefined;
    expect(fs).toBeTruthy();
    expect(fs!.vector_store_ids).toEqual(['vs-thread', 'vs-account']);
  });

  it.each([undefined, 'https://other.services.ai.azure.com'])('does not mount unverified thread references or auto-enable the account KB: %s', async providerEndpoint => {
    const local = setup({ kbStore: 'vs-account' });
    await seed(local, 'queued', ['code_interpreter']);
    const thread = (await local.threadStore.get('userA', 't1'))!;
    await local.threadStore.put({ ...thread, vectorStoreId: 'unverified-store', vectorStoreEndpoint: providerEndpoint,
      files: [{ fileId: 'unverified-file', providerEndpoint, name: 'file.pdf', bytes: 1, status: 'ready', createdAt: 'old' }],
    });
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = params => { seen.push(params); return script([{ type: 'done' }])(params); };
    await processRun(local.deps(runAgent), 't1', 'r1');
    expect(seen).toHaveLength(1);
    expect(seen[0].tools.some(tool => tool.type === 'file_search')).toBe(false);
    expect(seen[0].tools.find(tool => tool.type === 'code_interpreter')?.container?.file_ids).toBeUndefined();
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

  it('injects selected memory into the prompt and persists response memoryRefs', async () => {
    await seed(ctx);
    const memoryStore = new InMemoryMemoryStore();
    const memory = new MemoryService(memoryStore, ctx.clock);
    const saved = await memory.createManual('userA', {
      text: 'Watai deploy target is rg-watai-dev.',
      kind: 'fact',
    });
    await memoryStore.put({ ...saved, embedding: [1, 0, 0], embeddingModel: 'stub', embeddingTextHash: memoryEmbeddingTextHash(saved.text) });
    const memoryContext = new MemoryContextService(
      memoryStore,
      { get: async () => DEFAULT_SETTINGS },
      {
        embedder: { model: 'stub', embed: async (_c, text) => [/deploy|resource group|rg-|watai|azure/i.test(text) ? 1 : 0, 0, 0] },
        retriever: new InProcessRetriever(memoryStore),
      },
    );
    const run = await ctx.runStore.get('t1', 'r1');
    await ctx.runStore.put({ ...run!, prompt: { text: 'What resource group should I deploy Watai to?' } });

    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'Deploy to rg-watai-dev.' }, { type: 'done' }])(p);
    };
    await processRun({ ...ctx.deps(runAgent), memoryContext }, 't1', 'r1');

    expect(seen[0].turns[0].text).toContain('Relevant saved memory');
    expect(seen[0].turns[0].text).toContain('Watai deploy target is rg-watai-dev.');
    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.memoryRefs).toEqual([
      {
        memoryId: saved.id,
        kind: 'fact',
        text: 'Watai deploy target is rg-watai-dev.',
        origin: 'manual',
        confirmation: 'approved',
        revision: 1,
        score: expect.any(Number),
      },
    ]);
  });

  it.each([false, true])('cancels slow recall before generation without changing fallback (early: %s)', async early => {
    await seed(ctx);
    const run = await ctx.runStore.get('t1', 'r1');
    await ctx.runStore.put({ ...run!, prompt: early ? { text: 'Submitted prompt' } : undefined });
    let memorySignal: AbortSignal | undefined;
    let abortedAtGeneration: boolean | undefined;
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      abortedAtGeneration = memorySignal?.aborted;
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(
      {
        ...ctx.deps(runAgent),
        memoryContextBudgetMs: 1,
        memoryContext: { buildForRun: async (input: { signal?: AbortSignal }) => {
          memorySignal = input.signal;
          return new Promise<never>(() => {});
        } } as any,
      },
      't1',
      'r1',
    );
    expect((await ctx.messageStore.get('t1', 'am1'))?.content).toBe('ok');
    expect(seen[0].turns[0].text).not.toContain('Relevant saved memory');
    expect(abortedAtGeneration).toBe(true);
    expect(memorySignal?.aborted).toBe(true);
  });

  it.each([false, true])('uses a 500ms default recall fallback before generation (early: %s)', async early => {
    vi.useFakeTimers();
    try {
      await seed(ctx);
      const run = await ctx.runStore.get('t1', 'r1');
      await ctx.runStore.put({ ...run!, prompt: early ? { text: 'Submitted prompt' } : undefined });
      let signal: AbortSignal | undefined;
      const seen: RunAgentParams[] = [];
      const runAgent: RunAgentFn = parameters => {
        seen.push(parameters);
        return script([{ type: 'text', delta: 'Bounded reply' }, { type: 'done' }])(parameters);
      };
      const work = processRun({ ...ctx.deps(runAgent), memoryContext: { buildForRun: async (input: { signal?: AbortSignal }) => {
        signal = input.signal;
        return new Promise<never>(() => {});
      } } as any }, 't1', 'r1');
      await vi.advanceTimersByTimeAsync(501);
      const startedByDeadline = seen.length;
      const abortedByDeadline = signal?.aborted;
      await vi.advanceTimersByTimeAsync(3000);
      await work;
      expect(startedByDeadline).toBe(1);
      expect(abortedByDeadline).toBe(true);
      expect((await ctx.messageStore.get('t1', 'am1'))?.content).toBe('Bounded reply');
      expect((await ctx.messageStore.get('t1', 'am1'))?.memoryDegradedReason).toBe('timeout');
    } finally { vi.useRealTimers(); }
  });

  it('closes the recall signal after an otherwise successful run', async () => {
    await seed(ctx);
    let memorySignal: AbortSignal | undefined;
    await processRun({ ...ctx.deps(script([{ type: 'text', delta: 'ok' }, { type: 'done' }])),
      memoryContext: { buildForRun: async (input: { signal?: AbortSignal }) => {
        memorySignal = input.signal;
        return { instructions: [], memories: [], threadSummaries: [], sourceRefs: [], tokenEstimate: 0, latencyBudgetMs: 250, retrievalMode: 'empty' };
      } } as any }, 't1', 'r1');
    expect(memorySignal?.aborted).toBe(true);
  });

  it('schedules turn-lane memory extraction after a complete assistant response', async () => {
    await seed(ctx);
    const scheduled: string[] = [];
    await processRun(
      {
        ...ctx.deps(script([{ type: 'text', delta: 'ok' }, { type: 'done' }])),
        memoryExtraction: {
          enqueueTurn: async (_userId: string, threadId: string, assistantMessageId: string, runId?: string) => {
            scheduled.push(`${threadId}:${assistantMessageId}:${runId}`);
            return null;
          },
        } as any,
      },
      't1',
      'r1',
    );
    expect(scheduled).toEqual(['t1:am1:r1']);
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
    await ctx.threadStore.put({ ...thread!, vectorStoreId: 'vs1', vectorStoreEndpoint: 'https://r.services.ai.azure.com' });
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

    // The generated image is also recorded on the thread's file list (synced across devices).
    const thread = await ctx.threadStore.get('userA', 't1');
    const imageFile = thread?.files?.find((f) => f.kind === 'image');
    expect(imageFile).toBeTruthy();
    expect(imageFile?.name).toBe('a cat');
    expect(imageFile?.blobPath).toContain('.png');
    expect(imageFile?.status).toBe('ready');
  });

  it.each(['transparent', 'opaque', 'auto', undefined] as const)('forwards the image tool background as %s with PNG output', async background => {
    ctx = setup({ image: true });
    await seed(ctx, 'queued', ['generate_image']);
    const fetchImpl = vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
      data: [{ b64_json: Buffer.from('PNGDATA').toString('base64') }],
    })));
    const runAgent: RunAgentFn = async function* (params) {
      const tool = params.tools.find(candidate => candidate.name === 'generate_image');
      expect(tool?.parameters).toMatchObject({ properties: {
        background: { type: 'string', enum: ['auto', 'opaque', 'transparent'] },
      } });
      const result = await params.execute('generate_image', {
        prompt: background === 'transparent' ? 'A logo with a transparent background' : 'A mountain photograph',
        ...(background ? { background } : {}),
      });
      expect(result.image).toBeDefined();
      yield { type: 'done' };
    };
    await processRun({ ...ctx.deps(runAgent), fetchImpl }, 't1', 'r1');
    expect(fetchImpl).toHaveBeenCalledOnce();
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toMatchObject({
      background: background ?? 'auto', output_format: 'png',
    });
  });

  it('does not dispatch an invalid image background to the provider', async () => {
    ctx = setup({ image: true });
    await seed(ctx);
    const fetchImpl = vi.fn<typeof fetch>();
    const runAgent: RunAgentFn = async function* (params) {
      expect(await params.execute('generate_image', { prompt: 'A logo', background: 'checkerboard' }))
        .toEqual({ output: 'Invalid image background. Use auto, opaque, or transparent.' });
      yield { type: 'done' };
    };
    await processRun({ ...ctx.deps(runAgent), fetchImpl }, 't1', 'r1');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('shows a clear content-policy message when image generation is moderated', async () => {
    ctx = setup({ image: true });
    await seed(ctx);
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = String(input);
      if (url.includes('/images/generations')) {
        return new Response(
          JSON.stringify({ error: { message: 'Request rejected by the safety system due to content policy.' } }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        );
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const runAgent: RunAgentFn = async function* (params) {
      yield { type: 'tool', name: 'generate_image', status: 'running', callId: 'g1' };
      try {
        await params.execute('generate_image', { prompt: 'blocked prompt' });
      } catch (e) {
        yield {
          type: 'tool',
          name: 'generate_image',
          status: 'error',
          callId: 'g1',
          detail: e instanceof Error ? e.message : 'Tool failed.',
        };
      }
      yield { type: 'done' };
    };

    await processRun({ ...ctx.deps(runAgent), fetchImpl }, 't1', 'r1');

    const tool = (await ctx.messageStore.get('t1', 'am1'))?.toolCalls?.find((t) => t.id === 'g1');
    expect(tool).toMatchObject({ kind: 'image', status: 'error' });
    expect(tool?.summary).toBe(
      'Image generation was blocked by the content policy. Try changing the prompt to avoid sensitive, explicit, or restricted content.',
    );
  });

  it('shows a clear image-generation failure when the image service fails for another reason', async () => {
    ctx = setup({ image: true });
    await seed(ctx);
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = String(input);
      if (url.includes('/images/generations')) {
        return new Response(JSON.stringify({ error: { message: 'Image backend unavailable.' } }), {
          status: 503,
          headers: { 'content-type': 'application/json' },
        });
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const runAgent: RunAgentFn = async function* (params) {
      yield { type: 'tool', name: 'generate_image', status: 'running', callId: 'g1' };
      try {
        await params.execute('generate_image', { prompt: 'normal prompt' });
      } catch (e) {
        yield {
          type: 'tool',
          name: 'generate_image',
          status: 'error',
          callId: 'g1',
          detail: e instanceof Error ? e.message : 'Tool failed.',
        };
      }
      yield { type: 'done' };
    };

    await processRun({ ...ctx.deps(runAgent), fetchImpl }, 't1', 'r1');

    const tool = (await ctx.messageStore.get('t1', 'am1'))?.toolCalls?.find((t) => t.id === 'g1');
    expect(tool).toMatchObject({ kind: 'image', status: 'error' });
    expect(tool?.summary).toBe('Image generation failed: The service is temporarily unavailable.');
  });

  it.each([undefined, 'transparent'] as const)('passes the latest user image attachment and background %s to the image model', async background => {
    ctx = setup({ image: true });
    await seed(ctx);
    await ctx.messageStore.append({
      id: 'um2',
      threadId: 't1',
      userId: 'userA',
      role: 'user',
      content: 'Use this image as the reference.',
      status: 'complete',
      attachments: [
        {
          id: 'att1',
          kind: 'image',
          blobPath: 'userA/t1/att1.png',
          mime: 'image/png',
          bytes: 4,
          name: 'reference.png',
        },
      ],
      createdAt: '2026-06-01T00:00:01.500Z',
      orderAt: '2026-06-01T00:00:01.500Z',
      deletedAt: null,
    });

    const referenceBytes = new Uint8Array([1, 2, 3, 4]);
    let editCalled = false;
    let generationCalled = false;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (url === 'https://assets.example/reference.png') {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: async () => referenceBytes.buffer,
        } as unknown as Response;
      }
      if (url.includes('/images/edits')) {
        editCalled = true;
        expect((init?.body as FormData).get('background')).toBe(background ?? 'auto');
        expect((init?.body as FormData).get('output_format')).toBe('png');
        const image = (init?.body as FormData).get('image') as Blob;
        expect([...new Uint8Array(await image.arrayBuffer())]).toEqual([...referenceBytes]);
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: Buffer.from('EDITED').toString('base64') }] }),
          headers: new Headers(),
        } as unknown as Response;
      }
      if (url.includes('/images/generations')) generationCalled = true;
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const runAgent: RunAgentFn = async function* (params) {
      const result = await params.execute('generate_image', {
        prompt: background === 'transparent' ? 'Remove the background' : 'Turn this into a watercolor portrait.',
        ...(background ? { background } : {}),
        edit_reference: true,
      });
      if (result.image) {
        yield { type: 'image', b64: result.image.b64, partial: false, prompt: result.image.prompt };
      }
      yield { type: 'done' };
    };
    const uploadImage = async (): Promise<string> => 'userA/t1/img-ref.png';
    const resolveImageUrl = async (): Promise<string> => 'https://assets.example/reference.png';

    await processRun({ ...ctx.deps(runAgent), uploadImage, resolveImageUrl, fetchImpl }, 't1', 'r1');

    expect(editCalled).toBe(true);
    expect(generationCalled).toBe(false);
    expect((await ctx.messageStore.get('t1', 'am1'))?.images).toHaveLength(1);
  });

  it('passes semantic-manager references from uploaded and generated images to one edit call', async () => {
    ctx = setup({ image: true });
    await seed(ctx, 'queued', ['code_interpreter', 'generate_image'], 'Use the prior template and generated character together.');
    const user = await ctx.messageStore.get('t1', 'um1');
    await ctx.messageStore.append({
      ...user!,
      attachments: [
        { id: 'template-img', kind: 'image', blobPath: 'userA/t1/template.png', mime: 'image/png', bytes: 3 },
      ],
    });
    await ctx.messageStore.append({
      id: 'a-old',
      threadId: 't1',
      userId: 'userA',
      role: 'assistant',
      content: 'First generated character.',
      status: 'complete',
      images: [{
        id: 'generated-character',
        blobPath: 'userA/t1/generated.png',
        prompt: 'Chibi character',
        size: '1024x1024',
        outputFormat: 'png',
        createdAt: '2026-06-01T00:00:01.500Z',
      }],
      createdAt: '2026-06-01T00:00:01.500Z',
      orderAt: '2026-06-01T00:00:01.500Z',
      deletedAt: null,
    });
    const bytesByUrl: Record<string, Uint8Array> = {
      'https://assets.example/generated.png': new Uint8Array([4, 5, 6]),
      'https://assets.example/template.png': new Uint8Array([1, 2, 3]),
    };
    let editInputs: number[][] = [];
    const fetchImpl = (async (input: Parameters<typeof fetch>[0], init?: RequestInit): Promise<Response> => {
      const url = String(input);
      if (bytesByUrl[url]) {
        return {
          ok: true,
          status: 200,
          headers: new Headers({ 'content-type': 'image/png' }),
          arrayBuffer: async () => bytesByUrl[url].buffer,
        } as unknown as Response;
      }
      if (url.includes('/images/edits')) {
        const blobs = (init?.body as FormData).getAll('image[]') as Blob[];
        editInputs = await Promise.all(blobs.map(async (blob) => [...new Uint8Array(await blob.arrayBuffer())]));
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: Buffer.from('EDITED').toString('base64') }] }),
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const routeTurn: NonNullable<RunWorkerDeps['routeTurn']> = async () => ({
      action: 'generate_image',
      imageAction: 'edit',
      referenceImageIds: ['generated-character', 'template-img'],
      rationale: 'The user referenced both earlier images.',
    });
    const runAgent: RunAgentFn = async function* (params) {
      const result = await params.execute('generate_image', { prompt: 'Combine both references.' });
      if (result.image) yield { type: 'image', b64: result.image.b64, partial: false };
      yield { type: 'done' };
    };
    const resolveImageUrl = async (blobPath: string): Promise<string> =>
      blobPath.endsWith('generated.png')
        ? 'https://assets.example/generated.png'
        : 'https://assets.example/template.png';

    await processRun({
      ...ctx.deps(runAgent),
      routeTurn,
      resolveImageUrl,
      fetchImpl,
      uploadImage: async () => 'userA/t1/combined.png',
    }, 't1', 'r1');

    expect(editInputs).toEqual([[4, 5, 6], [1, 2, 3]]);
    const generated = (await ctx.messageStore.get('t1', 'am1'))?.images?.[0];
    expect(generated).toMatchObject({
      libraryItemId: libraryItemIdFor('userA', 'chat_generated_image', generated!.id),
      referenceItemIds: [
        libraryItemIdFor('userA', 'chat_generated_image', 'generated-character'),
        libraryItemIdFor('userA', 'chat_attachment', 'template-img'),
      ],
      provenanceComplete: true,
    });
  });

  it('does not pass an attached image to the image model unless edit_reference is requested', async () => {
    ctx = setup({ image: true });
    await seed(ctx);
    await ctx.messageStore.append({
      id: 'um2',
      threadId: 't1',
      userId: 'userA',
      role: 'user',
      content: 'Analyze this image, then make a separate simple icon.',
      status: 'complete',
      attachments: [
        {
          id: 'att1',
          kind: 'image',
          blobPath: 'userA/t1/att1.png',
          mime: 'image/png',
          bytes: 4,
          name: 'analysis.png',
        },
      ],
      createdAt: '2026-06-01T00:00:01.500Z',
      orderAt: '2026-06-01T00:00:01.500Z',
      deletedAt: null,
    });

    let referenceFetched = false;
    let editCalled = false;
    let generationCalled = false;
    const fetchImpl = (async (input: Parameters<typeof fetch>[0]): Promise<Response> => {
      const url = String(input);
      if (url === 'https://assets.example/reference.png') {
        referenceFetched = true;
        throw new Error('reference image should not be fetched');
      }
      if (url.includes('/images/edits')) {
        editCalled = true;
        throw new Error('image edits should not be called');
      }
      if (url.includes('/images/generations')) {
        generationCalled = true;
        return {
          ok: true,
          status: 200,
          json: async () => ({ data: [{ b64_json: Buffer.from('TXT2IMG').toString('base64') }] }),
          headers: new Headers(),
        } as unknown as Response;
      }
      throw new Error(`unexpected fetch: ${url}`);
    }) as typeof fetch;
    const runAgent: RunAgentFn = async function* (params) {
      const result = await params.execute('generate_image', { prompt: 'Make a simple blue app icon.' });
      if (result.image) yield { type: 'image', b64: result.image.b64, partial: false, prompt: result.image.prompt };
      yield { type: 'done' };
    };
    const uploadImage = async (): Promise<string> => 'userA/t1/img-generated.png';
    const resolveImageUrl = async (): Promise<string> => 'https://assets.example/reference.png';

    await processRun({ ...ctx.deps(runAgent), uploadImage, resolveImageUrl, fetchImpl }, 't1', 'r1');

    expect(referenceFetched).toBe(false);
    expect(editCalled).toBe(false);
    expect(generationCalled).toBe(true);
    expect((await ctx.messageStore.get('t1', 'am1'))?.images).toHaveLength(1);
  });

  it('streams an aspect-correct image placeholder, then yields it to the real image (no overlap)', async () => {
    await seed(ctx);
    const uploadImage = async (): Promise<string> => 'u/t1/img.png';
    const snapshots: MessageRecord[] = [];
    const signalr = {
      negotiate: () => ({ url: '', accessToken: '' }),
      sendToUser: async (_u: string, target: string, payload: unknown) => {
        if (target === 'message') snapshots.push((payload as { message: MessageRecord }).message);
      },
    };
    const runAgent: RunAgentFn = script([
      { type: 'tool', name: 'generate_image', status: 'running', callId: 'g1', args: { size: '1024x1536' } },
      {
        type: 'image',
        b64: Buffer.from('PNG').toString('base64'),
        partial: false,
        prompt: 'a cat',
        size: '1024x1536',
        callId: 'g1',
      },
      { type: 'tool', name: 'generate_image', status: 'done', callId: 'g1' },
      { type: 'done' },
    ]);
    await processRun({ ...ctx.deps(runAgent), uploadImage, signalr }, 't1', 'r1');

    // While generating: a snapshot carries the running image tool call + the requested size, and no
    // real image yet (so the client renders the aspect-correct placeholder).
    const generating = snapshots.find((m) =>
      m.toolCalls?.some((t) => t.id === 'g1' && t.status === 'running' && t.imageSize === '1024x1536'),
    );
    expect(generating).toBeTruthy();
    expect(generating?.images?.length ?? 0).toBe(0);

    // Never a snapshot with the real image while the tool call is still 'running' (no placeholder
    // and image side-by-side).
    const overlap = snapshots.find(
      (m) => (m.images?.length ?? 0) > 0 && m.toolCalls?.some((t) => t.id === 'g1' && t.status === 'running'),
    );
    expect(overlap).toBeUndefined();

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.images?.length).toBe(1);
    expect(msg?.toolCalls?.find((t) => t.id === 'g1')?.status).toBe('done');
    expect(msg?.orderAt).toBe('2026-06-01T00:00:02Z');
    expect(Date.parse(msg?.createdAt ?? '')).toBeGreaterThan(Date.parse(generating?.createdAt ?? ''));
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
    const spy = vi.spyOn(ctx.workerMessageStore, 'append');
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

  it('acknowledges cancellation requested before worker start without invoking the provider', async () => {
    await seed(ctx, 'cancel_requested');
    const runAgent = vi.fn(script([{ type: 'text', delta: 'must not run' }]));
    await processRun(ctx.deps(runAgent), 't1', 'r1');
    expect(runAgent).not.toHaveBeenCalled();
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('canceled');
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
    await seed(ctx);
    const cancelingAgent: RunAgentFn = async function* () {
      yield { type: 'text', delta: 'partial' };
      await ctx.runStore.put({ ...(await ctx.runStore.get('t1', 'r1'))!, status: 'cancel_requested' });
      yield { type: 'text', delta: ' more' };
      yield { type: 'done' };
    };
    await processRun(ctx.deps(cancelingAgent), 't1', 'r1');
    expect(await ctx.messageStore.get('t1', 'am1')).toMatchObject({ status: 'interrupted', content: 'partial' });
    expect((await ctx.runStore.get('t1', 'r1'))?.status).toBe('canceled');
  });

  it('blocks a tool network effect when cancellation is requested before execution', async () => {
    const local = setup({ tavily: true });
    await seed(local, 'queued', ['web_search']);
    const fetchImpl = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const cancelBeforeTool: RunAgentFn = async function* (params) {
      await local.runStore.put({ ...(await local.runStore.get('t1', 'r1'))!, status: 'cancel_requested' });
      await params.execute?.('web_search', { query: 'must not execute' }).catch(() => undefined);
      yield { type: 'done' };
    };
    await processRun({ ...local.deps(cancelBeforeTool), fetchImpl }, 't1', 'r1');
    expect(fetchImpl).not.toHaveBeenCalled();
    expect((await local.runStore.get('t1', 'r1'))?.status).toBe('canceled');
  });

  it('does not resurrect messages or thread state deleted during generation', async () => {
    const run = await seed(ctx);
    const deletingAgent: RunAgentFn = async function* () {
      yield { type: 'text', delta: 'partial' };
      const thread = await ctx.threadStore.get('userA', 't1');
      await ctx.threadStore.put({ ...thread!, deletedAt: '2026-06-01T00:02:00Z', updatedAt: '2026-06-01T00:02:00Z' });
      await ctx.messageStore.deleteByThread('t1');
      await ctx.runStore.deleteByThread('t1');
      yield { type: 'done' };
    };
    await processRun(ctx.deps(deletingAgent), 't1', run.id);
    expect((await ctx.threadStore.get('userA', 't1'))?.deletedAt).toBe('2026-06-01T00:02:00Z');
    expect(await ctx.messageStore.get('t1', 'am1')).toBeNull();
    expect(await ctx.runStore.get('t1', 'r1')).toBeNull();
  });

  it('rolls back the final message when deletion wins between append and thread CAS', async () => {
    await seed(ctx);
    const originalPutIfMatch = ctx.threadStore.putIfMatch.bind(ctx.threadStore);
    let injected = false;
    ctx.threadStore.putIfMatch = async (record, etag) => {
      if (!injected) {
        injected = true;
        const current = await ctx.threadStore.get('userA', 't1');
        await ctx.threadStore.put({ ...current!, deletedAt: '2026-06-01T00:03:00Z', updatedAt: '2026-06-01T00:03:00Z' });
        await ctx.messageStore.deleteByThread('t1');
        return null;
      }
      return originalPutIfMatch(record, etag);
    };
    await processRun(ctx.deps(script([{ type: 'text', delta: 'answer' }, { type: 'done' }])), 't1', 'r1');
    expect((await ctx.threadStore.get('userA', 't1'))?.deletedAt).toBe('2026-06-01T00:03:00Z');
    expect(await ctx.messageStore.get('t1', 'am1')).toBeNull();
  });

  it('preserves rename and pin changes made while generation is running', async () => {
    await seed(ctx);
    const editingAgent: RunAgentFn = async function* () {
      yield { type: 'text', delta: 'answer' };
      const thread = await ctx.threadStore.get('userA', 't1');
      await ctx.threadStore.put({ ...thread!, title: 'User rename', pinned: true, updatedAt: '2026-06-01T00:02:00Z' });
      yield { type: 'done' };
    };
    await processRun(ctx.deps(editingAgent), 't1', 'r1');
    expect(await ctx.threadStore.get('userA', 't1')).toMatchObject({ title: 'User rename', pinned: true });
  });
});
