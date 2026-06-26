import { describe, it, expect, vi } from 'vitest';
import { streamChat, v1Url, type ChatStreamEvent } from './chat';

function sseResponse(
  chunks: string[],
  init?: { ok?: boolean; status?: number; bodyText?: string },
): Response {
  if (init && init.ok === false) {
    return new Response(init.bodyText ?? JSON.stringify({ error: { message: 'nope' } }), {
      status: init.status ?? 401,
    });
  }
  const stream = new ReadableStream({
    start(c) {
      for (const ch of chunks) c.enqueue(new TextEncoder().encode(ch));
      c.close();
    },
  });
  return new Response(stream, { status: 200 });
}

async function collect(gen: AsyncGenerator<ChatStreamEvent>): Promise<ChatStreamEvent[]> {
  const out: ChatStreamEvent[] = [];
  for await (const e of gen) out.push(e);
  return out;
}

const sse = (obj: unknown) => `data: ${JSON.stringify(obj)}\n\n`;
const base = 'https://r.services.ai.azure.com/openai/v1';

describe('v1Url', () => {
  it('keeps a vault-normalized base and appends the path', () => {
    expect(v1Url(base, '/chat/completions')).toBe(`${base}/chat/completions`);
  });
  it('normalizes a cognitiveservices host to services.ai + /openai/v1', () => {
    expect(v1Url('https://r.cognitiveservices.azure.com', '/chat/completions')).toBe(
      `${base}/chat/completions`,
    );
  });
});

describe('streamChat', () => {
  it('yields text deltas then a done event with usage', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([
        sse({ choices: [{ delta: { content: 'Hel' } }] }),
        sse({ choices: [{ delta: { content: 'lo' } }] }),
        sse({ choices: [{ finish_reason: 'stop' }], usage: { prompt_tokens: 3, completion_tokens: 2 } }),
        'data: [DONE]\n\n',
      ]),
    ) as unknown as typeof fetch;

    const events = await collect(
      streamChat({ baseUrl: base, key: 'k', model: 'm', messages: [{ role: 'user', content: 'hi' }], fetchImpl }),
    );
    const text = events.filter((e) => e.type === 'delta').map((e) => e.textDelta).join('');
    expect(text).toBe('Hello');
    expect(events.find((e) => e.type === 'done')?.usage).toEqual({ promptTokens: 3, completionTokens: 2 });
  });

  it('sends bearer auth and the right URL/body', async () => {
    let captured: { url: string; init: RequestInit } | undefined;
    const fetchImpl = vi.fn(async (url: string, init: RequestInit) => {
      captured = { url, init };
      return sseResponse(['data: [DONE]\n\n']);
    }) as unknown as typeof fetch;

    await collect(
      streamChat({
        baseUrl: base,
        key: 'secret',
        model: 'gpt-5.4',
        messages: [{ role: 'user', content: 'hi' }],
        maxCompletionTokens: 100,
        fetchImpl,
      }),
    );
    expect(captured!.url).toBe(`${base}/chat/completions`);
    expect((captured!.init.headers as Record<string, string>).Authorization).toBe('Bearer secret');
    const body = JSON.parse(captured!.init.body as string);
    expect(body).toMatchObject({ model: 'gpt-5.4', stream: true, max_completion_tokens: 100 });
    expect(body.messages).toEqual([{ role: 'user', content: 'hi' }]);
  });

  it('emits a single error event on a non-ok response (mapped code)', async () => {
    const fetchImpl = vi.fn(async () =>
      sseResponse([], { ok: false, status: 401, bodyText: JSON.stringify({ error: { message: 'bad key' } }) }),
    ) as unknown as typeof fetch;
    const events = await collect(streamChat({ baseUrl: base, key: 'k', model: 'm', messages: [], fetchImpl }));
    expect(events).toHaveLength(1);
    expect(events[0].type).toBe('error');
    expect(events[0].error?.code).toBe('unauthorized');
  });

  it('emits a network error when fetch throws', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('down');
    }) as unknown as typeof fetch;
    const events = await collect(streamChat({ baseUrl: base, key: 'k', model: 'm', messages: [], fetchImpl }));
    expect(events[0].error?.code).toBe('network');
  });
});
