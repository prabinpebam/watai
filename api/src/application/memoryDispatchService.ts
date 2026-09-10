import type { MemoryQueuePort } from './memoryExtractionService';
import type { MemoryJobDispatchRecord, MemoryJobStore } from '../ports/memoryJobStore';
import type { RunDispatchSummary } from './runDispatchService';
import type { ServiceClock } from './threadService';

export class MemoryDispatchService {
  constructor(
    private readonly jobs: MemoryJobStore,
    private readonly queue: MemoryQueuePort,
    private readonly clock: ServiceClock,
  ) {}

  async reconcile(limit = 50): Promise<RunDispatchSummary> {
    const pending = await this.jobs.listPendingDispatch(limit);
    const summary: RunDispatchSummary = { inspected: pending.length, sent: 0, discarded: 0, failed: 0 };
    for (const dispatch of pending) await this.reconcileOne(dispatch, summary);
    return summary;
  }

  private async reconcileOne(dispatch: MemoryJobDispatchRecord, summary: RunDispatchSummary): Promise<void> {
    const job = await this.jobs.get(dispatch.userId, dispatch.jobId);
    if (
      !job || job.status !== 'queued' || job.releaseId !== dispatch.releaseId ||
      job.executionToken !== dispatch.executionToken || job.dispatchAttempt !== dispatch.attempt
    ) {
      await this.jobs.markDispatchSent(dispatch, this.clock.now());
      summary.discarded += 1;
      return;
    }
    try {
      await this.queue.enqueue(job);
      await this.jobs.markDispatchSent(dispatch, this.clock.now());
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
  }
}
