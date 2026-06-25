// Tavily web-search client (browser → api.tavily.com with a BYO key). Tavily allows CORS, so
// the key stays in the browser and never reaches Watai's backend — same privacy invariant as
// the AI key. Used by the client-side `web_search` function tool. See
// documentation/agentic/10-web-search-tavily.md.
import { aiError } from './errors';
import { getTavilyKey as defaultGetKey } from '../data/secureStore';

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

/** Account/key usage details from GET /usage (credits used this billing cycle). */
export interface TavilyUsage {
  key: { usage: number; limit: number | null; search_usage?: number };
  account?: { current_plan?: string; plan_usage?: number; plan_limit?: number };
}

export interface TavilySearchOptions {
  maxResults?: number;
  topic?: 'general' | 'news' | 'finance';
  timeRange?: 'day' | 'week' | 'month' | 'year';
}

export interface TavilyDeps {
  fetchImpl?: typeof fetch;
  getKey?: typeof defaultGetKey;
}

async function tavilyFetch(path: string, init: RequestInit, deps: TavilyDeps): Promise<Response> {
  const getKey = deps.getKey ?? defaultGetKey;
  const key = await getKey();
  if (!key) throw aiError('unauthorized', 'No Tavily API key. Add one in Settings → Tools → Web search.');
  const fetchImpl = deps.fetchImpl ?? fetch;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 30000);
  try {
    return await fetchImpl(`${TAVILY_BASE}${path}`, {
      ...init,
      signal: ctrl.signal,
      headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json', ...init.headers },
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
  if (res.status === 401) throw aiError('unauthorized', 'Your Tavily API key was rejected. Check it in Settings.');
  if (res.status === 429) throw aiError('rate_limited', 'Tavily rate limit reached. Try again shortly.');
  if (res.status === 432 || res.status === 433)
    throw aiError('forbidden', `Tavily usage limit reached. ${detail}`);
  throw aiError('server_error', detail);
}

/** Run a web search. Defaults: basic depth (1 credit), 5 results, an LLM answer, favicons. */
export async function tavilySearch(
  query: string,
  opts: TavilySearchOptions = {},
  deps: TavilyDeps = {},
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

/** Fetch credit-usage details for the configured key. */
export async function tavilyUsage(deps: TavilyDeps = {}): Promise<TavilyUsage> {
  const res = await tavilyFetch('/usage', { method: 'GET' }, deps);
  if (!res.ok) await tavilyError(res);
  return (await res.json()) as TavilyUsage;
}
