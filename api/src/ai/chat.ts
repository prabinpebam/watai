// Server-side Azure OpenAI chat client (ported from the browser `ai/chat.ts`). Self-contained:
// the caller passes the resolved baseUrl + key (decrypted from the credential vault), so this has
// no dependency on browser storage. `fetchImpl` is injectable for tests.

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

/**
 * Resolve the v1 inference URL. AI Foundry resources serve `/openai/v1` on the
 * services.ai.azure.com host; normalize a cognitiveservices host to it. Other hosts are used
 * as entered (already canonical, since the vault stored a normalized base URL).
 */
export function v1Url(baseUrl: string, path: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/\/+$/, '') + path;
  }
  if (!/\.(services\.ai|cognitiveservices)\.azure\.com$/i.test(host)) {
    // Already includes /openai/v1 (vault-normalized) — append the path to the base as-is.
    return baseUrl.replace(/\/+$/, '').replace(/\/openai\/v1$/, '') + '/openai/v1' + path;
  }
  host = host.replace('.cognitiveservices.azure.com', '.services.ai.azure.com');
  return `https://${host}/openai/v1${path}`;
}

/** Parse a Server-Sent-Events stream into the raw `data:` payloads (skipping `[DONE]`). */
async function* parseSse(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
  if (!res.body) return;
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  try {
    while (true) {
      if (signal?.aborted) break;
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      let idx: number;
      while ((idx = buffer.indexOf('\n\n')) >= 0) {
        const block = buffer.slice(0, idx);
        buffer = buffer.slice(idx + 2);
        for (const line of block.split('\n')) {
          const m = /^data:\s?(.*)$/.exec(line.trim());
          if (!m) continue;
          if (m[1] === '[DONE]') return;
          yield m[1];
        }
      }
    }
  } finally {
    reader.releaseLock();
  }
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
  const fetchImpl = p.fetchImpl ?? fetch;
  const body: Record<string, unknown> = { model: p.model, messages: p.messages, stream: true };
  if (p.maxCompletionTokens) body.max_completion_tokens = p.maxCompletionTokens;
  if (p.reasoningEffort) body.reasoning_effort = p.reasoningEffort;

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), p.timeoutMs ?? 180_000);
  const onAbort = () => ctrl.abort();
  if (p.signal) {
    if (p.signal.aborted) ctrl.abort();
    else p.signal.addEventListener('abort', onAbort);
  }

  let res: Response;
  try {
    res = await fetchImpl(v1Url(p.baseUrl, '/chat/completions'), {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${p.key}`,
        'Content-Type': 'application/json',
        Accept: 'text/event-stream',
      },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(timer);
    p.signal?.removeEventListener('abort', onAbort);
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
  } finally {
    clearTimeout(timer);
    p.signal?.removeEventListener('abort', onAbort);
  }
}
