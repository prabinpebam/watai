import { describe, it, expect } from 'vitest';
import { parseSse } from './http';

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('parseSse', () => {
  it('yields data payloads and stops at [DONE]', async () => {
    const res = sseResponse([
      'data: {"a":1}\n',
      'data: {"b":2}\n',
      'data: [DONE]\n',
      'data: {"never":true}\n',
    ]);
    expect(await collect(parseSse(res))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('reassembles payloads split across chunks', async () => {
    const res = sseResponse(['data: {"a":', '1}\n', 'data: {"b":2}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('ignores comments and non-data lines', async () => {
    const res = sseResponse([': keep-alive\n', 'event: message\n', 'data: {"x":1}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"x":1}']);
  });

  it('skips empty data lines', async () => {
    const res = sseResponse(['data: \n', 'data: {"x":1}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"x":1}']);
  });

  it('yields nothing when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const res = sseResponse(['data: {"a":1}\n']);
    expect(await collect(parseSse(res, ctrl.signal))).toEqual([]);
  });
});
