// Tavily web-search client (server-side port). The key comes from the credential vault and is
// passed in explicitly. Used by the server `web_search` tool executor in the run worker.
import { aiError } from './errors';

const TAVILY_BASE = 'https://api.tavily.com';

export interface TavilyResult {
  title: string;
  url: string;
  content: string;
  score?: number;
  favicon?: string;
}

export interface TavilySearchResponse {
  query: string;
  answer?: string;
  results: TavilyResult[];
  response_time?: number;
}

export interface TavilySearchOptions {
  maxResults?: number;
  topic?: 'general' | 'news' | 'finance';
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface TavilyDeps {
  key: string;
  fetchImpl?: typeof fetch;
}

async function tavilyFetch(path: string, init: RequestInit, deps: TavilyDeps): Promise<Response> {
  if (!deps.key) throw aiError('unauthorized', 'No Tavily API key configured.');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30_000);
  try {
    return await fetchImpl(`${TAVILY_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${deps.key}`, 'Content-Type': 'application/json', ...init.headers },
    });
  } finally {
    clearTimeout(timer);
  }
}

/** Map a non-OK Tavily response to a typed AiError (Tavily uses `{ detail: { error } }`). */
async function tavilyError(res: Response): Promise<never> {
  let detail = `Tavily error ${res.status}.`;
  try {
    const j = (await res.json()) as { detail?: { error?: string } };
    if (j?.detail?.error) detail = j.detail.error;
  } catch {
    /* non-json */
  }
  if (res.status === 401) throw aiError('unauthorized', 'Your Tavily API key was rejected.');
  if (res.status === 429) throw aiError('rate_limited', 'Tavily rate limit reached. Try again shortly.');
  if (res.status === 432 || res.status === 433)
    throw aiError('forbidden', `Tavily usage limit reached. ${detail}`);
  throw aiError('server_error', detail);
}

/** Run a web search. Defaults: basic depth (1 credit), 5 results, an LLM answer, favicons. */
export async function tavilySearch(
  query: string,
  deps: TavilyDeps,
  opts: TavilySearchOptions = {},
): Promise<TavilySearchResponse> {
  const body: Record<string, unknown> = {
    query,
    search_depth: 'basic',
    max_results: opts.maxResults ?? 5,
    include_answer: true,
    include_favicon: true,
    topic: opts.topic ?? 'general',
    ...(opts.timeRange ? { time_range: opts.timeRange } : {}),
  };
  const res = await tavilyFetch('/search', { method: 'POST', body: JSON.stringify(body) }, deps);
  if (!res.ok) await tavilyError(res);
  return (await res.json()) as TavilySearchResponse;
}
