import type { ImageJobStarter } from '../ports/imageJobStarter';
import type { ImageDispatchRecord, ImageStore } from '../ports/imageStore';
import type { ServiceClock } from './threadService';
import type { RunDispatchSummary } from './runDispatchService';

export class ImageDispatchService {
  constructor(
    private readonly images: ImageStore,
    private readonly starter: ImageJobStarter,
    private readonly clock: ServiceClock,
  ) {}

  async reconcile(limit = 50): Promise<RunDispatchSummary> {
    const pending = await this.images.listPendingDispatch(limit);
    const summary: RunDispatchSummary = { inspected: pending.length, sent: 0, discarded: 0, failed: 0 };
    for (const dispatch of pending) await this.reconcileOne(dispatch, summary);
    const staleBefore = new Date(Date.parse(this.clock.now()) - 30 * 60_000).toISOString();
    for (const image of await this.images.listStaleActive(staleBefore, limit)) {
      await this.images.transition(image.userId, image.id, ['generating'], {
        status: 'error',
        error: { code: 'provider_outcome_unknown', message: 'Image generation stopped without a durable provider outcome and was not retried.' },
        updatedAt: this.clock.now(),
      });
    }
    return summary;
  }

  private async reconcileOne(dispatch: ImageDispatchRecord, summary: RunDispatchSummary): Promise<void> {
    const image = await this.images.get(dispatch.userId, dispatch.imageId);
    if (
      !image || image.status !== 'queued' || image.releaseId !== dispatch.releaseId ||
      image.executionToken !== dispatch.executionToken || image.dispatchAttempt !== dispatch.attempt
    ) {
      await this.images.markDispatchSent(dispatch, this.clock.now());
      summary.discarded += 1;
      return;
    }
    try {
      await this.starter.start({
        imageId: image.id, userId: image.userId, releaseId: dispatch.releaseId,
        executionToken: dispatch.executionToken, attempt: dispatch.attempt,
      });
      await this.images.markDispatchSent(dispatch, this.clock.now());
      summary.sent += 1;
    } catch {
      summary.failed += 1;
    }
  }
}
