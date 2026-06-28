// Persistent run manager: owns assistant generation so it survives view navigation and runs
// concurrently across threads. The chat view subscribes to the in-progress run for its thread
// and renders it; on completion the final message is persisted to the repo. A throttled snapshot
// of the in-progress message is kept in IndexedDB so a browser close mid-stream is not fully
// lost — orphaned snapshots are restored as `interrupted` messages on next load.
import { create } from 'zustand';
import { repo, cloudApi, syncNow, saveServerMessage, realtime } from '../../data';
import { idbKvStore } from '../../data/sync/kvStore';
import { newId } from '../../lib/ids';
import { runOnServer } from './serverRun';
import { useUi } from '../../state/store';
import { messageFromRecord } from '../../data/cloud/types';
import { AUTO_CHAT_MODEL } from '../../lib/modelOptions';
import type { MessageRecord, SubmitRunBody } from '../../data/cloud/types';
import type { Message } from '../../lib/types';

export const DEFAULT_CHAT_MODEL = AUTO_CHAT_MODEL;

const kv = idbKvStore();
const SNAPSHOT_PREFIX = 'run.active.';

/** Threads whose run is mid-acquire (lock pending) — guards the async gap before `runs` is
 *  seeded so a fast double-send can't start two generations on the same device. */
const startingThreads = new Set<string>();

interface ActiveRun {
  threadId: string;
  /** The in-progress assistant message (status 'streaming'). */
  message: Message;
  controller: AbortController;
  /** Server run id (set for server-authoritative runs) so Stop can cancel it server-side. */
  runId?: string;
}

interface RunsStore {
  runs: Record<string, ActiveRun>;
  isRunning: (threadId: string) => boolean;
  stop: (threadId: string) => void;
  /** Submit a server-authoritative run; generation completes server-side even if this client
   *  closes. Renders the reply by streaming the run's message into the live overlay. The optimistic
   *  assistant bubble appears synchronously; `prepare` runs AFTER it (deferred network work like
   *  resolving the enabled tool set or flushing an image attachment) so the UI is never gated. */
  startServerRun: (
    threadId: string,
    body: SubmitRunBody,
    prepare?: () => Promise<Partial<SubmitRunBody>>,
  ) => Promise<void>;
}

