import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { repo, cloudApi, skillsApi, syncNow } from '../../data';
import { newId } from '../../lib/ids';
import { getDeviceId } from '../../lib/device';
import { useUi } from '../../state/store';
import { DEFAULT_CHAT_MODEL, useRuns } from './runStore';
import { orderMessages } from './ordering';
import { lockHeldByOther } from './lock';
import { fileToBase64, uploadMime } from '../../lib/files';
import { chatModelOverride } from '../../lib/modelOptions';
import type { Attachment, Message } from '../../lib/types';
import type { SubmitRunBody } from '../../data/cloud/types';

export { DEFAULT_CHAT_MODEL } from './runStore';

/**
 * Tools to offer a server run. `web_search` + `generate_image` are always listed (the server gates
 * them on the vault Tavily key / image model). Code interpreter + file search are listed only when
 * the user enabled them AND the configured endpoint supports them (capabilities derived server-side
 * from the saved config), so an endpoint that lacks a tool is never sent it.
 */
async function serverRunTools(forceCodeInterpreter = false): Promise<string[]> {
  const tools = ['web_search', 'generate_image'];
  const settings = await repo.getSettings().catch(() => null);
  const t = settings?.tools;
  if (t?.agenticMode === false) return tools; // only bail when agentic mode is explicitly off
  const caps = await cloudApi
    .getCredentialStatus()
    .then((s) => s.capabilities)
    .catch(() => undefined);
  // Default the per-tool flags on when settings are missing/partial (code interpreter ships on),
  // so an endpoint that supports the tool always gets it unless the user explicitly disabled it.
  if (((t?.codeInterpreter ?? true) || forceCodeInterpreter) && caps?.codeInterpreter) tools.push('code_interpreter');
  if ((t?.fileSearch ?? false) && caps?.fileSearch) tools.push('file_search');
  return tools;
}

async function activeSkillNames(): Promise<Set<string>> {
  const skills = await skillsApi.list().catch(() => []);
  return new Set(skills.filter((skill) => skill.enabled && skill.status === 'ready').map((skill) => skill.name));
}

function taggedSkillNames(text: string, available: Set<string>): string[] {
  const names = new Set<string>();
  for (const match of text.matchAll(/(?:^|\s)\/([a-z0-9]+(?:-[a-z0-9]+)*)\b/gi)) {
    const name = match[1].toLowerCase();
    if (available.has(name)) names.add(name);
  }
  return [...names];
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
  const loadedThreadRef = useRef<string | null>(null);
  const run = useRuns((s) => s.runs[threadId]);
  const threadRev = useUi((s) => s.threadRev[threadId] ?? 0);
  const setThreadLock = useUi((s) => s.setThreadLock);
  const lock = useUi((s) => s.threadLocks[threadId] ?? null);
  const [lockTick, setLockTick] = useState(0);

  // Reload persisted messages on thread change and whenever this thread's revision bumps
  // (a run completed, regenerate trimmed history, etc.). Same-thread refreshes must keep the
  // message column mounted; otherwise routine background updates replace the chat with the global
  // spinner, which looks like a full UI refresh and drops scroll anchoring.
  useEffect(() => {
    let live = true;
    const switchingThreads = loadedThreadRef.current !== threadId;
    if (switchingThreads) {
      setPersisted([]);
      setLoading(true);
    }
    repo.listMessages(threadId).then((m) => {
      if (live) {
        setPersisted(m);
        loadedThreadRef.current = threadId;
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
    async (text: string, files?: File[], skillNames?: string[]) => {
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
      // Start the run NOW so the assistant bubble appears alongside the prompt — never gated by a
      // network round-trip. The pre-submit work (flushing an image attachment so the worker can
      // read it, indexing any docs for file search, probing the enabled tool set) runs inside the
      // run AFTER the bubble is on screen but BEFORE the server submit.
      const prepare = async (): Promise<Partial<SubmitRunBody>> => {
        // Image attachments must reach the server message before the run reads history (the run's
        // own user-turn append is idempotent and would otherwise win with no image). Flush sync so
        // the blob is uploaded and the synced message carries its blobPath the worker can read.
        const hasImages = (files ?? []).some((f) => f.type.startsWith('image/'));
        if (hasImages) await syncNow().catch(() => {});
        // Thread-scoped file search: index any non-image docs into the thread's vector store so the
        // model can answer questions about them via file_search. Blocks the submit until indexed.
        const docs = (files ?? []).filter((f) => !f.type.startsWith('image/'));
        if (docs.length) {
          const toast = useUi.getState().pushToast;
          busyRef.current = true;
          setIndexing(true);
          toast(`Indexing ${docs.length} file${docs.length === 1 ? '' : 's'}…`, 'info');
          try {
            // The AI key lives in the server vault, so upload the docs to the thread's vector store
            // via the API. The server creates the store on first upload and records it on the thread.
            let indexed = 0;
            for (const f of docs) {
              try {
                await cloudApi.uploadThreadFile(threadId, {
                  name: f.name,
                  mime: uploadMime(f),
                  dataBase64: await fileToBase64(f),
                });
                indexed++;
              } catch {
                /* counted as failed below */
              }
            }
            await syncNow().catch(() => {});
            useUi.getState().bumpThread(threadId);
            const failed = docs.length - indexed;
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
        // Server-authoritative: the backend generates + persists the reply, which survives this
        // client closing. The enabled tool set for this run is probed from the saved config.
        const explicitSkills = skillNames?.length ? skillNames : taggedSkillNames(trimmed, await activeSkillNames());
        const tools = await serverRunTools(explicitSkills.length > 0);
        return tools.length ? { tools } : {};
      };
      const model = chatModelOverride(useUi.getState().activeModelByThread[threadId] ?? DEFAULT_CHAT_MODEL);
      void useRuns.getState().startServerRun(
        threadId,
        {
          text: trimmed,
          clientMessageId: userMsg.id,
          ...(model ? { model } : {}),
        },
        prepare,
      );
      useUi.getState().bumpThreads();
    },
    [threadId, temporary],
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
    const lastUser = [...trimmed].reverse().find((m) => m.role === 'user');
    if (!lastUser) return;
    // Server-authoritative regenerate: reuse the existing user turn (idempotency key) and let the
    // backend produce a fresh reply. The bubble shows at once; the tool probe runs after it.
    const model = chatModelOverride(useUi.getState().activeModelByThread[threadId] ?? DEFAULT_CHAT_MODEL);
    void useRuns.getState().startServerRun(
      threadId,
      {
        text: lastUser.content,
        clientMessageId: lastUser.id,
        ...(model ? { model } : {}),
      },
      async () => {
        const explicitSkills = taggedSkillNames(lastUser.content, await activeSkillNames());
        const tools = await serverRunTools(explicitSkills.length > 0);
        return tools.length ? { tools } : {};
      },
    );
  }, [threadId]);

  const stop = useCallback(() => useRuns.getState().stop(threadId), [threadId]);

  return { messages, loading, send, regenerate, stop, streaming: !!run || indexing, indexing, lockedBy };
}
