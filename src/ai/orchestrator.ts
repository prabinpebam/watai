// The agent orchestrator: the tool-calling loop that turns one user turn into a streamed
// answer plus any tool steps. It demultiplexes the Responses stream into text, images, and
// tool activity, executes client-side function calls, and continues the run with their
// output (keeping context via previous_response_id) until the model stops or a budget is
// hit. See documentation/agentic/02-architecture-and-adoption.md §4.
import {
  streamResponses,
  toInputMessages,
  type ResponsesEvent,
  type ResponsesInputItem,
  type ResponsesParams,
  type ResponsesTool,
} from './responses';

export interface Turn {
  role: 'system' | 'user' | 'assistant';
  text: string;
}

/** Result of a client-executed tool: `output` goes back to the model; `image` renders in chat. */
export interface ToolResult {
  output: string;
  image?: { b64: string; prompt?: string; size?: string };
}

export type ToolExecute = (name: string, args: Record<string, unknown>) => Promise<ToolResult>;

export type AgentEvent =
  | { type: 'text'; delta: string }
  | { type: 'image'; b64: string; partial: boolean; prompt?: string; size?: string }
  | { type: 'tool'; name: string; status: 'running' | 'done' | 'error'; detail?: string }
  | { type: 'done' }
  | { type: 'error'; message: string };

export interface RunAgentParams {
  model: string;
  turns: Turn[];
  tools: ResponsesTool[];
  execute: ToolExecute;
  headers?: Record<string, string>;
  signal?: AbortSignal;
  /** Max model<->tool round-trips before stopping (cost guard). */
  maxIterations?: number;
  /** Injectable stream for tests; defaults to the real Responses client. */
  streamFn?: (p: ResponsesParams) => AsyncGenerator<ResponsesEvent>;
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
      model: params.model,
      input,
      tools: params.tools,
      toolChoice: 'auto',
      previousResponseId,
      headers: params.headers,
      signal: params.signal,
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
        case 'functionCall':
          pending.push(ev);
          yield { type: 'tool', name: ev.name, status: 'running' };
          break;
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

    // Execute each client-side function call and feed the outputs back into the run.
    const outputs: ResponsesInputItem[] = [];
    for (const call of pending) {
      let args: Record<string, unknown> = {};
      try {
        args = call.arguments ? (JSON.parse(call.arguments) as Record<string, unknown>) : {};
      } catch {
        /* malformed args -> empty object; the tool validates at its boundary */
      }
      try {
        const result = await params.execute(call.name, args);
        if (result.image) {
          yield {
            type: 'image',
            b64: result.image.b64,
            partial: false,
            ...(result.image.prompt !== undefined ? { prompt: result.image.prompt } : {}),
            ...(result.image.size !== undefined ? { size: result.image.size } : {}),
          };
        }
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: result.output });
        yield { type: 'tool', name: call.name, status: 'done' };
      } catch (e) {
        const detail = e instanceof Error ? e.message : 'Tool failed.';
        outputs.push({ type: 'function_call_output', call_id: call.callId, output: `Error: ${detail}` });
        yield { type: 'tool', name: call.name, status: 'error', detail };
      }
    }

    input = outputs;
    previousResponseId = responseId;
  }

  yield { type: 'error', message: 'Stopped: tool-call budget exceeded.' };
}
