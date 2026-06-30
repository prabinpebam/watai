import { describe, it, expect, vi } from 'vitest';
import { runAgent, type AgentEvent } from './orchestrator';
import type { ResponsesEvent, ResponsesParams } from './responses';

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

/** A streamFn that yields a different event batch per iteration (last batch repeats). */
function streamOf(...batches: ResponsesEvent[][]) {
  let i = 0;
  return (_p: ResponsesParams): AsyncGenerator<ResponsesEvent> => {
    const batch = batches[Math.min(i++, batches.length - 1)];
    return (async function* () {
      for (const e of batch) yield e;
    })();
  };
}

const base = { baseUrl: 'https://x/openai/v1', key: 'k', model: 'm' };

describe('runAgent', () => {
  it('streams text then completes', async () => {
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'hi' }],
        tools: [],
        execute: async () => ({ output: '' }),
        streamFn: streamOf([
          { type: 'created', responseId: 'r1' },
          { type: 'text', delta: 'Hel' },
          { type: 'text', delta: 'lo' },
          { type: 'completed' },
        ]),
      }),
    );
    expect(events).toEqual([
      { type: 'text', delta: 'Hel' },
      { type: 'text', delta: 'lo' },
      { type: 'done' },
    ]);
  });

  it('forwards the code-interpreter container id on the tool event', async () => {
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'make a pdf' }],
        tools: [{ type: 'code_interpreter', container: { type: 'auto' } }],
        execute: async () => ({ output: '' }),
        streamFn: streamOf([
          { type: 'created', responseId: 'r1' },
          { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'running', containerId: 'cntr_abc' },
          { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'done', containerId: 'cntr_abc', detail: 'code' },
          { type: 'completed' },
        ]),
      }),
    );
    const toolEvents = events.filter((e): e is Extract<AgentEvent, { type: 'tool' }> => e.type === 'tool');
    expect(toolEvents).toHaveLength(2);
    expect(toolEvents[0]).toMatchObject({ name: 'code_interpreter', status: 'running', containerId: 'cntr_abc' });
    expect(toolEvents[1]).toMatchObject({ name: 'code_interpreter', status: 'done', containerId: 'cntr_abc' });
  });

  it('executes a function call, feeds the output back, and surfaces citations', async () => {
    const execute = vi.fn(async (_name: string, args: Record<string, unknown>) => ({
      output: `result for ${String(args.query)}`,
      citations: [{ source: 'web' as const, url: 'https://e.com', title: 'E' }],
    }));
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'search' }],
        tools: [],
        execute,
        streamFn: streamOf(
          [
            { type: 'created', responseId: 'r1' },
            { type: 'functionCall', callId: 'c1', name: 'web_search', arguments: '{"query":"cats"}' },
            { type: 'completed' },
          ],
          [
            { type: 'created', responseId: 'r2' },
            { type: 'text', delta: 'answer' },
            { type: 'completed' },
          ],
        ),
      }),
    );
    expect(execute).toHaveBeenCalledWith('web_search', { query: 'cats' });
    expect(events.some((e) => e.type === 'tool' && e.status === 'running' && e.name === 'web_search')).toBe(true);
    expect(events.some((e) => e.type === 'citation')).toBe(true);
    expect(events.some((e) => e.type === 'tool' && e.status === 'done')).toBe(true);
    expect(events.some((e) => e.type === 'text' && e.delta === 'answer')).toBe(true);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('surfaces web images returned by a tool as webImage events', async () => {
    const execute = vi.fn(async () => ({
      output: 'found images',
      webImages: [
        { url: 'https://img.example/1.jpg', description: 'a cat' },
        { url: 'https://img.example/2.jpg' },
      ],
    }));
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'cat pictures' }],
        tools: [],
        execute,
        streamFn: streamOf(
          [
            { type: 'created', responseId: 'r1' },
            { type: 'functionCall', callId: 'c1', name: 'web_search', arguments: '{"query":"cat"}' },
            { type: 'completed' },
          ],
          [
            { type: 'created', responseId: 'r2' },
            { type: 'text', delta: 'here' },
            { type: 'completed' },
          ],
        ),
      }),
    );
    const imgs = events.filter((e): e is Extract<typeof e, { type: 'webImage' }> => e.type === 'webImage');
    expect(imgs).toHaveLength(2);
    expect(imgs[0].webImage).toEqual({ url: 'https://img.example/1.jpg', description: 'a cat' });
    expect(imgs[1].webImage.url).toBe('https://img.example/2.jpg');
  });

  it('surfaces server-side tool activity (code interpreter) as tool cards', async () => {
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'x' }],
        tools: [],
        execute: async () => ({ output: '' }),
        streamFn: streamOf([
          { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'running' },
          { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'done', detail: 'print(1)' },
          { type: 'text', delta: 'ok' },
          { type: 'completed' },
        ]),
      }),
    );
    const toolNames = events.filter((e) => e.type === 'tool').map((e) => (e as { name: string }).name);
    expect(toolNames).toEqual(['code_interpreter', 'code_interpreter']);
  });

  it('stops with a budget error when tools never resolve', async () => {
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'x' }],
        tools: [],
        maxIterations: 2,
        execute: async () => ({ output: 'again' }),
        streamFn: () =>
          (async function* () {
            yield { type: 'created', responseId: 'r' } as ResponsesEvent;
            yield { type: 'functionCall', callId: 'c', name: 'loop', arguments: '{}' } as ResponsesEvent;
            yield { type: 'completed' } as ResponsesEvent;
          })(),
      }),
    );
    expect(events[events.length - 1]).toMatchObject({ type: 'error', code: 'budget_exceeded' });
  });

  it('aborts the run when the model stream errors', async () => {
    const events = await collect(
      runAgent({
        ...base,
        turns: [{ role: 'user', text: 'x' }],
        tools: [],
        execute: async () => ({ output: '' }),
        streamFn: streamOf([{ type: 'error', message: 'boom' }]),
      }),
    );
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
  });
});
