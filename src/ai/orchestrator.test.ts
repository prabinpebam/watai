import { describe, it, expect, vi } from 'vitest';
import { runAgent, type AgentEvent } from './orchestrator';
import type { ResponsesEvent, ResponsesParams } from './responses';

/** A fake Responses stream that replays one scripted event list per iteration. */
function fakeStream(scripts: ResponsesEvent[][]) {
  let i = 0;
  return async function* (_p: ResponsesParams): AsyncGenerator<ResponsesEvent> {
    void _p;
    const script = scripts[i++] ?? [{ type: 'completed' }];
    for (const ev of script) yield ev;
  };
}

async function collect(gen: AsyncGenerator<AgentEvent>): Promise<AgentEvent[]> {
  const out: AgentEvent[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

const noopExecute = async () => ({ output: '' });

describe('runAgent', () => {
  it('streams a plain text answer and finishes', async () => {
    const streamFn = fakeStream([
      [
        { type: 'created', responseId: 'r1' },
        { type: 'text', delta: 'Hello' },
        { type: 'completed' },
      ],
    ]);
    const events = await collect(
      runAgent({ model: 'm', turns: [{ role: 'user', text: 'hi' }], tools: [], execute: noopExecute, streamFn }),
    );
    expect(events).toEqual([{ type: 'text', delta: 'Hello' }, { type: 'done' }]);
  });

  it('executes a function call, renders its image, and continues the run', async () => {
    const streamFn = fakeStream([
      [
        { type: 'created', responseId: 'r1' },
        { type: 'text', delta: 'Drawing…' },
        { type: 'functionCall', callId: 'c1', name: 'generate_image', arguments: '{"prompt":"a cat"}' },
        { type: 'completed' },
      ],
      [
        { type: 'created', responseId: 'r2' },
        { type: 'text', delta: 'Here it is.' },
        { type: 'completed' },
      ],
    ]);
    const calls: Array<{ name: string; args: Record<string, unknown> }> = [];
    const execute = async (name: string, args: Record<string, unknown>) => {
      calls.push({ name, args });
      return { output: 'Image shown to the user.', image: { b64: 'IMGB64' } };
    };

    const events = await collect(
      runAgent({
        model: 'm',
        turns: [{ role: 'user', text: 'draw a cat' }],
        tools: [],
        execute,
        streamFn,
      }),
    );

    expect(calls).toEqual([{ name: 'generate_image', args: { prompt: 'a cat' } }]);
    expect(events).toContainEqual({ type: 'image', b64: 'IMGB64', partial: false, callId: 'c1' });
    expect(events).toContainEqual({
      type: 'tool',
      name: 'generate_image',
      status: 'running',
      callId: 'c1',
      args: { prompt: 'a cat' },
    });
    expect(events).toContainEqual({ type: 'tool', name: 'generate_image', status: 'done', callId: 'c1' });
    expect(events.filter((e) => e.type === 'text')).toEqual([
      { type: 'text', delta: 'Drawing…' },
      { type: 'text', delta: 'Here it is.' },
    ]);
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('passes the requested image size through the running tool event (for the UI placeholder)', async () => {
    const streamFn = fakeStream([
      [
        { type: 'functionCall', callId: 'c9', name: 'generate_image', arguments: '{"prompt":"a fox","size":"1024x1536"}' },
        { type: 'completed' },
      ],
      [{ type: 'completed' }],
    ]);
    const events = await collect(
      runAgent({ model: 'm', turns: [], tools: [], execute: async () => ({ output: 'ok' }), streamFn }),
    );
    const running = events.find((e) => e.type === 'tool' && e.status === 'running');
    expect(running).toMatchObject({ name: 'generate_image', callId: 'c9', args: { size: '1024x1536' } });
  });

  it('reports a tool error but keeps the run going', async () => {
    const streamFn = fakeStream([
      [
        { type: 'functionCall', callId: 'c1', name: 'boom', arguments: '{}' },
        { type: 'completed' },
      ],
      [{ type: 'text', delta: 'recovered' }, { type: 'completed' }],
    ]);
    const execute = async () => {
      throw new Error('kaboom');
    };
    const events = await collect(
      runAgent({ model: 'm', turns: [], tools: [], execute, streamFn }),
    );
    expect(events).toContainEqual({ type: 'tool', name: 'boom', status: 'error', detail: 'kaboom', callId: 'c1' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('surfaces a stream error and stops', async () => {
    const streamFn = fakeStream([[{ type: 'error', message: 'boom' }]]);
    const events = await collect(
      runAgent({ model: 'm', turns: [], tools: [], execute: noopExecute, streamFn }),
    );
    expect(events).toEqual([{ type: 'error', message: 'boom' }]);
  });

  it('stops with a budget error if tools never resolve', async () => {
    const streamFn = (_p: ResponsesParams) =>
      (async function* (): AsyncGenerator<ResponsesEvent> {
        yield { type: 'functionCall', callId: 'c', name: 'loop', arguments: '{}' };
        yield { type: 'completed' };
      })();
    const events = await collect(
      runAgent({
        model: 'm',
        turns: [],
        tools: [],
        execute: async () => ({ output: 'ok' }),
        maxIterations: 2,
        streamFn,
      }),
    );
    expect(events[events.length - 1]).toEqual({
      type: 'error',
      message: 'Stopped: tool-call budget exceeded.',
    });
  });

  it('asks for confirmation before a destructive tool and skips it on decline', async () => {
    const streamFn = fakeStream([
      [
        { type: 'functionCall', callId: 'c1', name: 'delete_thread', arguments: '{"threadId":"t1"}' },
        { type: 'completed' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'completed' }],
    ]);
    const execute = vi.fn(async () => ({ output: 'deleted' }));
    const confirm = vi.fn(async () => false);
    const events = await collect(
      runAgent({
        model: 'm',
        turns: [],
        tools: [],
        execute,
        confirm,
        isDestructive: (n) => n === 'delete_thread',
        streamFn,
      }),
    );
    expect(confirm).toHaveBeenCalledWith({ name: 'delete_thread', args: { threadId: 't1' } });
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'tool',
      name: 'delete_thread',
      status: 'awaiting-confirm',
      callId: 'c1',
      args: { threadId: 't1' },
    });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });

  it('runs a destructive tool after the user confirms', async () => {
    const streamFn = fakeStream([
      [
        { type: 'functionCall', callId: 'c1', name: 'delete_thread', arguments: '{"threadId":"t1"}' },
        { type: 'completed' },
      ],
      [{ type: 'text', delta: 'done' }, { type: 'completed' }],
    ]);
    const execute = vi.fn(async () => ({ output: 'deleted' }));
    const confirm = vi.fn(async () => true);
    const events = await collect(
      runAgent({
        model: 'm',
        turns: [],
        tools: [],
        execute,
        confirm,
        isDestructive: (n) => n === 'delete_thread',
        streamFn,
      }),
    );
    expect(execute).toHaveBeenCalledWith('delete_thread', { threadId: 't1' });
    expect(events).toContainEqual({
      type: 'tool',
      name: 'delete_thread',
      status: 'running',
      callId: 'c1',
      args: { threadId: 't1' },
    });
    expect(events).toContainEqual({ type: 'tool', name: 'delete_thread', status: 'done', callId: 'c1' });
  });

  it('does not gate destructive tools when no confirm callback is given (back-compat)', async () => {
    const streamFn = fakeStream([
      [{ type: 'functionCall', callId: 'c1', name: 'delete_thread', arguments: '{}' }, { type: 'completed' }],
      [{ type: 'completed' }],
    ]);
    const execute = vi.fn(async () => ({ output: 'ok' }));
    const events = await collect(
      runAgent({ model: 'm', turns: [], tools: [], execute, isDestructive: () => true, streamFn }),
    );
    expect(execute).toHaveBeenCalled();
    expect(events).toContainEqual({
      type: 'tool',
      name: 'delete_thread',
      status: 'running',
      callId: 'c1',
      args: {},
    });
  });

  it('forwards citations from the stream', async () => {
    const streamFn = fakeStream([
      [
        { type: 'citation', citation: { source: 'web', url: 'https://a.com/' } },
        { type: 'text', delta: 'grounded' },
        { type: 'completed' },
      ],
    ]);
    const events = await collect(
      runAgent({ model: 'm', turns: [], tools: [], execute: noopExecute, streamFn }),
    );
    expect(events).toContainEqual({ type: 'citation', citation: { source: 'web', url: 'https://a.com/' } });
  });

  it('forwards server-tool activity as tool cards without client execution', async () => {
    const streamFn = fakeStream([
      [
        { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'running' },
        { type: 'text', delta: 'Computing…' },
        { type: 'serverTool', kind: 'code_interpreter', callId: 'ci1', status: 'done' },
        { type: 'completed' },
      ],
    ]);
    const execute = vi.fn(async () => ({ output: '' }));
    const events = await collect(runAgent({ model: 'm', turns: [], tools: [], execute, streamFn }));
    expect(execute).not.toHaveBeenCalled();
    expect(events).toContainEqual({ type: 'tool', name: 'code_interpreter', status: 'running', callId: 'ci1' });
    expect(events).toContainEqual({ type: 'tool', name: 'code_interpreter', status: 'done', callId: 'ci1' });
    expect(events[events.length - 1]).toEqual({ type: 'done' });
  });
});
