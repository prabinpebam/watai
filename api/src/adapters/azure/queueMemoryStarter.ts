import { QueueServiceClient, type QueueClient } from '@azure/storage-queue';
import { parseMemoryJobMessage, type MemoryJobMessage, type MemoryExtractionJobRecord } from '../../domain/memoryExtraction';

export const MEMORY_QUEUE = 'memory-jobs';

export class QueueMemoryStarter {
  private client: QueueClient | undefined;
  private ensured = false;

  constructor(
    private readonly connectionString: string = process.env.AzureWebJobsStorage ?? '',
    private readonly queueName: string = process.env.MEMORY_QUEUE ?? MEMORY_QUEUE,
  ) {}

  private queue(): QueueClient {
    if (!this.client) {
      if (!this.connectionString) throw new Error('AzureWebJobsStorage is not set.');
      this.client = QueueServiceClient.fromConnectionString(this.connectionString).getQueueClient(this.queueName);
    }
    return this.client;
  }

  async enqueue(job: MemoryExtractionJobRecord): Promise<void> {
    const q = this.queue();
    if (!this.ensured) {
      await q.createIfNotExists();
      this.ensured = true;
    }
    const message: MemoryJobMessage = { jobId: job.id, userId: job.userId, threadId: job.threadId, kind: job.kind };
    await q.sendMessage(Buffer.from(JSON.stringify(message), 'utf8').toString('base64'));
  }
}

export function decodeMemoryJob(message: unknown): MemoryJobMessage {
  if (message && typeof message === 'object' && 'jobId' in (message as Record<string, unknown>)) {
    return parseMemoryJobMessage(message);
  }
  const raw = String(message);
  try {
    return parseMemoryJobMessage(JSON.parse(Buffer.from(raw, 'base64').toString('utf8')));
  } catch {
    return parseMemoryJobMessage(JSON.parse(raw));
  }
}