export const useRuns = create<RunsStore>((set, get) => ({
  runs: {},

  isRunning: (threadId) => !!get().runs[threadId],

  stop: (threadId) => {
    const run = get().runs[threadId];
    if (!run) return;
    // Server run: cancel it server-side too (best-effort) so the worker stops generating.
    if (run.runId) void cloudApi.cancelRun(run.threadId, run.runId).catch(() => {});
    run.controller.abort();
  },

  startServerRun: async (threadId, body, prepare) => {
    if (get().isRunning(threadId) || startingThreads.has(threadId)) return; // one run per thread
    const ctrl = new AbortController();

    // Optimistic UI: show an assistant 'streaming' bubble immediately, before the server responds.
    const seed: Message = {
      id: `pending-${newId()}`,
      threadId,
      role: 'assistant',
      content: '',
      status: 'streaming',
      createdAt: new Date().toISOString(),
    };
    set((s) => ({ runs: { ...s.runs, [threadId]: { threadId, message: seed, controller: ctrl } } }));
    useUi.getState().setStream({ status: 'streaming', threadId, messageId: seed.id });

    // Connect realtime push (lazy, best-effort) so the streaming reply + thread title arrive
    // straight from the server instead of waiting for the next sync poll.
    void realtime.ensure();

    // Write a (possibly partial) assistant message into the live overlay for this thread.
    const applyOverlay = (msg: Message) => {
      set((s) => {
        const r = s.runs[threadId];
        return r ? { runs: { ...s.runs, [threadId]: { ...r, message: msg } } } : s;
      });
    };

    // SignalR pushes the assistant snapshot on every worker flush (~250ms) — render it immediately.
    const offMessage = realtime.on('message', (payload) => {
      const p = payload as { threadId?: string; message?: MessageRecord } | null;
      if (!p || p.threadId !== threadId || !p.message) return;
      applyOverlay(messageFromRecord(p.message));
    });
    // A thread push (title/preview set after generation) — pull it and refresh the list in place.
    const offThread = realtime.on('thread', (payload) => {
      const id = (payload as { thread?: { id?: string } } | null)?.thread?.id;
      if (!id) return;
      void syncNow().then((ids) => {
        const u = useUi.getState();
        u.bumpThreads();
        ids.forEach((tid) => u.bumpThread(tid));
        u.bumpThread(id);
      });
    });

    // Deferred preparation (enabled tool set, flushing an image attachment, indexing docs) runs
    // AFTER the optimistic bubble is on screen, so the response UI is never gated by a network
    // round-trip. Falls back to the base body (web search only) if it fails.
    let runBody = body;
    if (prepare) {
      try {
        runBody = { ...body, ...(await prepare()) };
      } catch {
        /* keep the base body */
      }
    }
    // The user may have hit Stop while we were preparing — honor it before spending a server run.
    if (ctrl.signal.aborted) {
      offMessage();
      offThread();
      set((s) => {
        const next = { ...s.runs };
        delete next[threadId];
        return { runs: next };
      });
      useUi.getState().setStream({ status: 'idle' });
      return;
    }

    let finalAssistant: Message | null = null;
    try {
      const { run, assistant } = await runOnServer(
        {
          sync: syncNow,
          submitRun: async (tid, b) => {
            const ack = await cloudApi.submitRun(tid, b);
            // Record the run id so Stop can cancel it server-side.
            set((s) => {
              const r = s.runs[threadId];
              return r ? { runs: { ...s.runs, [threadId]: { ...r, runId: ack.runId } } } : s;
            });
            return ack;
          },
          getRun: (tid, rid) => cloudApi.getRun(tid, rid),
          getAssistantMessage: async (tid, mid, since) => {
            const recs = await cloudApi.listMessages(tid, { since });
            const rec = recs.find((r) => r.id === mid);
            return rec ? messageFromRecord(rec) : null;
          },
          // Stream the growing reply into the live overlay (instant, token-ish updates). While a
          // realtime push is driving this thread (seen within the last 3s), defer to it so the
          // slower poll never regresses the fresher pushed snapshot.
          onAssistant: (msg) => {
            if (Date.now() - realtime.liveSince(threadId) < 3000) return;
            applyOverlay(msg);
          },
          onThreadsChanged: (ids) => {
            if (ids.size === 0) return;
            const u = useUi.getState();
            u.bumpThreads();
            ids.forEach((id) => u.bumpThread(id));
          },
          sleep: (ms) => new Promise((r) => setTimeout(r, ms)),
          now: () => Date.now(),
          signal: ctrl.signal,
        },
        threadId,
        runBody,
      );
      finalAssistant = assistant;
      if (run?.status === 'error' || assistant?.status === 'error') {
        useUi
          .getState()
          .pushToast(run?.error?.message ?? 'The response failed on the server.', 'error');
      }
    } catch (e) {
      useUi
        .getState()
        .pushToast(e instanceof Error ? e.message : 'Could not start the response.', 'error');
    } finally {
      offMessage();
      offThread();
      // Land the finished reply locally so it survives the overlay clearing (the bulk sync cursor
      // skips the streaming message), then clear the overlay and reload the persisted list.
      if (finalAssistant) await saveServerMessage(finalAssistant).catch(() => {});
      set((s) => {
        const next = { ...s.runs };
        delete next[threadId];
        return { runs: next };
      });
      const u = useUi.getState();
      u.setStream({ status: 'idle' });
      u.bumpThread(threadId); // reload persisted (now includes the final assistant message)
    }
  },
}));

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
