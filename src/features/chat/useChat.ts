import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';
import { useRuns } from './runStore';
import type { Message } from '../../lib/types';

export { DEFAULT_CHAT_MODEL } from './runStore';

/**
 * Thin chat hook. The thread's persisted messages are merged with any in-progress run, which is
 * owned by the global run store (`runStore.ts`) — so generation survives navigating away, runs
 * concurrently across threads, and is restored when you return. Sending just persists the user
 * turn and kicks off a run; the run completes independently of this view's lifecycle.
 */
export function useChat(threadId: string, temporary = false) {
  const [persisted, setPersisted] = useState<Message[]>([]);
  const [loading, setLoading] = useState(true);
  const run = useRuns((s) => s.runs[threadId]);
  const threadRev = useUi((s) => s.threadRev[threadId] ?? 0);
  const mockAi = useUi((s) => s.mockAi);

  // Reload persisted messages on thread change and whenever this thread's revision bumps
  // (a run completed, regenerate trimmed history, etc.).
  useEffect(() => {
    let live = true;
    setLoading(true);
    repo.listMessages(threadId).then((m) => {
      if (live) {
        setPersisted(m);
        setLoading(false);
      }
    });
    return () => {
      live = false;
    };
  }, [threadId, threadRev]);

  // Render persisted + the live run message (deduped once the run is persisted on completion).
  const messages = useMemo(() => {
    if (!run) return persisted;
    const ids = new Set(persisted.map((m) => m.id));
    return ids.has(run.message.id) ? persisted : [...persisted, run.message];
  }, [persisted, run]);

  const send = useCallback(
    async (text: string) => {
      const trimmed = text.trim();
      if (!trimmed) return;
      if (useRuns.getState().isRunning(threadId)) return;
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
      setPersisted((prev) => [...prev, userMsg]); // optimistic — reload dedupes by id
      await repo.appendMessage(userMsg);
      const history = await repo.listMessages(threadId);
      void useRuns.getState().startRun(threadId, history, mockAi);
      useUi.getState().bumpThreads();
    },
    [threadId, temporary, mockAi],
  );

  const regenerate = useCallback(async () => {
    if (useRuns.getState().isRunning(threadId)) return;
    const history = await repo.listMessages(threadId);
    const trimmed = [...history];
    while (trimmed.length && trimmed[trimmed.length - 1].role === 'assistant') {
      const last = trimmed.pop()!;
      await repo.deleteMessage(last.id);
    }
    setPersisted(trimmed);
    void useRuns.getState().startRun(threadId, trimmed, mockAi);
  }, [threadId, mockAi]);

  const stop = useCallback(() => useRuns.getState().stop(threadId), [threadId]);

  return { messages, loading, send, regenerate, stop, streaming: !!run };
}
