import { QueueServiceClient, type QueueClient } from '@azure/storage-queue';
import type { ImageJob, ImageJobStarter } from '../../ports/imageJobStarter';

export const IMAGE_QUEUE = 'image-jobs';

/**
 * Starts image generation by enqueuing a job to a Storage Queue; a queue-triggered worker
 * processes it independently of the client. Uses the `AzureWebJobsStorage` connection string
 * (key-based) — no extra queue RBAC needed. The queue is created on demand (no infra change).
 */
export class QueueImageStarter implements ImageJobStarter {
  private client: QueueClient | undefined;
  private ensured = false;

  constructor(
    private readonly connectionString: string = process.env.AzureWebJobsStorage ?? '',
    private readonly queueName: string = IMAGE_QUEUE,
  ) {}

  private queue(): QueueClient {
    if (!this.client) {
      if (!this.connectionString) throw new Error('AzureWebJobsStorage is not set.');
      this.client = QueueServiceClient.fromConnectionString(this.connectionString).getQueueClient(
        this.queueName,
      );
    }
    return this.client;
  }

  async start(job: ImageJob): Promise<void> {
    const q = this.queue();
    if (!this.ensured) {
      await q.createIfNotExists();
      this.ensured = true;
    }
    // base64 so the message is encoding-agnostic across the queue extension's settings.
    await q.sendMessage(Buffer.from(JSON.stringify(job), 'utf8').toString('base64'));
  }
}

/** Decode a queue message into an image job, tolerating object, base64-string, or raw-JSON forms. */
export function decodeImageJob(message: unknown): ImageJob {
  if (message && typeof message === 'object' && 'imageId' in (message as Record<string, unknown>)) {
    return message as ImageJob;
  }
  const raw = String(message);
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as ImageJob;
    if (obj?.imageId) return obj;
  } catch {
    /* not base64 — fall through */
  }
  return JSON.parse(raw) as ImageJob;
}
