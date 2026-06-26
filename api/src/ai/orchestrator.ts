// The agent orchestrator: the tool-calling loop that turns one user turn into a streamed answer
// plus any tool steps. Ported from the browser `ai/orchestrator.ts`; the only change is that
// `baseUrl` + `key` are threaded into the Responses stream call. It demultiplexes the Responses
// stream into text, images, and tool activity, executes function calls, and continues the run with
// their output (via previous_response_id) until the model stops or the budget is hit.
import {
  streamResponses,
  toInputMessages,
  type ResponsesCitation,
  type ResponsesEvent,
  type ResponsesInputItem,
  type ResponsesParams,
  type ResponsesTool,
} from './responses';
import type { AiErrorCode } from './errors';

export interface Turn {
  role: 'system' | 'user' | 'assistant';
  text: string;
  images?: string[];
}

/** Result of an executed tool: `output` goes back to the model; `image` renders in chat. */
export interface ToolResult {
  output: string;
  image?: { b64: string; prompt?: string; size?: string; expandedPrompt?: string; model?: string };
  citations?: ResponsesCitation[];
}

export type ToolExecute = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | {
      type: 'image';
      b64: string;
      partial: boolean;
      prompt?: string;
      size?: string;
      callId?: string;
      expandedPrompt?: string;
      model?: string;
    }
  | {
      type: 'tool';
      name: string;
      status: 'running' | 'awaiting-confirm' | 'done' | 'error';
      detail?: string;
      result?: string;
      callId?: string;
      args?: Record<string, unknown>;
    }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: AiErrorCode }
  | { type: 'citation'; citation: ResponsesCitation };

export interface RunAgentParams {
  /** Vault-resolved inference base URL (…/openai/v1) and key. */
  baseUrl: string;
  key: string;
  model: string;
  turns: Turn[];
  tools: ResponsesTool[];
  execute: ToolExecute;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Max model<->tool round-trips before stopping (cost guard). */
  maxIterations?: number;
  /** Ask the user to approve a destructive tool before it runs. */
  confirm?: (req: { name: string; args: Record<string, unknown> }) => Promise<boolean>;
  /** Predicate marking a tool as destructive (gated behind `confirm`). */
  isDestructive?: (name: string) => boolean;
  /** Injectable stream for tests; defaults to the real Responses client. */
  streamFn?: (p: ResponsesParams) => AsyncGenerator<ResponsesEvent>;
  fetchImpl?: typeof fetch;
}

export async function* runAgent(params: RunAgentParams): AsyncGenerator<AgentEvent> {
  const stream = params.streamFn ?? streamResponses;
  const maxIterations = params.maxIterations ?? 6;

  let input: ResponsesInputItem[] = toInputMessages(params.turns);
  let previousResponseId: string | undefined;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let responseId: string | undefined;
    const pending: Array<{ callId: string; name: string; arguments: string }> = [];

    for await (const ev of stream({
      baseUrl: params.baseUrl,
      key: params.key,
      model: params.model,
      input,
      tools: params.tools,
      toolChoice: 'auto',
      previousResponseId,
      headers: params.headers,
      signal: params.signal,
      fetchImpl: params.fetchImpl,
    })) {
      switch (ev.type) {
        case 'created':
          responseId = ev.responseId;
          break;
        case 'text':
          yield { type: 'text', delta: ev.delta };
          break;
        case 'image':
          yield { type: 'image', b64: ev.b64, partial: ev.partial };
          break;
        case 'serverTool':
          yield {
            type: 'tool',
            name: ev.kind,
            status: ev.status,
            callId: ev.callId,
            ...(ev.summary ? { detail: ev.summary } : {}),
            ...(ev.detail ? { result: ev.detail } : {}),
          };
          break;
        case 'citation':
          yield { type: 'citation', citation: ev.citation };
          break;
        case 'functionCall': {
          pending.push(ev);
          let toolArgs: Record<string, unknown> = {};
          try {
            toolArgs = ev.arguments ? (JSON.parse(ev.arguments) as Record<string, unknown>) : {};
          } catch {
            /* malformed args -> empty object */
          }
          const needsConfirm = !!params.confirm && (params.isDestructive?.(ev.name) ?? false);
          if (!needsConfirm) {
            yield { type: 'tool', name: ev.name, status: 'running', callId: ev.callId, args: toolArgs };
          }
          break;
        }
        case 'error':
          yield { type: 'error', message: ev.message };
          return;
        case 'completed':
          break;
      }
    }

    if (pending.length === 0) {
      yield { type: 'done' };
      return;
    }

    // Execute each function call and feed the outputs back into the run.
    const outputs: ResponsesInputItem[] = [];
    for (const call of pending) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        /* malformed args -> empty object; the tool validates at its boundary */
      }

      // Guard destructive tools: never run from model/tool output without explicit consent.
      const needsConfirm = !!params.confirm && (params.isDestructive?.(call.name) ?? false);
      if (needsConfirm) {
        yield { type: 'tool', name: call.name, status: 'awaiting-confirm', callId: call.callId, args };
        const approved = await params.confirm!({ name: call.name, args });
        if (!approved) {
          outputs.push({ type: 'function_call_output', call_id: call.callId, output: 'User declined.' });
          yield { type: 'tool', name: call.name, status: 'done', detail: 'Declined', callId: call.callId };
          continue;
        }
        yield { type: 'tool', name: call.name, status: 'running', callId: call.callId, args };
      }

      try {
        const result = await params.execute(call.name, args);
        if (result.image) {
          yield {
            type: 'image',
            b64: result.image.b64,
            partial: false,
            callId: call.callId,
            ...(result.image.prompt !== undefined ? { prompt: result.image.prompt } : {}),
            ...(result.image.size !== undefined ? { size: result.image.size } : {}),
            ...(result.image.expandedPrompt !== undefined ? { expandedPrompt: result.image.expandedPrompt } : {}),
            ...(result.image.model !== undefined ? { model: result.image.model } : {}),
          };
        }
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: result.output });
        if (result.citations) {
          for (const c of result.citations) yield { type: 'citation', citation: c };
        }
        yield { type: 'tool', name: call.name, status: 'done', callId: call.callId };
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'Tool failed.';
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: `Error: ${detail}` });
        yield { type: 'tool', name: call.name, status: 'error', detail, callId: call.callId };
      }
    }

    input = outputs;
    previousResponseId = responseId;
  }

  yield { type: 'error', message: 'Stopped: tool-call budget exceeded.', code: 'budget_exceeded' };
}
