import { useCallback, useEffect, useRef, useState } from 'react';
import { repo } from '../../data';
import { getApiConfig } from '../../data/secureStore';
import { newId } from '../../lib/ids';
import { streamChat, completeChat, type ChatMessage } from '../../ai/chat';
import { mockStreamChat } from '../../ai/mockAi';
import { isAiError } from '../../ai/errors';
import { detectCapabilities } from '../../ai/capabilities';
import { runAgent, type Turn } from '../../ai/orchestrator';
import { assembleTools, executeTool, isDestructiveTool } from '../../ai/tools';
import { b64ToBlob } from '../../ai/image';
import { useUi } from '../../state/store';
import type { AiError, CapabilityMatrix, ImageRef, Message, ToolCall } from '../../lib/types';

export const DEFAULT_CHAT_MODEL = 'gpt-5.4';

/** Human labels for the tool-activity cards shown in the transcript. */
const TOOL_LABELS: Record<string, string> = {
  search_history: 'Searched your chat history',
  get_thread_summary: 'Read a past conversation',
  create_thread: 'Created a conversation',
  delete_thread: 'Deleted a conversation',
  add_memory: 'Saved to memory',
  update_setting: 'Updated a setting',
};

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
  return window.confirm(`Allow the assistant to ${what}?`);
}

