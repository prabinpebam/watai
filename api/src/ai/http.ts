// Shared Azure OpenAI HTTP helpers (ported from the browser `ai/http.ts`). Server-side: the caller
// passes the resolved `baseUrl` + `key` (decrypted from the credential vault) on each request, so
// there is no dependency on browser storage. `v1Url`/`parseSse`/`isFoundryHost` are pure.

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
  /** Vault-resolved inference base URL (…/openai/v1) and key. */
  baseUrl: string;
  key: string;
  path: AiPath;
  /** Absolute URL override (bypasses baseUrl + path). */
  url?: string;
  method?: 'GET' | 'POST' | 'DELETE';
  body?: unknown;
  stream?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
  headers?: Record<string, string>;
  fetchImpl?: typeof fetch;
}

/**
 * The v1 inference API (chat, images, audio, responses) is served on the services.ai.azure.com host
 * for AI Foundry resources. Normalize a cognitiveservices host to it; non-Foundry hosts are used as
 * entered (the vault already stored a normalized base URL).
 */
export function v1Url(baseUrl: string, path: string): string {
  let host: string;
  try {
    host = new URL(baseUrl).host;
  } catch {
    return baseUrl.replace(/\/+$/, '') + path;
  }
  if (!/\.(services\.ai|cognitiveservices)\.azure\.com$/i.test(host)) {
    // Already canonical (vault-normalized to /openai/v1) — append the path to the base.
    return baseUrl.replace(/\/+$/, '').replace(/\/openai\/v1$/, '') + '/openai/v1' + path;
  }
  host = host.replace('.cognitiveservices.azure.com', '.services.ai.azure.com');
  return `https://${host}/openai/v1${path}`;
}

/** Whether the endpoint is an Azure AI Foundry host (can serve the agentic tool suite). */
export function isFoundryHost(baseUrl: string): boolean {
  try {
    return /\.(services\.ai|cognitiveservices)\.azure\.com$/i.test(new URL(baseUrl).host);
  } catch {
    return false;
  }
}

function withTimeout(
  signal: AbortSignal | undefined,
  timeoutMs: number,
): { signal: AbortSignal; cleanup: () => void } {
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

/** Shared fetch: Bearer auth on the v1 host + path (or an absolute `url` override). */
export async function aiFetch(req: AiRequest): Promise<Response> {
  const fetchImpl = req.fetchImpl ?? fetch;
  const url = req.url ?? v1Url(req.baseUrl, req.path);
  const { signal, cleanup } = withTimeout(req.signal, req.timeoutMs ?? 120_000);

  const headers: Record<string, string> = { Authorization: `Bearer ${req.key}`, ...req.headers };
  let payload: string | undefined;
  if (req.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    payload = JSON.stringify(req.body);
  }
  if (req.stream) headers['Accept'] = 'text/event-stream';

  try {
    return await fetchImpl(url, { method: req.method ?? 'POST', headers, body: payload, signal });
  } finally {
    cleanup();
  }
}

/** Parse an SSE stream into `data:` payloads, yielding raw JSON strings (skips [DONE]). */
export async function* parseSse(res: Response, signal?: AbortSignal): AsyncGenerator<string> {
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
