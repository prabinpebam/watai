// Server-authoritative run driver. With the `serverRuns` flag on, generation happens on the
// server: the client POSTs a prompt and the worker generates + persists the reply even if this
// client closes. This module submits the run and then *streams* the reply into the UI by polling
// the run's assistant message on a tight cadence — the worker writes growing partial content to
// Cosmos, and we re-read it (via a fixed `since` window so the fixed-`orderAt` message keeps
// matching) until the message reaches a terminal status.
//
// It is fully dependency-injected (no direct imports of the api client or the sync engine) so the
// orchestration is unit-testable. The run continues server-side regardless of this driver: polling
// governs only *live rendering* in this client, not whether the run completes.
import type { Message } from '../../lib/types';
import type { RunRecord, SubmitRunBody, SubmitRunResult } from '../../data/cloud/types';

export interface ServerRunDeps {
  /** Push local changes + pull remote deltas; resolves with the thread ids that changed locally. */
  sync: () => Promise<Set<string>>;
  submitRun: (threadId: string, body: SubmitRunBody) => Promise<SubmitRunResult>;
  getRun: (threadId: string, runId: string) => Promise<RunRecord>;
  /** Read the run's assistant message with its current (possibly partial) content. `since` is a
   *  fixed server-time window start so the streaming message — whose orderAt never changes —
   *  keeps being returned on every poll. Resolves null until the worker first writes it. */
  getAssistantMessage: (
    threadId: string,
    assistantMessageId: string,
    since: string,
  ) => Promise<Message | null>;
  /** Render the streaming/terminal assistant message in the UI (the live overlay). */
  onAssistant: (msg: Message) => void;
  /** Notify the UI that these threads' metadata changed (so the list reloads). */
  onThreadsChanged: (ids: Set<string>) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Poll cadence while the run streams (default 450ms). */
  pollIntervalMs?: number;
  /** Stop *watching* after this long; the run keeps going server-side (default 5 min). */
  timeoutMs?: number;
  /** Abort the watch (e.g. the user pressed Stop). The run is canceled separately. */
  signal?: AbortSignal;
}

export interface ServerRunResult {
  run: RunRecord | null;
  /** The last assistant message observed (terminal on a clean finish). */
  assistant: Message | null;
}

/** Assistant message statuses that end the watch. */
const TERMINAL_MSG = new Set<Message['status']>(['complete', 'error', 'interrupted']);

/**
 * Drive one server-side run from this client's perspective:
 * 1. push the just-created thread + user message so the server's submit can find the thread,
 * 2. submit the run,
 * 3. poll the assistant message on a tight cadence, streaming its growing content into the UI,
 *    until it reaches a terminal status (or the watch times out / is aborted).
 *
 * `submitRun` errors propagate to the caller (so it can surface a toast).
 */
export async function runOnServer(
  deps: ServerRunDeps,
  threadId: string,
  body: SubmitRunBody,
): Promise<ServerRunResult> {
  const interval = deps.pollIntervalMs ?? 450;
  const timeout = deps.timeoutMs ?? 5 * 60_000;

  // Push the lazily-created thread + the user message so the server can find the thread on submit.
  deps.onThreadsChanged(await deps.sync());

  const ack = await deps.submitRun(threadId, body);

  // Anchor the read window from client time with a generous skew margin. `getAssistantMessage`
  // matches the assistant message by its exact id, so a wider window only ever returns a few extra
  // rows (never the wrong message) — and it avoids a round-trip that read the run back just to learn
  // its createdAt, shaving one request off the critical path before the first token.
  const since = new Date(deps.now() - 5 * 60_000).toISOString();

  const start = deps.now();
  let last: Message | null = null;
  for (;;) {
    if (deps.signal?.aborted) return { run: null, assistant: last };
    await deps.sleep(interval);

    let msg: Message | null = null;
    try {
      msg = await deps.getAssistantMessage(threadId, ack.assistantMessageId, since);
    } catch {
      msg = null; // transient (e.g. not written yet) — keep polling within the timeout.
    }

    if (msg) {
      last = msg;
      deps.onAssistant(msg); // stream the growing content into the UI
      if (TERMINAL_MSG.has(msg.status)) {
        deps.onThreadsChanged(await deps.sync()); // reconcile thread metadata (title/preview)
        const run = await deps.getRun(threadId, ack.runId).catch(() => null);
        return { run, assistant: msg };
      }
    }

    if (deps.now() - start > timeout) {
      const run = await deps.getRun(threadId, ack.runId).catch(() => null);
      return { run, assistant: last };
    }
  }
}
