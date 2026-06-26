import { QueueServiceClient, type QueueClient } from '@azure/storage-queue';
import type { RunStarter } from '../../ports/runStarter';
import type { RunRecord } from '../../ports/runStore';

export const RUN_QUEUE = 'run-jobs';

export interface RunJob {
  runId: string;
  threadId: string;
  userId: string;
}

/**
 * Starts a run by enqueuing a job to a Storage Queue; a queue-triggered worker processes it
 * independently of the client (so closing the app cannot interrupt generation). Uses the
 * `AzureWebJobsStorage` connection string (key-based) — no extra queue RBAC needed.
 * Cancellation is signaled via the run status (the worker re-reads it before finalizing), so
 * `cancel` is a no-op here.
 */
export class QueueRunStarter implements RunStarter {
  private client: QueueClient | undefined;
  private ensured = false;

  constructor(
    private readonly connectionString: string = process.env.AzureWebJobsStorage ?? '',
    private readonly queueName: string = RUN_QUEUE,
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

  async start(run: RunRecord): Promise<{ instanceId: string }> {
    const q = this.queue();
    if (!this.ensured) {
      await q.createIfNotExists();
      this.ensured = true;
    }
    const job: RunJob = { runId: run.id, threadId: run.threadId, userId: run.userId };
    // base64 so the message is encoding-agnostic across the queue extension's settings.
    await q.sendMessage(Buffer.from(JSON.stringify(job), 'utf8').toString('base64'));
    return { instanceId: run.id };
  }

  async cancel(): Promise<void> {
    /* The run status (set by RunService.cancel) is the cancel signal; the worker honors it. */
  }
}

/** Decode a queue message into a run job, tolerating object, base64-string, or raw-JSON forms. */
export function decodeRunJob(message: unknown): RunJob {
  if (message && typeof message === 'object' && 'runId' in (message as Record<string, unknown>)) {
    return message as RunJob;
  }
  const raw = String(message);
  try {
    const obj = JSON.parse(Buffer.from(raw, 'base64').toString('utf8')) as RunJob;
    if (obj?.runId) return obj;
  } catch {
    /* not base64 — fall through */
  }
  return JSON.parse(raw) as RunJob;
}
