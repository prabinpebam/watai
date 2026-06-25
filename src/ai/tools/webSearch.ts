// Client-side `web_search` function tool (Path C) backed by Tavily. The model calls it with a
// query; the browser runs the Tavily search (BYO key) and returns a bounded text summary to the
// model plus citations for the Sources strip. Works on ANY endpoint — no Foundry/Bing needed.
import { tavilySearch as defaultSearch } from '../tavily';
import type { ResponsesCitation, ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';

const TOPICS = ['general', 'news', 'finance'] as const;
const TIME_RANGES = ['day', 'week', 'month', 'year'] as const;

export const webSearchTool: ResponsesTool = {
  type: 'function',
  name: 'web_search',
  description:
    'Search the web for current, recent, or factual information and get cited sources. Use this ' +
    'whenever the user asks about current events, recent data, prices, releases, or any fact you ' +
    'are not certain of. Returns a short answer plus ranked results with URLs to cite.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'The search query.' },
      topic: {
        type: 'string',
        enum: [...TOPICS],
        description: 'Optional. Use "news" for current events, "finance" for markets/companies.',
      },
      time_range: {
        type: 'string',
        enum: [...TIME_RANGES],
        description: 'Optional. Restrict results to a recent window (e.g. "week" for this week).',
      },
    },
    required: ['query'],
  },
};

interface Deps {
  search?: typeof defaultSearch;
}

/** Execute web_search: run Tavily, summarize for the model, and return web citations for the UI. */
export async function runWebSearch(
  args: Record<string, unknown>,
  deps: Deps = {},
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { output: 'No query was provided, so no web search ran.' };

  const topic = (TOPICS as readonly string[]).includes(args.topic as string)
    ? (args.topic as (typeof TOPICS)[number])
    : undefined;
  const timeRange = (TIME_RANGES as readonly string[]).includes(args.time_range as string)
    ? (args.time_range as (typeof TIME_RANGES)[number])
    : undefined;

  const search = deps.search ?? defaultSearch;
  let resp;
  try {
    resp = await search(query, { topic, timeRange });
  } catch (e) {
    return { output: `Web search failed: ${e instanceof Error ? e.message : 'unknown error'}.` };
  }

  // Bounded text the model reads to write its grounded answer.
  const lines: string[] = [];
  if (resp.answer) lines.push(`Answer: ${resp.answer}`);
  resp.results.forEach((r, i) => {
    const snippet = (r.content ?? '').replace(/\s+/g, ' ').trim().slice(0, 300);
    lines.push(`[${i + 1}] ${r.title}\n${snippet}\n${r.url}`);
  });
  const output = lines.join('\n\n').slice(0, 4000) || 'No results found.';

  const citations: ResponsesCitation[] = resp.results.map((r) => ({
    source: 'web',
    url: r.url,
    title: r.title,
    ...(r.favicon ? { favicon: r.favicon } : {}),
  }));

  return { output, citations };
}
