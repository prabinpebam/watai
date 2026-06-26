// Persistent run manager: owns assistant generation so it survives view navigation and runs
// concurrently across threads. The chat view subscribes to the in-progress run for its thread
// and renders it; on completion the final message is persisted to the repo. A throttled snapshot
// of the in-progress message is kept in IndexedDB so a browser close mid-stream is not fully
// lost — orphaned snapshots are restored as `interrupted` messages on next load.
import { create } from 'zustand';
import { repo } from '../../data';
import { getApiConfig, getTavilyKey } from '../../data/secureStore';
import { idbKvStore } from '../../data/sync/kvStore';
import { newId } from '../../lib/ids';
import { streamChat, completeChat, type ChatMessage } from '../../ai/chat';
import { mockAgentStream } from '../../ai/mockAi';
import { isAiError } from '../../ai/errors';
import { detectCapabilities } from '../../ai/capabilities';
import { runAgent, type AgentEvent, type Turn } from '../../ai/orchestrator';
import { assembleTools, executeTool, isDestructiveTool, resolveVectorStores } from '../../ai/tools';
import { b64ToBlob } from '../../ai/image';
import { useUi } from '../../state/store';
import type { AiError, CapabilityMatrix, Citation, ImageRef, Message, ToolCall } from '../../lib/types';

export const DEFAULT_CHAT_MODEL = 'gpt-5.4';

const kv = idbKvStore();
const SNAPSHOT_PREFIX = 'run.active.';

/** Human labels for the tool-activity cards shown in the transcript. */
const TOOL_LABELS: Record<string, string> = {
  search_history: 'Searched your chat history',
  get_thread_summary: 'Read a past conversation',
  create_thread: 'Created a conversation',
  delete_thread: 'Deleted a conversation',
  add_memory: 'Saved to memory',
  update_setting: 'Updated a setting',
  web_search: 'Searched the web',
  code_interpreter: 'Ran code',
  file_search: 'Searched your files',
};

/** Service-side tools (rendered as cards; never executed in the browser). */
const SERVER_TOOLS = new Set(['web_search', 'code_interpreter', 'file_search']);

/** Read a blob as a data URL (for vision `input_image`). */
function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error ?? new Error('blob read failed'));
    r.readAsDataURL(blob);
  });
}

/** Resolve a user message's image attachments to data/remote URLs for vision input. */
async function imageUrlsForMessage(m: Message): Promise<string[]> {
  const atts = (m.attachments ?? []).filter((a) => a.mime.startsWith('image/'));
  const urls: string[] = [];
  for (const a of atts) {
    if (a.blobPath && /^(data:|https?:)/.test(a.blobPath)) urls.push(a.blobPath);
    else if (a.localBlobKey) {
      const blob = await repo.getBlob(a.localBlobKey).catch(() => null);
      if (blob) urls.push(await blobToDataUrl(blob));
    }
  }
  return urls;
}

/** Most recent uploaded image (blob) in history — the reference for generate_image edits. */
async function latestReferenceImage(history: Message[]): Promise<Blob | null> {
  for (let i = history.length - 1; i >= 0; i--) {
    const m = history[i];
    if (m.role !== 'user') continue;
    const att = (m.attachments ?? []).find((a) => a.mime.startsWith('image/') && a.localBlobKey);
    if (att?.localBlobKey) return repo.getBlob(att.localBlobKey).catch(() => null);
  }
  return null;
}

/** A concise nudge so the model actually USES the available service tools, not prose. */
function agenticToolGuidance(tools: { type?: string; name?: string }[]): string {
  const has = (t: string) => tools.some((x) => x.type === t);
  const lines: string[] = [];
  if (has('code_interpreter'))
    lines.push(
      '- For any calculation, data analysis, simulation, or chart/plot request, use the code ' +
        'interpreter to compute and render the result. Do not estimate or hand-wave the math in prose.',
    );
  if (has('file_search'))
    lines.push("- When the answer may be in the user's uploaded documents, use file search and cite them.");
  if (tools.some((x) => x.name === 'web_search'))
    lines.push('- When current or factual web information is needed, use web search and cite the sources.');
  return lines.length ? `Tool use:\n${lines.join('\n')}` : '';
}

