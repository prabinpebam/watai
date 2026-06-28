import { app, type InvocationContext } from '@azure/functions';
import { container } from '../composition';
import { decodeMemoryJob, MEMORY_QUEUE } from '../adapters/azure/queueMemoryStarter';

app.storageQueue('memoryWorker', {
  queueName: process.env.MEMORY_QUEUE ?? MEMORY_QUEUE,
  connection: 'AzureWebJobsStorage',
  handler: async (message: unknown, ctx: InvocationContext): Promise<void> => {
    const job = decodeMemoryJob(message);
    try {
      await container().memoryWorker.processJob(job.userId, job.jobId);
    } catch (err) {
      ctx.error(`memoryWorker failed for job ${job.jobId}`, err);
      throw err;
    }
  },
});