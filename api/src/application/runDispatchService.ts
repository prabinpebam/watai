import type { RunStarter } from '../ports/runStarter';
import type { RunDispatchRecord, RunStore } from '../ports/runStore';
import type { ServiceClock } from './threadService';

export interface RunDispatchSummary {
  inspected: number;
  sent: number;
  discarded: number;
  failed: number;
}

export class RunDispatchService {
  constructor(
    private readonly runs: RunStore,
    private readonly starter: RunStarter,
    private readonly clock: ServiceClock,
  ) {}

  async reconcile(limit = 50): Promise<RunDispatchSummary> {
    const pending = await this.runs.listPendingDispatch(limit);
    const summary: RunDispatchSummary = { inspected: pending.length, sent: 0, discarded: 0, failed: 0 };
    for (const dispatch of pending) await this.reconcileOne(dispatch, summary);
    const staleBefore = new Date(Date.parse(this.clock.now()) - 30 * 60_000).toISOString();
    for (const run of await this.runs.listStaleActive(staleBefore, limit)) {
      if (run.status !== 'running') continue;
      await this.runs.transition(run.userId, run.threadId, run.id, ['running'], {
        status: 'error',
        error: { code: 'provider_outcome_unknown', message: 'Generation stopped without a durable provider outcome and was not retried.' },
        endedAt: this.clock.now(),
      });
    }
    return summary;
  }

  private async reconcileOne(dispatch: RunDispatchRecord, summary: RunDispatchSummary): Promise<void> {
    const run = await this.runs.get(dispatch.userId, dispatch.threadId, dispatch.runId);
    if (
      !run || run.status !== 'queued' ||
      run.releaseId !== dispatch.releaseId ||
      run.executionToken !== dispatch.executionToken ||
      run.dispatchAttempt !== dispatch.attempt
    ) {
      await this.runs.markDispatchSent(dispatch, this.clock.now());
      summary.discarded += 1;
      return;
    }
    try {
      const { instanceId } = await this.starter.start(run);
      await this.runs.markDispatchSent(dispatch, this.clock.now());
      await this.runs.acknowledgeStart(run.userId, run.threadId, run.id, instanceId);
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
  }
}