/** Confirm a destructive tool before it runs (prompt-injection guard). */
async function confirmDestructive({
  name,
  args,
}: {
  name: string;
  args: Record<string, unknown>;
}): Promise<boolean> {
  const what =
    name === 'delete_thread'
      ? 'delete a conversation'
      : name === 'update_setting'
        ? `change the setting "${String(args.path ?? '')}"`
        : `run ${name}`;
  return useUi.getState().requestConfirm({
    title: 'Confirm action',
    message: `Allow the assistant to ${what}?`,
    confirmLabel: 'Allow',
    danger: name === 'delete_thread',
  });
}

interface ActiveRun {
  threadId: string;
  /** The in-progress assistant message (status 'streaming'). */
  message: Message;
  controller: AbortController;
}

interface RunsStore {
  runs: Record<string, ActiveRun>;
  isRunning: (threadId: string) => boolean;
  stop: (threadId: string) => void;
  /** Begin generating the assistant reply for `history`. Fire-and-forget; renders via `runs`. */
  startRun: (threadId: string, history: Message[], mockAi: boolean) => Promise<void>;
}

export const useRuns = create<RunsStore>((set, get) => ({
  runs: {},

  isRunning: (threadId) => !!get().runs[threadId],

  stop: (threadId) => {
    get().runs[threadId]?.controller.abort();
  },

  startRun: async (threadId, history, mockAi) => {
    if (get().runs[threadId]) return; // one active run per thread

    const assistantId = newId();
    const ctrl = new AbortController();
    let model = DEFAULT_CHAT_MODEL;
    const createdAt = new Date().toISOString();

    let acc = '';
    let err: AiError | undefined;
    let usage: Message['usage'];
    const genImages: ImageRef[] = [];
    const pendingImages: { id: string; callId?: string; size: string }[] = [];
    const toolCalls: ToolCall[] = [];
    const citations: Citation[] = [];
    let bingQueryUrl: string | undefined;
    let lastSnap = 0;

    const liveMessage = (status: Message['status'] = 'streaming'): Message => ({
      id: assistantId,
      threadId,
      role: 'assistant',
      content: acc,
      model,
      status,
      createdAt,
      ...(genImages.length ? { images: [...genImages] } : {}),
      pendingImages: pendingImages.map((p) => ({ id: p.id, size: p.size })),
      ...(toolCalls.length ? { toolCalls: [...toolCalls] } : {}),
      ...(citations.length ? { citations: [...citations] } : {}),
    });

    const publish = (force = false) => {
      const msg = liveMessage();
      set((s) => {
        const run = s.runs[threadId];
        if (!run) return s;
        return { runs: { ...s.runs, [threadId]: { ...run, message: msg } } };
      });
      const now = Date.now();
      if (force || now - lastSnap > 1200) {
        lastSnap = now;
        // Snapshot without transient placeholders; restored as 'interrupted' on next load.
        void kv.set(SNAPSHOT_PREFIX + assistantId, { ...msg, pendingImages: undefined }).catch(() => {});
      }
    };

    // Seed the run immediately so the UI shows the streaming state without waiting on config.
    set((s) => ({
      runs: { ...s.runs, [threadId]: { threadId, message: liveMessage(), controller: ctrl } },
    }));
    useUi.getState().setStream({ status: 'streaming', threadId, messageId: assistantId });

    // Persist + title once the run ends — whether it streamed to completion, was stopped, or
    // threw. Stop (signal aborted) is 'interrupted', not an error.
    const finalize = async (streamErr?: AiError) => {
      const wasAborted = ctrl.signal.aborted;
      const e = wasAborted ? undefined : (streamErr ?? err);
      const finalStatus: Message['status'] = e ? 'error' : wasAborted ? 'interrupted' : 'complete';
      if (bingQueryUrl) {
        const web = citations.find((c) => c.source === 'web');
        if (web) {
          for (const c of citations) if (c.source === 'web' && !c.bingQueryUrl) c.bingQueryUrl = bingQueryUrl;
        } else {
          citations.push({ source: 'web', bingQueryUrl });
        }
      }
      const final: Message = {
        id: assistantId,
        threadId,
        role: 'assistant',
        content: acc,
        model,
        status: finalStatus,
        createdAt,
        usage,
        error: e,
        ...(genImages.length ? { images: genImages } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
        ...(citations.length ? { citations } : {}),
      };
      if (acc || genImages.length) await repo.appendMessage(final).catch(() => {});
      if (e) useUi.getState().pushToast(e.message, 'error');
      else if (acc) await maybeTitle(threadId, history, acc, mockAi, model);
    };

    try {
      const config = await getApiConfig();
      model = config?.models.chat ?? DEFAULT_CHAT_MODEL;
      const settings = await repo.getSettings();

      const sys = config?.chatDefaults.systemPrompt;
      const about = settings.personalization.aboutYou;
      const how = settings.personalization.howRespond;
      const sysParts = [sys, about && `About the user: ${about}`, how && `Response style: ${how}`].filter(
        Boolean,
      );

      const chatMessages: ChatMessage[] = [];
      if (sysParts.length) chatMessages.push({ role: 'system', content: sysParts.join('\n\n') });
      for (const m of history) {
        if (m.role === 'user' || m.role === 'assistant') {
          chatMessages.push({ role: m.role, content: m.content });
        }
      }

      const applyMedia = () => publish();

      let caps: CapabilityMatrix | null = null;
      let agentStream: AsyncGenerator<AgentEvent> | null = null;
      if (mockAi) {
        agentStream = mockAgentStream(history);
      } else if (config) {
        caps = await detectCapabilities(config);
        if (caps.responses) {
          const tavilyKey = await getTavilyKey();
          const threadStoreId = (await repo.getThread(threadId))?.vectorStoreId;
          const toolCtx = {
            tavilyConfigured: !!tavilyKey,
            vectorStoreIds: resolveVectorStores({
              fileSearchEnabled: settings.tools?.fileSearch,
              kbStoreId: config.tools?.vectorStoreId,
              threadStoreId,
            }),
          };
          const tools = assembleTools(caps, settings.tools, toolCtx);
          const sysText = [sysParts.join('\n\n'), agenticToolGuidance(tools)].filter(Boolean).join('\n\n');
          const turns: Turn[] = [];
          if (sysText) turns.push({ role: 'system', text: sysText });
          for (const m of history) {
            if (m.role === 'user' || m.role === 'assistant') {
              const images = m.role === 'user' ? await imageUrlsForMessage(m) : undefined;
              turns.push({
                role: m.role,
                text: m.content,
                ...(images && images.length ? { images } : {}),
              });
            }
          }
          // The latest uploaded image is offered to generate_image as an edit reference.
          const referenceImage = await latestReferenceImage(history);
          agentStream = runAgent({
            model,
            turns,
            tools,
            execute: (name, args) => executeTool(name, args, { referenceImage }),
            confirm: confirmDestructive,
            isDestructive: isDestructiveTool,
            signal: ctrl.signal,
          });
        }
      }

      if (agentStream) {
        for await (const ev of agentStream) {
          if (ev.type === 'text') {
            acc += ev.delta;
            publish();
          } else if (ev.type === 'tool' && ev.name === 'generate_image') {
            if (ev.status === 'running') {
              const size = typeof ev.args?.size === 'string' ? ev.args.size : '1024x1024';
              pendingImages.push({ id: newId(), callId: ev.callId, size });
              applyMedia();
            } else if (ev.status === 'error') {
              const i = ev.callId
                ? pendingImages.findIndex((p) => p.callId === ev.callId)
                : pendingImages.length - 1;
              if (i >= 0) pendingImages.splice(i, 1);
              applyMedia();
            }
          } else if (ev.type === 'tool') {
            const id = ev.callId ?? ev.name;
            const label = TOOL_LABELS[ev.name] ?? ev.name;
            const summary = ev.detail ? `${label} · ${ev.detail}` : label;
            const kind: ToolCall['kind'] = SERVER_TOOLS.has(ev.name)
              ? (ev.name as ToolCall['kind'])
              : 'function';
            if (ev.name === 'web_search' && ev.status === 'done' && ev.detail) {
              bingQueryUrl = `https://www.bing.com/search?q=${encodeURIComponent(ev.detail)}`;
            }
            const existing = toolCalls.find((t) => t.id === id);
            if (existing) {
              existing.status = ev.status;
              existing.summary = summary;
              if (ev.result) existing.resultPreview = ev.result;
            } else {
              toolCalls.push({
                id,
                kind,
                name: ev.name,
                status: ev.status,
                summary,
                ...(ev.result ? { resultPreview: ev.result } : {}),
              });
            }
            publish();
          } else if (ev.type === 'image' && !ev.partial) {
            const imgId = newId();
            const key = `img-${imgId}`;
            await repo.putBlob(key, b64ToBlob(ev.b64));
            genImages.push({
              id: imgId,
              localBlobKey: key,
              prompt: ev.prompt ?? '',
              size: ev.size ?? '1024x1024',
              outputFormat: 'png',
              createdAt: new Date().toISOString(),
              ...(ev.expandedPrompt ? { expandedPrompt: ev.expandedPrompt } : {}),
              ...(ev.model ? { model: ev.model } : {}),
              sourceMessageIds: history.map((m) => m.id),
            });
            const i = ev.callId
              ? pendingImages.findIndex((p) => p.callId === ev.callId)
              : pendingImages.length
                ? 0
                : -1;
            if (i >= 0) pendingImages.splice(i, 1);
            applyMedia();
          } else if (ev.type === 'citation') {
            const c = ev.citation;
            const k = c.url ?? c.fileId;
            if (!citations.some((x) => (x.url ?? x.fileId) === k)) {
              citations.push(c);
              publish();
            }
          } else if (ev.type === 'error') {
            err = { code: ev.code ?? 'server_error', message: ev.message };
          }
        }
      } else {
        const stream = streamChat({
          messages: chatMessages,
          model,
          reasoningEffort: config?.chatDefaults.reasoningEffort,
          maxCompletionTokens: config?.chatDefaults.maxCompletionTokens,
          signal: ctrl.signal,
        });
        for await (const ev of stream) {
          if (ev.type === 'delta' && ev.textDelta) {
            acc += ev.textDelta;
            publish();
          } else if (ev.type === 'done') {
            usage = ev.usage;
          } else if (ev.type === 'error') {
            err = ev.error;
          }
        }
      }

      await finalize();
    } catch (e) {
      const aiErr: AiError = isAiError(e) ? e : { code: 'server_error', message: 'Unexpected error.' };
      await finalize(aiErr).catch(() => {});
    } finally {
      void kv.delete(SNAPSHOT_PREFIX + assistantId).catch(() => {});
      set((s) => {
        const next = { ...s.runs };
        delete next[threadId];
        return { runs: next };
      });
      useUi.getState().setStream({ status: 'idle' });
      useUi.getState().bumpThread(threadId);
      useUi.getState().bumpThreads();
    }
  },
}));

/** Title a brand-new thread from its first exchange (best-effort). */
async function maybeTitle(
  threadId: string,
  history: Message[],
  answer: string,
  mockAi: boolean,
  model: string,
): Promise<void> {
  const thread = await repo.getThread(threadId);
  if (!thread || (thread.title && thread.title !== 'New chat')) return;
  const firstUser = history.find((m) => m.role === 'user')?.content ?? '';
  const fallback = firstUser.slice(0, 40) || 'New chat';
  if (mockAi) {
    await repo.updateThread(threadId, { title: fallback });
    return;
  }
  try {
    const raw = await completeChat({
      model,
      maxCompletionTokens: 1000,
      reasoningEffort: 'minimal',
      messages: [
        {
          role: 'system',
          content:
            'You write a concise, specific 3-6 word title for a chat conversation. ' +
            'Output ONLY the title text — no quotes, no trailing punctuation, no preamble.',
        },
        {
          role: 'user',
          content: `Title this conversation:\n\nUser: ${firstUser.slice(0, 600)}\n\nAssistant: ${answer.slice(0, 600)}`,
        },
      ],
    });
    const clean = raw.replace(/^["'\s]+|["'\s.]+$/g, '').split('\n')[0].slice(0, 60);
    await repo.updateThread(threadId, { title: clean || fallback });
  } catch {
    await repo.updateThread(threadId, { title: fallback });
  }
  useUi.getState().bumpThreads();
}

/**
 * Restore assistant runs that were interrupted by a browser close: any orphaned snapshot is
 * saved as an `interrupted` message (whatever streamed before the close is kept) and cleared.
 * Call once on app startup.
 */
export async function restoreInterruptedRuns(): Promise<void> {
  let keys: string[];
  try {
    keys = await kv.keys();
  } catch {
    return;
  }
  for (const key of keys) {
    if (!key.startsWith(SNAPSHOT_PREFIX)) continue;
    const snap = await kv.get<Message>(key).catch(() => undefined);
    await kv.delete(key).catch(() => {});
    if (!snap) continue;
    const hasContent = (snap.content?.length ?? 0) > 0 || (snap.images?.length ?? 0) > 0;
    if (!hasContent) continue;
    const existing = await repo.listMessages(snap.threadId).catch(() => [] as Message[]);
    if (existing.some((m) => m.id === snap.id)) continue;
    await repo
      .appendMessage({ ...snap, status: 'interrupted', pendingImages: undefined })
      .catch(() => {});
    useUi.getState().bumpThread(snap.threadId);
  }
}
