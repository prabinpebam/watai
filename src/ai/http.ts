import { getApiConfig, getApiKey } from '../data/secureStore';
import { aiError } from './errors';
import type { ApiConfig } from '../lib/types';

export type AiPath =
  | '/chat/completions'
  | '/responses'
  | '/audio/transcriptions'
  | '/audio/speech'
  | '/images/generations'
  | '/images/edits'
  | '/files'
  | '/vector_stores';

export interface AiRequest {
  path: AiPath;
  /** Absolute URL override (used for the classic transcription path); bypasses baseUrl + path. */
  url?: string;
  /** HTTP method; defaults to POST. GET/DELETE are used by the file-search vector-store API. */
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  form?: FormData;
  stream?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  /** Extra request headers (e.g. the image-generation deployment header for the Responses API). */
  headers?: Record<string, string>;
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

// Azure transcription isn't exposed on the new /openai/v1 surface for AI Foundry
// resources, so it uses the classic deployment-scoped path on the cognitiveservices
// host (the resource's own portal sample). Everything else stays on /openai/v1.
export const TRANSCRIBE_API_VERSION = '2025-03-01-preview';

export function transcriptionUrl(baseUrl: string, deployment: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    host = baseUrl.replace(/^https?:\/\//, '').replace(/\/.*$/, '');
  }
  host = host.replace('.services.ai.azure.com', '.cognitiveservices.azure.com');
  return `https://${host}/openai/deployments/${encodeURIComponent(deployment)}/audio/transcriptions?api-version=${TRANSCRIBE_API_VERSION}`;
}

/**
 * The v1 inference API (chat, images, audio/speech, responses) is served on the
 * services.ai.azure.com host for AI Foundry resources. Normalize whichever Foundry
 * host the user pasted to that host + /openai/v1 so all of those endpoints resolve
 * even if they entered the cognitiveservices host. Non-Foundry hosts (e.g. classic
 * *.openai.azure.com) are used as entered.
 */
export function v1Url(baseUrl: string, path: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/\/+$/, '') + path;
  }
  if (!/\.(services\.ai|cognitiveservices)\.azure\.com$/i.test(host)) {
    return baseUrl.replace(/\/+$/, '') + path;
  }
  host = host.replace('.cognitiveservices.azure.com', '.services.ai.azure.com');
  return `https://${host}/openai/v1${path}`;
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

/** Shared fetch: Bearer auth. Uses the v1 host + path, or an absolute `url` override. */
export async function aiFetch(req: AiRequest): Promise<Response> {
  const { config, key } = await loadConfig();
  const url = req.url ?? v1Url(config.baseUrl, req.path);
  const { signal, cleanup } = withTimeout(req.signal, req.timeoutMs ?? 120000);

  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, ...req.headers };
  let payload: BodyInit | undefined;
  if (req.form) {
    payload = req.form; // browser sets multipart boundary
  } else if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(req.body);
  }
  if (req.stream) headers['Accept'] = 'text/event-stream';

  try {
    return await fetch(url, { method: req.method ?? 'POST', headers, body: payload, signal });
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
