// Thread tools (Path C). `create_thread` is benign; `delete_thread` is destructive and the
// orchestrator requires explicit user confirmation before executing it. Backed by `repo`
// (injected for testability).
import type { Repository } from '../../data/repository';
import type { ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';

export const createThreadTool: ResponsesTool = {
  type: 'function',
  name: 'create_thread',
  description: 'Create a new, empty conversation (thread) with a title. Returns the new thread id.',
  parameters: {
    type: 'object',
    properties: { title: { type: 'string', description: 'A short title for the new conversation.' } },
    required: [],
  },
};

export async function runCreateThread(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const title = typeof args.title === 'string' && args.title.trim() ? args.title.trim() : 'New chat';
  const thread = await repo.createThread({ title });
  return { output: `Created conversation "${thread.title}" (id ${thread.id}).` };
}

export const deleteThreadTool: ResponsesTool = {
  type: 'function',
  name: 'delete_thread',
  description:
    "Permanently delete one of the user's conversations by id. Destructive — the user is asked to confirm first.",
  parameters: {
    type: 'object',
    properties: { threadId: { type: 'string', description: 'The id of the thread to delete.' } },
    required: ['threadId'],
  },
};

export async function runDeleteThread(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const threadId = typeof args.threadId === 'string' ? args.threadId.trim() : '';
  if (!threadId) return { output: 'No thread id was provided.' };
  await repo.deleteThread(threadId);
  return { output: `Deleted conversation ${threadId}.` };
}
