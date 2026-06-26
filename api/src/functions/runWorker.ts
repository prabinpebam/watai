import { app, type InvocationContext } from '@azure/functions';
import { container } from '../composition';
import { processRun } from '../application/runWorker';
import { decodeRunJob, RUN_QUEUE } from '../adapters/azure/queueRunStarter';

/**
 * Queue-triggered run worker. Generation happens HERE — not in the HTTP request — so a closed or
 * locked client cannot interrupt it. On failure we throw so the queue retries (and poison-queues
 * after the max dequeue count); `processRun` is idempotent, so a redelivery is safe.
 */
app.storageQueue('runWorker', {
  queueName: RUN_QUEUE,
  connection: 'AzureWebJobsStorage',
  handler: async (message: unknown, ctx: InvocationContext): Promise<void> => {
    const job = decodeRunJob(message);
    try {
      await processRun(container().runWorker, job.threadId, job.runId);
    } catch (err) {
      ctx.error(`runWorker failed for run ${job.runId}`, err);
      throw err;
    }
  },
});
