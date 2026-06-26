import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repo } from '../../data';
import { newId } from '../../lib/ids';
import { getDeviceId } from '../../lib/device';
import { useUi } from '../../state/store';
import { useRuns } from './runStore';
import { orderMessages } from './ordering';
import { lockHeldByOther } from './lock';
import { indexThreadDocuments } from '../../ai/fileSearch';
import { detectCapabilities } from '../../ai/capabilities';
import { getApiConfig } from '../../data/secureStore';
import { isServerRunsEnabled } from '../../lib/flags';
import type { Attachment, Message } from '../../lib/types';

export { DEFAULT_CHAT_MODEL } from './runStore';

/**
 * Tools to offer a server run. `web_search` is always listed (the server gates it on the vault
 * Tavily key). The built-ins (code interpreter, file search) are listed only when the user enabled
 * them AND the endpoint is known to support them (capability matrix, probed once + cached), so an
 * endpoint that lacks a tool is never sent it (which would fail the whole run).
 */
async function serverRunTools(): Promise<string[]> {
  const tools = ['web_search', 'generate_image'];
  const settings = await repo.getSettings().catch(() => null);
  const t = settings?.tools;
  if (!t || t.agenticMode === false) return tools;
  let cap = useUi.getState().capability;
  if (!cap) {
    const cfg = await getApiConfig().catch(() => null);
    if (cfg?.baseUrl) {
      cap = await detectCapabilities(cfg).catch(() => null);
      if (cap) useUi.getState().setCapability(cap);
    }
  }
  if (t.codeInterpreter && cap?.codeInterpreter) tools.push('code_interpreter');
  if (t.fileSearch && cap?.fileSearch) tools.push('file_search');
  return tools;
}

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
  const [indexing, setIndexing] = useState(false);
  const busyRef = useRef(false);
  const run = useRuns((s) => s.runs[threadId]);
  const threadRev = useUi((s) => s.threadRev[threadId] ?? 0);
  const mockAi = useUi((s) => s.mockAi);
  const setThreadLock = useUi((s) => s.setThreadLock);
  const lock = useUi((s) => s.threadLocks[threadId] ?? null);
  const [lockTick, setLockTick] = useState(0);

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

  // Proactively reflect another device generating in this thread: poll the authoritative run lock
  // while the thread is open and visible, so the composer locks/unlocks promptly (a crashed holder
  // simply stops heartbeating and the lock goes stale). Resolves to null with sync off / local-only.
  useEffect(() => {
    let live = true;
    const poll = () => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return;
      repo
        .getThreadLock(threadId)
        .then((l) => {
          if (live) setThreadLock(threadId, l);
        })
        .catch(() => {});
    };
    poll();
    const id = window.setInterval(poll, 7000);
    const onFocus = () => poll();
    window.addEventListener('focus', onFocus);
    return () => {
      live = false;
      window.clearInterval(id);
      window.removeEventListener('focus', onFocus);
    };
  }, [threadId, setThreadLock]);

  // While a foreign lock is present, tick so its staleness is re-evaluated even without new data.
  useEffect(() => {
    if (!lock || lock.deviceId === getDeviceId()) return;
    const id = window.setInterval(() => setLockTick((n) => n + 1), 5000);
    return () => window.clearInterval(id);
  }, [lock]);

  // The other device that currently holds the lock (null when free / ours / stale): the composer
  // disables sending and explains why while this is set.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const lockedBy = useMemo(() => lockHeldByOther(lock, Date.now()), [lock, lockTick]);

  // Render persisted + the in-flight run message as one stable, chronologically ordered list, so
  // a streaming response keeps its slot even when a concurrent prompt arrives from another device.
  const messages = useMemo(() => orderMessages(persisted, run?.message), [persisted, run]);

  const send = useCallback(
    async (text: string, files?: File[]) => {
      const trimmed = text.trim();
      const hasFiles = !!files && files.length > 0;
      if (!trimmed && !hasFiles) return;
      if (busyRef.current) return;
      if (useRuns.getState().isRunning(threadId)) return;
      // Another device is mid-generation: block sending (the composer also disables it) so the
      // two devices don't produce interleaved, concurrent replies.
      const heldByOther = lockHeldByOther(useUi.getState().threadLocks[threadId] ?? null);
      if (heldByOther) {
        useUi.getState().pushToast(
          `A response is being generated on ${heldByOther.deviceLabel}. Please wait until it finishes.`,
          'info',
        );
        return;
      }
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
        busyRef.current = true;
        setIndexing(true);
        toast(`Indexing ${docs.length} file${docs.length === 1 ? '' : 's'}…`, 'info');
        try {
          const existingStore = (await repo.getThread(threadId))?.vectorStoreId;
          const { vectorStoreId, indexed, failed } = await indexThreadDocuments(
            docs.map((f) => ({ file: f, name: f.name })),
            existingStore,
          );
          // Persist the store id ON THE THREAD so it syncs across devices (file search travels).
          if (vectorStoreId && vectorStoreId !== existingStore) {
            await repo.updateThread(threadId, { vectorStoreId });
          }
          if (failed && !indexed) toast('Could not index the file(s)', 'error');
          else if (failed) toast(`${indexed} file(s) ready, ${failed} failed`, 'info');
          else toast('File ready — you can ask about it', 'success');
        } catch {
          toast('Could not index the file(s)', 'error');
        } finally {
          busyRef.current = false;
          setIndexing(false);
        }
      }
      const history = await repo.listMessages(threadId);
      if (isServerRunsEnabled() && !mockAi) {
        // Server-authoritative: the backend generates + persists the reply, which survives this
        // client closing. Pass the local message id as the idempotency key so the server's copy of
        // the user turn converges with the local one, and the enabled tool set for this run.
        const tools = await serverRunTools();
        void useRuns.getState().startServerRun(threadId, {
          text: trimmed,
          clientMessageId: userMsg.id,
          ...(tools.length ? { tools } : {}),
        });
      } else {
        void useRuns.getState().startRun(threadId, history, mockAi);
      }
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

  return { messages, loading, send, regenerate, stop, streaming: !!run || indexing, indexing, lockedBy };
}
