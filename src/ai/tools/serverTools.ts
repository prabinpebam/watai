// Builders for the service-side built-in tools (executed by the Responses API, not the
// browser). They carry no client `run` — the orchestrator just renders their activity. Wired
// into a turn by `assembleTools` only when the capability matrix + settings allow them.
import type { ResponsesTool } from '../responses';

// Code interpreter requires a `container`; `{ type: 'auto' }` lets the service provision a
// sandbox per call. Without it the Responses API rejects the tool with a 400.
export const codeInterpreterTool = (): ResponsesTool => ({
  type: 'code_interpreter',
  container: { type: 'auto' },
});

export const webSearchTool = (opts?: {
  userLocation?: { country?: string; city?: string; region?: string };
  contextSize?: 'low' | 'medium' | 'high';
}): ResponsesTool => ({
  type: 'web_search',
  ...(opts?.userLocation ? { user_location: { type: 'approximate', ...opts.userLocation } } : {}),
  search_context_size: opts?.contextSize ?? 'medium',
});

export const fileSearchTool = (vectorStoreIds: string[]): ResponsesTool => ({
  type: 'file_search',
  vector_store_ids: vectorStoreIds,
});
