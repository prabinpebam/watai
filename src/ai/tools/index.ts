// Client-side tool registry (Path C) + capability-aware tool assembler. The model decides to
// call a tool by reading the conversation; the browser executes client `function` tools and
// returns a short result, while service-side tools (web_search/code_interpreter/file_search)
// run in the AI plane. Destructive tools are flagged so the orchestrator can require a
// confirmation. See documentation/agentic/08-implementation-plan.md §4.
import { repo } from '../../data';
import type { CapabilityMatrix, Settings } from '../../lib/types';
import type { ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';
import { generateImageTool, runGenerateImage } from './image';
import { searchHistoryTool, runSearchHistory, threadSummaryTool, runThreadSummary } from './history';
import { createThreadTool, runCreateThread, deleteThreadTool, runDeleteThread } from './threads';
import { addMemoryTool, runAddMemory, updateSettingTool, runUpdateSetting } from './memory';
import { codeInterpreterTool, fileSearchTool } from './serverTools';
import { webSearchTool, runWebSearch } from './webSearch';

export interface ClientTool {
  def: ResponsesTool;
  destructive?: boolean;
  run: (args: Record<string, unknown>) => Promise<ToolResult>;
}

/** The allow-listed client function tools, bound to the real `repo`. */
export const CLIENT_TOOLS: Record<string, ClientTool> = {
  generate_image: { def: generateImageTool, run: (a) => runGenerateImage(a) },
  search_history: { def: searchHistoryTool, run: (a) => runSearchHistory(a, repo) },
  get_thread_summary: { def: threadSummaryTool, run: (a) => runThreadSummary(a, repo) },
  create_thread: { def: createThreadTool, run: (a) => runCreateThread(a, repo) },
  add_memory: { def: addMemoryTool, run: (a) => runAddMemory(a, repo) },
  delete_thread: { def: deleteThreadTool, run: (a) => runDeleteThread(a, repo), destructive: true },
  update_setting: { def: updateSettingTool, run: (a) => runUpdateSetting(a, repo), destructive: true },
  web_search: { def: webSearchTool, run: (a) => runWebSearch(a) },
};

/** Inputs beyond settings that gate the tools. */
export interface ToolContext {
  /** Whether a Tavily API key is configured (gates the web_search function tool). */
  tavilyConfigured: boolean;
  vectorStoreIds: string[];
}

/** Build the tool list for a turn from capabilities + user settings + context. */
export function assembleTools(
  caps: CapabilityMatrix,
  s: Settings['tools'],
  ctx: ToolContext,
): ResponsesTool[] {
  const tools: ResponsesTool[] = [];
  // Client function tools (Path C) — available on any Responses endpoint.
  if (s?.imageAgent !== false) tools.push(generateImageTool);
  tools.push(
    searchHistoryTool,
    threadSummaryTool,
    createThreadTool,
    addMemoryTool,
    deleteThreadTool,
    updateSettingTool,
  );
  // Server tools — added only when the endpoint supports them AND the user enabled them.
  if (caps.codeInterpreter && s?.codeInterpreter) tools.push(codeInterpreterTool());
  // Web search is a client function tool backed by Tavily (BYO key) — works on any endpoint.
  if (s?.webSearch && ctx.tavilyConfigured) tools.push(webSearchTool);
  if (caps.fileSearch && s?.fileSearch && ctx.vectorStoreIds.length)
    tools.push(fileSearchTool(ctx.vectorStoreIds));
  return tools;
}

export function isDestructiveTool(name: string): boolean {
  return CLIENT_TOOLS[name]?.destructive === true;
}

/** Execute a client-side tool call the model emitted. Server tools never reach here. */
export async function executeTool(
  name: string,
  args: Record<string, unknown>,
): Promise<ToolResult> {
  const tool = CLIENT_TOOLS[name];
  if (!tool) return { output: `Unknown tool: ${name}` };
  return tool.run(args);
}

/** Back-compat default tool set (client function tools only). Prefer `assembleTools`. */
export const CHAT_TOOLS: ResponsesTool[] = Object.values(CLIENT_TOOLS).map((t) => t.def);
