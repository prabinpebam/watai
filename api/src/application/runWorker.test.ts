import { describe, it, expect, beforeEach, vi } from 'vitest';
import { processRun, type RunWorkerDeps } from './runWorker';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InProcessRetriever } from '../adapters/memory/inProcessRetriever';
import { MemoryService } from './memoryService';
import { MemoryContextService } from './memoryContextService';
import type { RunRecord } from '../ports/runStore';
import type { MessageRecord } from '../ports/messageStore';
import type { RunStatus } from '../domain/run';
import type { AgentEvent, RunAgentParams } from '../ai/orchestrator';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { DEFAULT_SKILLS } from '../skills';
import { AppError } from '../domain/errors';

type RunAgentFn = NonNullable<RunWorkerDeps['runAgent']>;

function setup(opts?: { credError?: boolean; tavily?: boolean; kbStore?: string; image?: boolean }) {
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
  return { runStore, messageStore, threadStore, clock, credentials, deps };
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
      return {
        ok: true,
        status: 200,
        arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]).buffer, // %PDF-
        headers: new Headers(),
      } as unknown as Response;
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
        { id: 'template-img', kind: 'image', blobPath: 'userA/t1/template.png', mime: 'image/png', bytes: 10, name: 'template.png' },
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
    expect(routedTranscript).toContain('[Uploaded image id="template-img" name="template.png"]');
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
    await seed(ctx, 'queued', ['code_interpreter'], 'please format this with /pdf');
    let ensureCalls = 0;
    const deps: RunWorkerDeps = {
      ...ctx.deps(script([{ type: 'text', delta: 'hi' }, { type: 'done' }])),
      skillProvisioner: {
        ensure: async () => {
          ensureCalls++;
          return { fileIds: ['s1'], skills: [{ name: 'pdf', description: 'd', path: '/mnt/data/skills/pdf/' }] };
        },
      },
      resolveSkills: async () => DEFAULT_SKILLS,
    };
    await processRun(deps, 't1', 'r1');
    expect(ensureCalls).toBe(1); // explicit /pdf tag → skills provisioned + mounted
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
    const uploaded: Array<{ id: string; mime: string; bytes: number }> = [];
    const uploadArtifact = async (
      userId: string,
      threadId: string,
      artifactId: string,
      bytes: Uint8Array,
      mime: string,
    ): Promise<string> => {
      uploaded.push({ id: artifactId, mime, bytes: bytes.byteLength });
      return `${userId}/${threadId}/${artifactId}.pdf`;
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
        fetchImpl: artifactFetch(),
      },
      't1',
      'r1',
    );

    const msg = await ctx.messageStore.get('t1', 'am1');
    expect(msg?.artifacts).toHaveLength(1); // only the assistant-sourced file, not the user input
    expect(msg?.artifacts?.[0]).toMatchObject({ name: 'report.pdf', mime: 'application/pdf', kind: 'pdf', bytes: 5 });
    const ci = msg?.toolCalls?.find((t) => t.id === 'ci1');
    expect(ci?.artifactIds).toEqual([msg?.artifacts?.[0].id]);

    const thread = await ctx.threadStore.get('userA', 't1');
    const artifactFile = thread?.files?.find((f) => f.kind === 'artifact');
    expect(artifactFile).toMatchObject({ name: 'report.pdf', mime: 'application/pdf', status: 'ready' });
    expect(uploaded).toEqual([{ id: msg?.artifacts?.[0].id, mime: 'application/pdf', bytes: 5 }]);
  });

  it('retries code-interpreter capture when the generated PDF appears after the done event', async () => {
    await seed(ctx);
    const uploaded: string[] = [];
    let lists = 0;
    const fetchImpl = (async (url: string | URL): Promise<Response> => {
      const u = String(url);
      if (u.includes('/files/late_pdf/content')) {
        return {
          ok: true,
          status: 200,
          arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
          headers: new Headers(),
        } as unknown as Response;
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
          arrayBuffer: async () => new Uint8Array([0x25, 0x50, 0x44, 0x46]).buffer,
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
        { fileId: 'file_doc1', name: 'spec.pdf', bytes: 10, status: 'ready', kind: 'document', createdAt: 'now' },
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
    await local.threadStore.put({ ...thread!, vectorStoreId: 'vs-thread' });

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
    await memoryStore.put({ ...saved, embedding: [1, 0, 0] });
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
        score: expect.any(Number),
      },
    ]);
  });

  it('does not block generation when memory context lookup is slow', async () => {
    await seed(ctx);
    const seen: RunAgentParams[] = [];
    const runAgent: RunAgentFn = (p) => {
      seen.push(p);
      return script([{ type: 'text', delta: 'ok' }, { type: 'done' }])(p);
    };
    await processRun(
      {
        ...ctx.deps(runAgent),
        memoryContextBudgetMs: 1,
        memoryContext: { buildForRun: async () => new Promise<never>(() => {}) } as any,
      },
      't1',
      'r1',
    );
    expect((await ctx.messageStore.get('t1', 'am1'))?.content).toBe('ok');
    expect(seen[0].turns[0].text).not.toContain('Relevant saved memory');
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

    // The generated image is also recorded on the thread's file list (synced across devices).
    const thread = await ctx.threadStore.get('userA', 't1');
    const imageFile = thread?.files?.find((f) => f.kind === 'image');
    expect(imageFile).toBeTruthy();
    expect(imageFile?.name).toBe('a cat');
    expect(imageFile?.blobPath).toContain('.png');
    expect(imageFile?.status).toBe('ready');
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

  it('passes the latest user image attachment to the image model when edit_reference is requested', async () => {
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
        prompt: 'Turn this into a watercolor portrait.',
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
    expect((await ctx.messageStore.get('t1', 'am1'))?.images).toHaveLength(1);
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
