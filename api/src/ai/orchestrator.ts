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

/** An image surfaced by a tool (e.g. web search) that the UI can render + offer to attach. */
export interface WebImageItem {
  url: string;
  description?: string;
  sourceUrl?: string;
}

/** Result of an executed tool: `output` goes back to the model; `image` renders in chat. */
export interface ToolResult {
  output: string;
  image?: { b64: string; prompt?: string; size?: string; expandedPrompt?: string; model?: string };
  citations?: ResponsesCitation[];
  webImages?: WebImageItem[];
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
      /** Code-interpreter container id (so the worker can capture generated artifacts). */
      containerId?: string;
    }
  | { type: 'done' }
  | { type: 'error'; message: string; code?: AiErrorCode }
  | { type: 'citation'; citation: ResponsesCitation }
  | { type: 'webImage'; webImage: WebImageItem };

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
  /** Initial Responses tool-choice policy. A semantic manager can require the selected specialist. */
  toolChoice?: 'auto' | 'required' | 'none';
  /** Tool that must complete before a user-facing completion is accepted. */
  requiredToolName?: string;
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
  let requiredAttempted = false;
  let requiredSucceeded = false;

  for (let iteration = 0; iteration < maxIterations; iteration++) {
    let responseId: string | undefined;
    const pending: Array<{ callId: string; name: string; arguments: string }> = [];
    const bufferedText: string[] = [];
    const enforcingRequiredTool = !!params.requiredToolName && !requiredAttempted;
    const toolChoice = enforcingRequiredTool
      ? (params.toolChoice ?? 'required')
      : requiredAttempted
        ? 'none'
        : (params.toolChoice ?? 'auto');

    for await (const ev of stream({
      baseUrl: params.baseUrl,
      key: params.key,
      model: params.model,
      input,
      tools: params.tools,
      toolChoice,
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
          // A model can occasionally emit confident prose before honoring a required action.
          // Hold it until the tool call is observed so "Done" can never escape without execution.
          if (enforcingRequiredTool) bufferedText.push(ev.delta);
          else yield { type: 'text', delta: ev.delta };
          break;
        case 'image':
          yield { type: 'image', b64: ev.b64, partial: ev.partial };
          break;
        case 'serverTool':
          if (ev.kind === params.requiredToolName && ev.status === 'running') requiredAttempted = true;
          if (ev.kind === params.requiredToolName && ev.status === 'done') requiredSucceeded = true;
          yield {
            type: 'tool',
            name: ev.kind,
            status: ev.status,
            callId: ev.callId,
            ...(ev.summary ? { detail: ev.summary } : {}),
            ...(ev.detail ? { result: ev.detail } : {}),
            ...(ev.containerId ? { containerId: ev.containerId } : {}),
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
      if (params.requiredToolName && !requiredSucceeded) {
        yield {
          type: 'error',
          message: `The required ${params.requiredToolName} action did not complete.`,
        };
        return;
      }
      for (const delta of bufferedText) yield { type: 'text', delta };
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
        if (call.name === params.requiredToolName) requiredAttempted = true;
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
        if (call.name === params.requiredToolName) requiredSucceeded = true;
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: result.output });
        if (result.citations) {
          for (const c of result.citations) yield { type: 'citation', citation: c };
        }
        if (result.webImages) {
          for (const w of result.webImages) yield { type: 'webImage', webImage: w };
        }
        yield { type: 'tool', name: call.name, status: 'done', callId: call.callId };
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'Tool failed.';
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: `Error: ${detail}` });
        yield { type: 'tool', name: call.name, status: 'error', detail, callId: call.callId };
      }
    }

    if (params.requiredToolName && requiredAttempted && !requiredSucceeded) {
      yield {
        type: 'error',
        message: `The required ${params.requiredToolName} action failed.`,
      };
      return;
    }
    for (const delta of bufferedText) yield { type: 'text', delta };

    input = outputs;
    previousResponseId = responseId;
  }

  yield { type: 'error', message: 'Stopped: tool-call budget exceeded.', code: 'budget_exceeded' };
}
