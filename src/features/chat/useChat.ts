import { useCallback, useEffect, useMemo, useState } from 'react';
import { repo } from '../../data';
import { newId } from '../../lib/ids';
import { useUi } from '../../state/store';
import { useRuns } from './runStore';
import { indexThreadDocuments } from '../../ai/fileSearch';
import { getThreadVectorStore, setThreadVectorStore } from '../../data/threadFiles';
import type { Attachment, Message } from '../../lib/types';

export { DEFAULT_CHAT_MODEL } from './runStore';

/** Persist uploaded files as local blobs and return their attachment records. */
async function persistAttachments(files: File[]): Promise<Attachment[]> {
  const out: Attachment[] = [];
  for (const f of files) {
    const id = newId();
    const key = `att-${id}`;
    await repo.putBlob(key, f);
    out.push({
      id,
      kind: f.type.startsWith('image/') ? 'image' : f.type.startsWith('audio/') ? 'audio' : 'file',
      localBlobKey: key,
      mime: f.type || 'application/octet-stream',
      bytes: f.size,
      name: f.name,
    });
  }
  return out;
}

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
    async (text: string, files?: File[]) => {
      const trimmed = text.trim();
      const hasFiles = !!files && files.length > 0;
      if (!trimmed && !hasFiles) return;
      if (useRuns.getState().isRunning(threadId)) return;
      // Lazily create the thread on first message (so /new doesn't litter history).
      const existing = await repo.getThread(threadId);
      if (!existing) {
        await repo.createThread({ id: threadId, title: 'New chat', temporary });
        useUi.getState().bumpThreads();
      }
      const attachments = hasFiles ? await persistAttachments(files!) : undefined;
      const userMsg: Message = {
        id: newId(),
        threadId,
        role: 'user',
        content: trimmed,
        status: 'complete',
        createdAt: new Date().toISOString(),
        ...(attachments && attachments.length ? { attachments } : {}),
      };
      setPersisted((prev) => [...prev, userMsg]); // optimistic — reload dedupes by id
      await repo.appendMessage(userMsg);
      // Thread-scoped file search: index any non-image docs into the thread's vector store so the
      // model can answer questions about them via file_search. Blocks the run until indexed.
      const docs = (files ?? []).filter((f) => !f.type.startsWith('image/'));
      if (docs.length && !mockAi) {
        const toast = useUi.getState().pushToast;
        toast(`Indexing ${docs.length} file${docs.length === 1 ? '' : 's'}…`, 'info');
        try {
          const existingStore = await getThreadVectorStore(threadId);
          const { vectorStoreId, indexed, failed } = await indexThreadDocuments(
            docs.map((f) => ({ file: f, name: f.name })),
            existingStore,
          );
          if (vectorStoreId) await setThreadVectorStore(threadId, vectorStoreId);
          if (failed && !indexed) toast('Could not index the file(s)', 'error');
          else if (failed) toast(`${indexed} file(s) ready, ${failed} failed`, 'info');
          else toast('File ready — you can ask about it', 'success');
        } catch {
          toast('Could not index the file(s)', 'error');
        }
      }
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