export function useChat(threadId: string, temporary = false) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const abortRef = useRef<AbortController | null>(null);
  const mockAi = useUi((s) => s.mockAi);
  const setStream = useUi((s) => s.setStream);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    let live = true;
    setLoading(true);
    repo.listMessages(threadId).then((m) => {
      if (live) {
        setMessages(m);
        setLoading(false);
      }
    });
    return () => {
      live = false;
      abortRef.current?.abort();
    };
  }, [threadId]);

  const runAssistant = useCallback(
    async (history: Message[]) => {
      const config = await getApiConfig();
      const model = config?.models.chat ?? DEFAULT_CHAT_MODEL;
      const settings = await repo.getSettings();

      const chatMessages: ChatMessage[] = [];
      const sys = config?.chatDefaults.systemPrompt;
      const about = settings.personalization.aboutYou;
      const how = settings.personalization.howRespond;
      const sysParts = [sys, about && `About the user: ${about}`, how && `Response style: ${how}`].filter(
        Boolean,
      );
      if (sysParts.length) chatMessages.push({ role: 'system', content: sysParts.join('\n\n') });
      for (const m of history) {
        if (m.role === 'user' || m.role === 'assistant') {
          chatMessages.push({ role: m.role, content: m.content });
        }
      }

      const assistantId = newId();
      const placeholder: Message = {
        id: assistantId,
        threadId,
        role: 'assistant',
        content: '',
        model,
        status: 'streaming',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, placeholder]);
      setStream({ status: 'streaming', threadId, messageId: assistantId });

      const ctrl = new AbortController();
      abortRef.current = ctrl;

      let acc = '';
      let err: AiError | undefined;
      let usage: Message['usage'];
      const genImages: ImageRef[] = [];
      // Transient placeholders for images currently being generated (never persisted).
      const pendingImages: { id: string; callId?: string; size: string }[] = [];
      const toolCalls: ToolCall[] = [];
      const applyMedia = () =>
        setMessages((prev) =>
          prev.map((m) =>
            m.id === assistantId
              ? { ...m, images: [...genImages], pendingImages: pendingImages.map((p) => ({ id: p.id, size: p.size })) }
              : m,
          ),
        );

      // Agentic path (tools, incl. context-aware image generation) when the endpoint
      // serves the Responses API; otherwise the classic single-shot chat path.
      let useAgentic = false;
      let caps: CapabilityMatrix | null = null;
      if (!mockAi && config) {
        caps = await detectCapabilities(config);
        useAgentic = caps.responses;
      }

      try {
        if (useAgentic) {
          const turns: Turn[] = [];
          if (sysParts.length) turns.push({ role: 'system', text: sysParts.join('\n\n') });
          for (const m of history) {
            if (m.role === 'user' || m.role === 'assistant') {
              turns.push({ role: m.role, text: m.content });
            }
          }
          const toolCtx = {
            webSearchConsent: config?.consent?.webSearchDataBoundary ?? false,
            vectorStoreIds: config?.tools?.vectorStoreId ? [config.tools.vectorStoreId] : [],
          };
          const tools = caps ? assembleTools(caps, settings.tools, toolCtx) : [];
          for await (const ev of runAgent({
            model,
            turns,
            tools,
            execute: executeTool,
            confirm: confirmDestructive,
            isDestructive: isDestructiveTool,
            signal: ctrl.signal,
          })) {
            if (ev.type === 'text') {
              acc += ev.delta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
              );
            } else if (ev.type === 'tool' && ev.name === 'generate_image') {
              // Show an aspect-ratio-correct animated placeholder while the image renders,
              // then drop it when the real image arrives (matched by callId).
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
              // Record non-image tool activity as a collapsible card on the message.
              const id = ev.callId ?? ev.name;
              const label = TOOL_LABELS[ev.name] ?? ev.name;
              const existing = toolCalls.find((t) => t.id === id);
              if (existing) {
                existing.status = ev.status;
                if (ev.detail) existing.summary = `${label} · ${ev.detail}`;
              } else {
                toolCalls.push({ id, kind: 'function', name: ev.name, status: ev.status, summary: label });
              }
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, toolCalls: [...toolCalls] } : m)),
              );
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
            } else if (ev.type === 'error') {
              err = { code: 'server_error', message: ev.message };
            }
          }
        } else {
          const stream = mockAi
            ? mockStreamChat({ messages: chatMessages, model, signal: ctrl.signal })
            : streamChat({
                messages: chatMessages,
                model,
                reasoningEffort: config?.chatDefaults.reasoningEffort,
                maxCompletionTokens: config?.chatDefaults.maxCompletionTokens,
                signal: ctrl.signal,
              });
          for await (const ev of stream) {
            if (ev.type === 'delta' && ev.textDelta) {
              acc += ev.textDelta;
              setMessages((prev) =>
                prev.map((m) => (m.id === assistantId ? { ...m, content: acc } : m)),
              );
            } else if (ev.type === 'done') {
              usage = ev.usage;
            } else if (ev.type === 'error') {
              err = ev.error;
            }
          }
        }
      } catch (e) {
        err = isAiError(e) ? e : { code: 'server_error', message: 'Unexpected error.' };
      }

      const wasAborted = ctrl.signal.aborted;
      const finalStatus: Message['status'] = err
        ? 'error'
        : wasAborted
          ? 'interrupted'
          : 'complete';
      const final: Message = {
        ...placeholder,
        content: acc,
        status: finalStatus,
        usage,
        error: err,
        ...(genImages.length ? { images: genImages } : {}),
        ...(toolCalls.length ? { toolCalls } : {}),
      };
      setMessages((prev) => prev.map((m) => (m.id === assistantId ? final : m)));
      setStream({ status: err ? 'error' : 'idle' });
      abortRef.current = null;

      if (!err && (acc || genImages.length)) {
        await repo.appendMessage(final);
        await maybeTitle(threadId, history, acc, mockAi, model);
      } else if (err) {
        pushToast(err.message, 'error');
      }
    },
    [threadId, mockAi, setStream, pushToast],
  );

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      // Lazily create the thread on first message (so /new doesn't litter history).
      const existing = await repo.getThread(threadId);
      if (!existing) {
        await repo.createThread({ id: threadId, title: 'New chat', temporary });
        useUi.getState().bumpThreads();
      }
      const userMsg: Message = {
        id: newId(),
        threadId,
        role: 'user',
        content: trimmed,
        status: 'complete',
        createdAt: new Date().toISOString(),
      };
      setMessages((prev) => [...prev, userMsg]);
      await repo.appendMessage(userMsg);
      const history = await repo.listMessages(threadId);
      await runAssistant(history);
      useUi.getState().bumpThreads();
    },
    [threadId, runAssistant, temporary],
  );

  const regenerate = useCallback(async () => {
    const history = await repo.listMessages(threadId);
    // drop trailing assistant message if present
    const trimmed = [...history];
    while (trimmed.length && trimmed[trimmed.length - 1].role === 'assistant') {
      const last = trimmed.pop()!;
      await repo.deleteMessage(last.id);
    }
    setMessages(trimmed);
    await runAssistant(trimmed);
  }, [threadId, runAssistant]);

  const stop = useCallback(() => {
    abortRef.current?.abort();
  }, []);

  return { messages, loading, send, regenerate, stop };
}

async function maybeTitle(
  threadId: string,
  history: Message[],
  answer: string,
  mockAi: boolean,
  model: string,
) {
  const thread = await repo.getThread(threadId);
  if (!thread || (thread.title && thread.title !== 'New chat')) return;
  const firstUser = history.find((m) => m.role === 'user')?.content ?? '';
  const fallback = firstUser.slice(0, 40) || 'New chat';
  if (mockAi) {
    await repo.updateThread(threadId, { title: fallback });
    return;
  }
  try {
    // Reasoning models (e.g. gpt-5.4) spend the token budget on hidden reasoning, so use
    // minimal effort and a generous cap — a tiny cap returns an empty completion (no title).
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
    const clean = raw
      .replace(/^["'\s]+|["'\s.]+$/g, '')
      .split('\n')[0]
      .slice(0, 60)
      .trim();
    await repo.updateThread(threadId, { title: clean || fallback });
  } catch {
    await repo.updateThread(threadId, { title: fallback });
  }
}
