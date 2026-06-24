import { useCallback, useEffect, useRef, useState } from 'react';
import { repo } from '../../data';
import { getApiConfig } from '../../data/secureStore';
import { newId } from '../../lib/ids';
import { streamChat, completeChat, type ChatMessage } from '../../ai/chat';
import { mockStreamChat } from '../../ai/mockAi';
import { isAiError } from '../../ai/errors';
import { agenticAvailable } from '../../ai/capabilities';
import { runAgent, type Turn } from '../../ai/orchestrator';
import { CHAT_TOOLS, executeTool } from '../../ai/tools';
import { b64ToBlob } from '../../ai/image';
import { useUi } from '../../state/store';
import type { AiError, ImageRef, Message } from '../../lib/types';

export const DEFAULT_CHAT_MODEL = 'gpt-5.4';

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
      if (!mockAi && config) {
        useAgentic = await agenticAvailable(config);
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
          for await (const ev of runAgent({
            model,
            turns,
            tools: CHAT_TOOLS,
            execute: executeTool,
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
  if (mockAi) {
    await repo.updateThread(threadId, { title: firstUser.slice(0, 40) || 'New chat' });
    return;
  }
  try {
    const title = await completeChat({
      model,
      maxCompletionTokens: 16,
      messages: [
        {
          role: 'user',
          content: `Give a short 3-5 word title (no quotes) for this conversation:\n\nUser: ${firstUser}\nAssistant: ${answer.slice(0, 200)}`,
        },
      ],
    });
    const clean = title.replace(/^["']|["']$/g, '').slice(0, 60).trim();
    if (clean) await repo.updateThread(threadId, { title: clean });
  } catch {
    await repo.updateThread(threadId, { title: firstUser.slice(0, 40) || 'New chat' });
  }
}
