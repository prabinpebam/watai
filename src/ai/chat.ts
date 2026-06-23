import { aiFetch, loadConfig, parseSse } from './http';
import { normalizeHttpError, errorFromException } from './errors';
import type { AiError } from '../lib/types';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatParams {
  messages: ChatMessage[];
  model: string;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  maxCompletionTokens?: number;
  signal?: AbortSignal;
}

export interface ChatStreamEvent {
  type: 'delta' | 'done' | 'error';
  textDelta?: string;
  finishReason?: 'stop' | 'length' | 'content_filter' | 'tool_calls';
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: AiError;
}

// POST <baseUrl>/chat/completions { model, messages, max_completion_tokens, reasoning_effort, stream:true }
export async function* streamChat(p: ChatParams): AsyncGenerator<ChatStreamEvent> {
  const { config } = await loadConfig();
  const body: Record<string, unknown> = {
    model: p.model,
    messages: p.messages,
    stream: true,
  };
  if (p.maxCompletionTokens ?? config.chatDefaults.maxCompletionTokens) {
    body.max_completion_tokens = p.maxCompletionTokens ?? config.chatDefaults.maxCompletionTokens;
  }
  const effort = p.reasoningEffort ?? config.chatDefaults.reasoningEffort;
  if (effort) body.reasoning_effort = effort;

  let res: Response;
  try {
    res = await aiFetch({ path: '/chat/completions', body, stream: true, signal: p.signal });
  } catch (e) {
    yield { type: 'error', error: errorFromException(e, 'chat') };
    return;
  }

  if (!res.ok) {
    yield { type: 'error', error: await normalizeHttpError(res, 'chat') };
    return;
  }

  let finishReason: ChatStreamEvent['finishReason'];
  let usage: ChatStreamEvent['usage'];
  try {
    for await (const data of parseSse(res, p.signal)) {
      let json: any;
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const choice = json.choices?.[0];
      const delta: string | undefined = choice?.delta?.content;
      if (delta) yield { type: 'delta', textDelta: delta };
      if (choice?.finish_reason) finishReason = choice.finish_reason;
      if (json.usage) {
        usage = {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
        };
      }
    }
  } catch (e) {
    yield { type: 'error', error: errorFromException(e, 'chat') };
    return;
  }
  yield { type: 'done', finishReason, usage };
}

/** Non-streaming completion, used for short tasks like auto-titling. */
export async function completeChat(p: ChatParams): Promise<string> {
  const { config } = await loadConfig();
  const body: Record<string, unknown> = { model: p.model, messages: p.messages };
  if (p.maxCompletionTokens) body.max_completion_tokens = p.maxCompletionTokens;
  const effort = p.reasoningEffort ?? config.chatDefaults.reasoningEffort;
  if (effort) body.reasoning_effort = effort;
  const res = await aiFetch({ path: '/chat/completions', body, signal: p.signal });
  if (!res.ok) throw await normalizeHttpError(res, 'chat');
  const json = await res.json();
  return json.choices?.[0]?.message?.content ?? '';
}
