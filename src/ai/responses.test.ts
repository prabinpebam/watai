import { describe, it, expect } from 'vitest';
import {
  normalizeResponsesEvent,
  parseResponsesStream,
  toInputMessages,
  type ResponsesEvent,
} from './responses';

function sseResponse(events: unknown[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const e of events) controller.enqueue(enc.encode(`data: ${JSON.stringify(e)}\n`));
      controller.enqueue(enc.encode('data: [DONE]\n'));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(gen: AsyncGenerator<ResponsesEvent>): Promise<ResponsesEvent[]> {
  const out: ResponsesEvent[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('normalizeResponsesEvent', () => {
  it('maps created, text delta, and completed', () => {
    expect(normalizeResponsesEvent({ type: 'response.created', response: { id: 'resp_1' } })).toEqual({
      type: 'created',
      responseId: 'resp_1',
    });
    expect(normalizeResponsesEvent({ type: 'response.output_text.delta', delta: 'Hi' })).toEqual({
      type: 'text',
      delta: 'Hi',
    });
    expect(normalizeResponsesEvent({ type: 'response.completed' })).toEqual({ type: 'completed' });
  });

  it('maps a function_call output item', () => {
    expect(
      normalizeResponsesEvent({
        type: 'response.output_item.done',
        item: {
          type: 'function_call',
          call_id: 'call_1',
          name: 'generate_image',
          arguments: '{"prompt":"a cat"}',
        },
      }),
    ).toEqual({
      type: 'functionCall',
      callId: 'call_1',
      name: 'generate_image',
      arguments: '{"prompt":"a cat"}',
    });
  });

  it('maps final and partial image events', () => {
    expect(
      normalizeResponsesEvent({
        type: 'response.output_item.done',
        item: { type: 'image_generation_call', result: 'BASE64' },
      }),
    ).toEqual({ type: 'image', b64: 'BASE64', partial: false });

    expect(
      normalizeResponsesEvent({
        type: 'response.image_generation_call.partial_image',
        partial_image_b64: 'PARTIAL',
      }),
    ).toEqual({ type: 'image', b64: 'PARTIAL', partial: true });
  });

  it('maps errors and ignores unknown/empty events', () => {
    expect(normalizeResponsesEvent({ type: 'response.error', error: { message: 'boom' } })).toEqual({
      type: 'error',
      message: 'boom',
    });
    expect(normalizeResponsesEvent({ type: 'response.in_progress' })).toBeNull();
    expect(normalizeResponsesEvent({ type: 'response.output_text.delta' })).toBeNull();
  });
});

describe('parseResponsesStream', () => {
  it('streams a full run: created -> text -> image -> completed', async () => {
    const res = sseResponse([
      { type: 'response.created', response: { id: 'resp_9' } },
      { type: 'response.output_text.delta', delta: 'Here ' },
      { type: 'response.output_text.delta', delta: 'you go.' },
      {
        type: 'response.output_item.done',
        item: { type: 'image_generation_call', result: 'IMG' },
      },
      { type: 'response.completed' },
    ]);
    expect(await collect(parseResponsesStream(res))).toEqual([
      { type: 'created', responseId: 'resp_9' },
      { type: 'text', delta: 'Here ' },
      { type: 'text', delta: 'you go.' },
      { type: 'image', b64: 'IMG', partial: false },
      { type: 'completed' },
    ]);
  });

  it('surfaces a function call mid-stream', async () => {
    const res = sseResponse([
      { type: 'response.output_text.delta', delta: 'Let me draw that.' },
      {
        type: 'response.output_item.done',
        item: { type: 'function_call', call_id: 'c1', name: 'generate_image', arguments: '{}' },
      },
      { type: 'response.completed' },
    ]);
    const out = await collect(parseResponsesStream(res));
    expect(out).toContainEqual({
      type: 'functionCall',
      callId: 'c1',
      name: 'generate_image',
      arguments: '{}',
    });
  });
});

describe('toInputMessages', () => {
  it('uses input_text for user/system turns and output_text for assistant turns', () => {
    expect(
      toInputMessages([
        { role: 'system', text: 'be brief' },
        { role: 'user', text: 'hi' },
        { role: 'assistant', text: 'hello' },
        { role: 'user', text: 'more' },
      ]),
    ).toEqual([
      { type: 'message', role: 'system', content: [{ type: 'input_text', text: 'be brief' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'hi' }] },
      { type: 'message', role: 'assistant', content: [{ type: 'output_text', text: 'hello' }] },
      { type: 'message', role: 'user', content: [{ type: 'input_text', text: 'more' }] },
    ]);
  });
});
