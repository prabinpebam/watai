// Typed client for the Azure OpenAI Responses API (/openai/v1/responses) — the single
// entry point for agentic chat (tool calls, multi-step state, typed output items). It
// reuses aiFetch/parseSse and normalizes the SSE event vocabulary into a small union the
// orchestrator consumes. See documentation/agentic/01-foundry-capabilities.md §2.
import { aiFetch, parseSse } from './http';
import { normalizeHttpError } from './errors';

/** A tool the model may use: a client-side `function`, or a service-side built-in. */
export interface ResponsesTool {
  type: 'function' | 'image_generation' | 'web_search' | 'code_interpreter' | 'file_search';
  name?: string;
  description?: string;
  parameters?: Record<string, unknown>;
  vector_store_ids?: string[];
  user_location?: { type: 'approximate'; country?: string; city?: string; region?: string };
  search_context_size?: 'low' | 'medium' | 'high';
  [key: string]: unknown;
}

/** Input items: prior turns as messages, or the output of a client-executed function. */
export type ResponsesInputItem =
  | {
      type: 'message';
      role: 'system' | 'user' | 'assistant';
      content: Array<{ type: 'input_text' | 'output_text'; text: string }>;
    }
  | { type: 'function_call_output'; call_id: string; output: string };

export interface ResponsesParams {
  model: string;
  input: ResponsesInputItem[];
  tools?: ResponsesTool[];
  toolChoice?: 'auto' | 'required' | 'none';
  /** Continue a prior run (after returning a function result) keeping server-side context. */
  previousResponseId?: string;
  headers?: Record<string, string>;
  signal?: AbortSignal;
}

/** Normalized stream events (the service's verbose vocabulary collapsed to what we render). */
export type ResponsesEvent =
  | { type: 'created'; responseId: string }
  | { type: 'text'; delta: string }
  | { type: 'functionCall'; callId: string; name: string; arguments: string }
  | { type: 'image'; b64: string; partial: boolean }
  | { type: 'completed' }
  | { type: 'error'; message: string };

interface RawEvent {
  type?: string;
  delta?: string;
  response?: { id?: string };
  error?: { message?: string };
  item?: {
    type?: string;
    call_id?: string;
    name?: string;
    arguments?: string;
    result?: string;
  };
  partial_image_b64?: string;
  b64_json?: string;
}

/** Map one raw Responses SSE event to a normalized event, or null to ignore it. */
export function normalizeResponsesEvent(raw: unknown): ResponsesEvent | null {
  const ev = raw as RawEvent;
  switch (ev?.type) {
    case 'response.created':
      return ev.response?.id ? { type: 'created', responseId: ev.response.id } : null;
    case 'response.output_text.delta':
      return ev.delta ? { type: 'text', delta: ev.delta } : null;
    case 'response.output_item.done': {
      const item = ev.item;
      if (item?.type === 'function_call' && item.call_id && item.name) {
        return {
          type: 'functionCall',
          callId: item.call_id,
          name: item.name,
          arguments: item.arguments ?? '',
        };
      }
      if (item?.type === 'image_generation_call' && item.result) {
        return { type: 'image', b64: item.result, partial: false };
      }
      return null;
    }
    case 'response.image_generation_call.partial_image': {
      const b64 = ev.partial_image_b64 ?? ev.b64_json;
      return b64 ? { type: 'image', b64, partial: true } : null;
    }
    case 'response.completed':
      return { type: 'completed' };
    case 'response.error':
      return { type: 'error', message: ev.error?.message ?? 'The response failed.' };
    default:
      return null;
  }
}

/** Parse an already-open Responses SSE response into normalized events (testable). */
export async function* parseResponsesStream(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<ResponsesEvent> {
  for await (const data of parseSse(res, signal)) {
    let raw: unknown;
    try {
      raw = JSON.parse(data);
    } catch {
      continue;
    }
    const ev = normalizeResponsesEvent(raw);
    if (ev) yield ev;
  }
}

/** Stream a Responses API run, yielding normalized events. */
export async function* streamResponses(p: ResponsesParams): AsyncGenerator<ResponsesEvent> {
  const body: Record<string, unknown> = { model: p.model, input: p.input, stream: true };
  if (p.tools?.length) body.tools = p.tools;
  if (p.toolChoice) body.tool_choice = p.toolChoice;
  if (p.previousResponseId) body.previous_response_id = p.previousResponseId;

  const res = await aiFetch({
    path: '/responses',
    body,
    stream: true,
    signal: p.signal,
    headers: p.headers,
  });
  if (!res.ok) {
    const err = await normalizeHttpError(res, 'chat');
    yield { type: 'error', message: err.message };
    return;
  }
  yield* parseResponsesStream(res, p.signal);
}

/** Build Responses `input` message items from simple role/text turns. */
export function toInputMessages(
  turns: Array<{ role: 'system' | 'user' | 'assistant'; text: string }>,
): ResponsesInputItem[] {
  return turns.map((t) => ({
    type: 'message',
    role: t.role,
    // Prior assistant turns are model OUTPUT and must use `output_text`; user/system
    // turns are inputs and use `input_text`. Tagging an assistant turn as `input_text`
    // makes the Responses API reject the whole request (400) the moment history
    // contains an assistant message — i.e. every turn after the first.
    content: [{ type: t.role === 'assistant' ? 'output_text' : 'input_text', text: t.text }],
  }));
}
