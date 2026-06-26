// Server-authoritative run driver. With the `serverRuns` flag on, generation happens on the
// server: the client POSTs a prompt and the worker generates + persists the reply even if this
// client closes. This module submits the run, then polls cloud sync so the streaming -> final
// assistant message is pulled into the local store and rendered, until the run is terminal.
//
// It is fully dependency-injected (no direct imports of the api client or the sync engine) so the
// orchestration is unit-testable. The run continues server-side regardless of this driver: polling
// governs only *live rendering* in this client, not whether the run completes.
import type { RunRecord, SubmitRunBody, SubmitRunResult } from '../../data/cloud/types';

export interface ServerRunDeps {
  /** Push local changes + pull remote deltas; resolves with the thread ids that changed locally. */
  sync: () => Promise<Set<string>>;
  submitRun: (threadId: string, body: SubmitRunBody) => Promise<SubmitRunResult>;
  getRun: (threadId: string, runId: string) => Promise<RunRecord>;
  /** Notify the UI that these threads' messages changed (so the open chat reloads). */
  onThreadsChanged: (ids: Set<string>) => void;
  sleep: (ms: number) => Promise<void>;
  now: () => number;
  /** Poll cadence while the run is active (default 2s). */
  pollIntervalMs?: number;
  /** Stop *watching* after this long; the run keeps going server-side (default 5 min). */
  timeoutMs?: number;
}

const TERMINAL = new Set<RunRecord['status']>(['complete', 'error', 'canceled']);

/**
 * Drive one server-side run to completion from this client's perspective:
 * 1. push the just-created thread + user message so the server's submit can find the thread,
 * 2. submit the run,
 * 3. poll-sync until the run reaches a terminal state, pulling the streaming reply as it is written.
 *
 * Returns the final run record, or null if the watch timed out before a terminal status was seen.
 * `submitRun` errors propagate to the caller (so it can surface a toast).
 */
export async function runOnServer(
  deps: ServerRunDeps,
  threadId: string,
  body: SubmitRunBody,
): Promise<RunRecord | null> {
  const interval = deps.pollIntervalMs ?? 2000;
  const timeout = deps.timeoutMs ?? 5 * 60_000;

  // Push the lazily-created thread + the user message so the server can find the thread on submit.
  deps.onThreadsChanged(await deps.sync());

  const ack = await deps.submitRun(threadId, body);

  const start = deps.now();
  for (;;) {
    await deps.sleep(interval);
    // Pull deltas: renders the streaming assistant message as the worker writes it.
    deps.onThreadsChanged(await deps.sync());

    let run: RunRecord | null = null;
    try {
      run = await deps.getRun(threadId, ack.runId);
    } catch {
      run = null; // transient (e.g. record not visible yet) — keep polling within the timeout.
    }

    if (run && TERMINAL.has(run.status)) {
      // One final pull so the completed message + any title change is reflected locally.
      deps.onThreadsChanged(await deps.sync());
      return run;
    }
    if (deps.now() - start > timeout) return run;
  }
}
