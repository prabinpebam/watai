import { getApiConfig, getApiKey } from '../data/secureStore';
import { aiError } from './errors';
import type { ApiConfig } from '../lib/types';

export type AiPath =
  | '/chat/completions'
  | '/responses'
  | '/audio/transcriptions'
  | '/audio/speech'
  | '/images/generations'
  | '/images/edits';

export interface AiRequest {
  path: AiPath;
  body?: unknown;
  form?: FormData;
  stream?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}

export async function loadConfig(): Promise<{ config: ApiConfig; key: string }> {
  const config = await getApiConfig();
  const key = await getApiKey();
  if (!config?.baseUrl) {
    throw aiError('unsupported_capability', 'No endpoint configured. Add one in Settings.');
  }
  if (!key) {
    throw aiError('unauthorized', 'No API key configured. Add one in Settings.');
  }
  return { config, key };
}

function withTimeout(signal: AbortSignal | undefined, timeoutMs: number): {
  signal: AbortSignal;
  cleanup: () => void;
} {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener('abort', onAbort);
  }
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  return {
    signal: ctrl.signal,
    cleanup: () => {
      clearTimeout(timer);
      signal?.removeEventListener('abort', onAbort);
    },
  };
}

/** Shared fetch: Bearer auth, model goes in the caller's body. No api-version, no path deployment. */
export async function aiFetch(req: AiRequest): Promise<Response> {
  const { config, key } = await loadConfig();
  const url = config.baseUrl.replace(/\/+$/, '') + req.path;
  const { signal, cleanup } = withTimeout(req.signal, req.timeoutMs ?? 120000);

  const headers: Record<string, string> = { Authorization: `Bearer ${key}` };
  let payload: BodyInit | undefined;
  if (req.form) {
    payload = req.form; // browser sets multipart boundary
  } else if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(req.body);
  }
  if (req.stream) headers['Accept'] = 'text/event-stream';

  try {
    return await fetch(url, { method: 'POST', headers, body: payload, signal });
  } finally {
    cleanup();
  }
}

/** Parse an SSE stream into `data:` payloads, yielding raw JSON strings (skips [DONE]). */
export async function* parseSse(
  res: Response,
  signal?: AbortSignal,
): AsyncGenerator<string> {
  const reader = res.body?.getReader();
  if (!reader) return;
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    if (signal?.aborted) {
      await reader.cancel();
      return;
    }
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const lines = buffer.split('\n');
    buffer = lines.pop() ?? '';
    for (const raw of lines) {
      const line = raw.trim();
      if (!line.startsWith('data:')) continue;
      const data = line.slice(5).trim();
      if (data === '[DONE]') return;
      if (data) yield data;
    }
  }
}
