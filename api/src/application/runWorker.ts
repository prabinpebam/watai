import { isActive } from '../domain/run';
import type { ServiceClock } from './threadService';
import type { DecryptedCredentials } from './credentialService';
import type { RunStore } from '../ports/runStore';
import type { MessageRecord, MessageStore } from '../ports/messageStore';
import type { MessageToolCall, MessageCitation } from '../domain/message';
import type { ThreadStore } from '../ports/threadStore';
import {
  runAgent as defaultRunAgent,
  type AgentEvent,
  type RunAgentParams,
  type ToolExecute,
  type Turn,
} from '../ai/orchestrator';
import type { ResponsesCitation, ResponsesTool } from '../ai/responses';
import { tavilySearch } from '../ai/tavily';

export interface CredentialReader {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface RunWorkerDeps {
  runStore: RunStore;
  messageStore: MessageStore;
  threadStore: ThreadStore;
  credentials: CredentialReader;
  /** The agentic loop (Responses API). Injectable for tests. */
  runAgent?: (p: RunAgentParams) => AsyncGenerator<AgentEvent>;
  clock: ServiceClock;
  /** ms between throttled incremental message upserts (default 250). */
  flushIntervalMs?: number;
  /** Injectable fetch for the web-search executor (tests). */
  fetchImpl?: typeof fetch;
}

const DEFAULT_FLUSH_MS = 250;

/** Minimal system prompt. Personalization (about-you / response-style / memory) is a follow-up. */
function systemPrompt(creds: DecryptedCredentials): string {
  const lines = ['You are Watai, a helpful AI assistant. Be accurate and concise.'];
  if (creds.tavilyKey) {
    lines.push('When current or factual web information is needed, use the web_search tool and cite the sources.');
  }
  return lines.join('\n');
}

/** Responses turns: system + the user/assistant history (excluding soft-deleted rows and the
 *  assistant message this run is producing). */
function buildTurns(system: string, messages: MessageRecord[], assistantMessageId: string): Turn[] {
  const turns: Turn[] = [{ role: 'system', text: system }];
  for (const m of messages) {
    if (m.deletedAt || m.id === assistantMessageId) continue;
    if (m.role === 'user' || m.role === 'assistant') turns.push({ role: m.role, text: m.content });
  }
  return turns;
}

/** Tools offered to the model this run. Web search is gated on a configured Tavily key. */
function assembleTools(creds: DecryptedCredentials): ResponsesTool[] {
  const tools: ResponsesTool[] = [];
  if (creds.tavilyKey) {
    tools.push({
      type: 'function',
      name: 'web_search',
      description:
        'Search the web for current, factual information. Returns titles, URLs, and snippets.',
      parameters: {
        type: 'object',
        properties: { query: { type: 'string', description: 'The search query.' } },
        required: ['query'],
        additionalProperties: false,
      },
    });
  }
  return tools;
}

/** The tool executor: runs function tools server-side and returns output + grounding citations. */
function makeExecute(creds: DecryptedCredentials, fetchImpl?: typeof fetch): ToolExecute {
  return async (name, args) => {
    if (name === 'web_search') {
      if (!creds.tavilyKey) return { output: 'Web search is not configured.' };
      const query = String((args as { query?: unknown }).query ?? '').trim();
      if (!query) return { output: 'No search query was provided.' };
      const r = await tavilySearch(query, { key: creds.tavilyKey, fetchImpl });
      const citations: ResponsesCitation[] = r.results.map((x) => ({
        source: 'web',
        url: x.url,
        title: x.title,
        ...(x.content ? { content: x.content.slice(0, 1000) } : {}),
        ...(x.favicon ? { favicon: x.favicon } : {}),
      }));
      const body = r.results
        .map((x, i) => `[${i + 1}] ${x.title}\n${x.url}\n${(x.content ?? '').slice(0, 500)}`)
        .join('\n\n');
      const output = (r.answer ? `Answer: ${r.answer}\n\n` : '') + body;
      return { output, citations };
    }
    return { output: `Unknown tool: ${name}` };
  };
}

function toolKind(name: string): MessageToolCall['kind'] {
  if (name === 'web_search') return 'web_search';
  if (name === 'code_interpreter') return 'code_interpreter';
  if (name === 'file_search') return 'file_search';
  if (name === 'generate_image') return 'image';
  return 'function';
}

function mapCitation(c: ResponsesCitation): MessageCitation {
  return {
    ...(c.source ? { source: c.source } : {}),
    ...(c.url ? { url: c.url } : {}),
    ...(c.title ? { title: c.title } : {}),
    ...(c.content ? { content: c.content.slice(0, 4000) } : {}),
    ...(c.favicon ? { favicon: c.favicon } : {}),
    ...(c.fileId ? { fileId: c.fileId } : {}),
    ...(c.filename ? { filename: c.filename } : {}),
    ...(c.startIndex !== undefined ? { startIndex: c.startIndex } : {}),
    ...(c.endIndex !== undefined ? { endIndex: c.endIndex } : {}),
  };
}

/**
 * Process one run end-to-end on the server, independently of any client: load the user's decrypted
 * credentials, assemble the history, run the agentic loop (Responses API — text + web search + any
 * future tools), and upsert the assistant message into Cosmos incrementally (text, tool cards,
 * citations) — finalizing it `complete` / `error` / `interrupted` and releasing the run. Because
 * this runs in a queue worker (not the request), closing the app cannot interrupt it. Idempotent:
 * a redelivered message that finds a terminal/canceled run is a no-op.
 */
export async function processRun(deps: RunWorkerDeps, threadId: string, runId: string): Promise<void> {
  const { runStore, messageStore, threadStore, credentials, clock } = deps;
  const runAgent = deps.runAgent ?? defaultRunAgent;
  const flushMs = deps.flushIntervalMs ?? DEFAULT_FLUSH_MS;

  const run = await runStore.get(threadId, runId);
  if (!run || !isActive(run.status)) return; // already finalized / canceled — idempotent

  await runStore.put({ ...run, status: 'running', startedAt: clock.now(), heartbeatAt: clock.now() });

  const orderAt = run.createdAt;
  const toolCalls = new Map<string, MessageToolCall>();
  const citations: MessageCitation[] = [];
  const seenCitations = new Set<string>();
  let acc = '';
  let lastFlush = 0;
  let flushed = false;
  let err: { code: string; message: string } | undefined;
  let model: string | undefined;

  const buildAssistant = (status: MessageRecord['status']): MessageRecord => ({
    id: run.assistantMessageId,
    threadId,
    userId: run.userId,
    role: 'assistant',
    content: acc,
    status,
    createdAt: orderAt,
    orderAt,
    deletedAt: null,
    ...(model ? { model } : {}),
    ...(toolCalls.size ? { toolCalls: [...toolCalls.values()] } : {}),
    ...(citations.length ? { citations } : {}),
  });

  const flush = async (force = false): Promise<void> => {
    const now = Date.now();
    if (force || !flushed || now - lastFlush > flushMs) {
      flushed = true;
      lastFlush = now;
      await messageStore.append(buildAssistant('streaming'));
    }
  };

  try {
    const creds = await credentials.getDecrypted(run.userId);
    model = creds.models.chat;
    const turns = buildTurns(
      systemPrompt(creds),
      await messageStore.list(threadId),
      run.assistantMessageId,
    );
    const tools = assembleTools(creds);
    const execute = makeExecute(creds, deps.fetchImpl);

    for await (const ev of runAgent({ baseUrl: creds.baseUrl, key: creds.key, model, turns, tools, execute })) {
      if (ev.type === 'text') {
        acc += ev.delta;
        await flush();
      } else if (ev.type === 'tool') {
        const id = ev.callId ?? ev.name;
        toolCalls.set(id, {
          id,
          kind: toolKind(ev.name),
          name: ev.name,
          status: ev.status,
          ...(ev.detail ? { summary: ev.detail.slice(0, 400) } : {}),
          ...(ev.result ? { resultPreview: ev.result.slice(0, 4000) } : {}),
        });
        await flush(true);
      } else if (ev.type === 'citation') {
        const c = ev.citation;
        const key = c.url ?? c.fileId ?? c.title ?? '';
        if (key && !seenCitations.has(key)) {
          seenCitations.add(key);
          citations.push(mapCitation(c));
          await flush(true);
        }
      } else if (ev.type === 'error') {
        err = { code: 'internal', message: ev.message };
      }
    }
  } catch (e) {
    err = { code: 'internal', message: e instanceof Error ? e.message : 'Generation failed.' };
  }

  // A cancel may have landed while we streamed — re-read the run before finalizing.
  const current = await runStore.get(threadId, runId);
  const canceled = current?.status === 'canceled';

  const finalStatus: MessageRecord['status'] = canceled ? 'interrupted' : err ? 'error' : 'complete';
  await messageStore.append(buildAssistant(finalStatus));

  // Bump the thread so the assistant message syncs and the thread surfaces as recently active.
  const thread = await threadStore.get(run.userId, threadId);
  if (thread) {
    await threadStore.put({
      ...thread,
      lastMessagePreview: (acc.trim() || (err ? 'Error' : '')).slice(0, 140),
      updatedAt: clock.now(),
    });
  }

  if (!canceled) {
    await runStore.put({
      ...run,
      status: err ? 'error' : 'complete',
      error: err ?? null,
      startedAt: run.startedAt ?? orderAt,
      endedAt: clock.now(),
    });
  }
}
