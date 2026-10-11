// Server-side Azure OpenAI chat client (ported from the browser `ai/chat.ts`). Self-contained:
// the caller passes the resolved baseUrl + key (decrypted from the credential vault), so this has
// no dependency on browser storage. `fetchImpl` is injectable for tests.

import { aiFetch, parseSse, validatedAiUrl } from './http';
export { v1Url } from './http';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface ChatUsage {
  promptTokens?: number;
  completionTokens?: number;
}

export interface ChatStreamEvent {
  type: 'delta' | 'done' | 'error';
  textDelta?: string;
  usage?: ChatUsage;
  error?: { code: string; message: string };
}

export interface StreamChatParams {
  baseUrl: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  maxCompletionTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  signal?: AbortSignal;
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

async function errorFromResponse(res: Response): Promise<{ code: string; message: string }> {
  const status = res.status;
  let detail = '';
  try {
    const text = await res.text();
    const json = text ? JSON.parse(text) : undefined;
    detail = json?.error?.message ?? text ?? '';
  } catch {
    /* ignore */
  }
  const code =
    status === 401 || status === 403
      ? 'unauthorized'
      : status === 429
        ? 'rate_limited'
        : status >= 500
          ? 'server_error'
          : 'bad_request';
  return { code, message: detail || `Chat request failed (${status}).` };
}

/** Stream a chat completion. Yields `delta` text events, then a final `done` (or `error`). */
export async function* streamChat(p: StreamChatParams): AsyncGenerator<ChatStreamEvent> {
  const body: Record<string, unknown> = { model: p.model, messages: p.messages, stream: true };
  if (p.maxCompletionTokens) body.max_completion_tokens = p.maxCompletionTokens;
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;

  let res: Response;
  try {
    res = await aiFetch({
      baseUrl: p.baseUrl, key: p.key, path: '/chat/completions', body,
      stream: true, signal: p.signal, fetchImpl: p.fetchImpl,
      timeoutMs: p.timeoutMs ?? 180_000,
    });
  } catch (e) {
    yield { type: 'error', error: { code: 'network', message: e instanceof Error ? e.message : 'Network error.' } };
    return;
  }

  try {
    if (!res.ok) {
      yield { type: 'error', error: await errorFromResponse(res) };
      return;
    }
    let usage: ChatUsage | undefined;
    for await (const data of parseSse(res, p.signal)) {
      let json: { choices?: { delta?: { content?: string } }[]; usage?: { prompt_tokens?: number; completion_tokens?: number } };
      try {
        json = JSON.parse(data);
      } catch {
        continue;
      }
      const delta = json.choices?.[0]?.delta?.content;
      if (delta) yield { type: 'delta', textDelta: delta };
      if (json.usage) {
        usage = { promptTokens: json.usage.prompt_tokens, completionTokens: json.usage.completion_tokens };
      }
    }
    yield { type: 'done', usage };
  } catch (e) {
    yield { type: 'error', error: { code: 'stream_error', message: e instanceof Error ? e.message : 'Stream error.' } };
  }
}

export interface CompleteChatParams {
  baseUrl: string;
  key: string;
  model: string;
  messages: ChatMessage[];
  maxCompletionTokens?: number;
  reasoningEffort?: 'minimal' | 'low' | 'medium' | 'high';
  fetchImpl?: typeof fetch;
  timeoutMs?: number;
}

/**
 * Non-streaming chat completion → the assistant message text. For short utility calls (e.g.
 * generating a thread title). Returns '' on any failure so callers can fall back gracefully.
 */
export async function completeChat(p: CompleteChatParams): Promise<string> {
  const fetchImpl = p.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { model: p.model, messages: p.messages };
  if (p.maxCompletionTokens) body.max_completion_tokens = p.maxCompletionTokens;
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 30_000);
  try {
    const res = await fetchImpl(validatedAiUrl(p.baseUrl, '/chat/completions'), {
      method: 'POST',
      redirect: 'error',
      headers: { Authorization: `Bearer ${p.key}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    if (!res.ok) return '';
    const json = (await res.json()) as { choices?: Array<{ message?: { content?: string } }> };
    return json.choices?.[0]?.message?.content?.trim() ?? '';
  } catch {
    return '';
  } finally {
    clearTimeout(timer);
  }
}
