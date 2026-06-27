import { app, type InvocationContext } from '@azure/functions';
import { container } from '../composition';
import { processImageJob } from '../application/imageWorker';
import { decodeImageJob, IMAGE_QUEUE } from '../adapters/azure/queueImageStarter';

/**
 * Queue-triggered image worker: processes one image-generation job independently of the client, so
 * closing the app cannot interrupt generation. Rethrows on failure so the platform can retry; the
 * worker is idempotent (a terminal/deleted record short-circuits).
 */
app.storageQueue('imageWorker', {
  queueName: IMAGE_QUEUE,
  connection: 'AzureWebJobsStorage',
  handler: async (message: unknown, ctx: InvocationContext) => {
    const job = decodeImageJob(message);
    try {
      await processImageJob(container().imageWorker, job.userId, job.imageId);
    } catch (err) {
      ctx.error(`imageWorker failed for image ${job.imageId}`, err);
      throw err;
    }
  },
});
