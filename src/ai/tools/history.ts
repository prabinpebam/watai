// Read-only history tools (Path C): let the agent find and quote the user's own saved
// conversations. Backed by `repo` (the persistence plane, app-token auth — never the AI
// key). `repo` is injected so the functions are unit-testable without IndexedDB.
import type { Repository } from '../../data/repository';
import type { ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';

const MAX_OUTPUT = 2000;
function bound(s: string): string {
  return s.length > MAX_OUTPUT ? `${s.slice(0, MAX_OUTPUT)}…` : s;
}

export const searchHistoryTool: ResponsesTool = {
  type: 'function',
  name: 'search_history',
  description:
    "Search the user's own saved Watai conversations. Use when the user refers to a past chat " +
    '(e.g. "the thread where we discussed the Bicep error"). Returns matching threads with snippets.',
  parameters: {
    type: 'object',
    properties: { query: { type: 'string', description: 'Keywords to search for.' } },
    required: ['query'],
  },
};

export async function runSearchHistory(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const query = typeof args.query === 'string' ? args.query.trim() : '';
  if (!query) return { output: 'No search query was provided.' };
  const hits = await repo.search(query);
  if (!hits.length) return { output: `No matching conversations found for "${query}".` };
  const lines = hits.slice(0, 8).map((h) => `- [${h.thread.id}] ${h.thread.title}: ${h.snippet}`);
  return { output: bound(`Found ${hits.length} matching conversation(s):\n${lines.join('\n')}`) };
}

export const threadSummaryTool: ResponsesTool = {
  type: 'function',
  name: 'get_thread_summary',
  description:
    "Read the messages of one of the user's saved conversations by id, to summarize or quote it.",
  parameters: {
    type: 'object',
    properties: { threadId: { type: 'string', description: 'The thread id (from search_history).' } },
    required: ['threadId'],
  },
};

export async function runThreadSummary(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const threadId = typeof args.threadId === 'string' ? args.threadId.trim() : '';
  if (!threadId) return { output: 'No thread id was provided.' };
  const msgs = await repo.listMessages(threadId);
  if (!msgs.length) return { output: 'That conversation has no messages.' };
  return { output: bound(msgs.map((m) => `${m.role}: ${m.content}`).join('\n')) };
}
