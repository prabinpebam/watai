import { AppError } from '../domain/errors';
import { parseRunInput, isActive } from '../domain/run';
import type { AppendMessageInput } from '../domain/message';
import type { MessageRecord } from '../ports/messageStore';
import type { ThreadStore } from '../ports/threadStore';
import type { RunRecord, RunStore } from '../ports/runStore';
import type { RunStarter } from '../ports/runStarter';
import type { ServiceClock } from './threadService';

/** Narrow dependency on message appending; `MessageService` satisfies this structurally. */
export interface MessageAppender {
  append(userId: string, threadId: string, input: AppendMessageInput): Promise<MessageRecord>;
}

/**
 * Submits and tracks server-side runs. `submit` persists the user prompt, enforces one active
 * run per thread, creates the run record, and starts the orchestration — then returns
 * immediately so the client can disconnect. The orchestration (RunStarter) owns generation and
 * writes the assistant message into Cosmos; this service never blocks on it.
 */
export class RunService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly messages: MessageAppender,
    private readonly runStore: RunStore,
    private readonly starter: RunStarter,
    private readonly clock: ServiceClock,
  ) {}

  private async requireOwnThread(userId: string, threadId: string): Promise<void> {
    const t = await this.threadStore.get(userId, threadId);
    if (!t || t.deletedAt) throw new AppError('not_found', 'Thread not found.');
  }

  async submit(userId: string, threadId: string, input: unknown): Promise<RunRecord> {
    await this.requireOwnThread(userId, threadId);
    const parsed = parseRunInput(input);

    // One run per thread (server-authoritative lock).
    if ((await this.runStore.listActive(threadId)).length > 0) {
      throw new AppError('conflict', 'A response is already being generated in this thread.');
    }

    // Persist the user prompt (idempotent on the client message id).
    await this.messages.append(userId, threadId, {
      id: parsed.clientMessageId ?? this.clock.newId(),
      role: 'user',
      content: parsed.text ?? '',
      orderAt: this.clock.now(),
      ...(parsed.attachments?.length ? { attachments: parsed.attachments } : {}),
    });

    const ts = this.clock.now();
    const run: RunRecord = {
      id: this.clock.newId(),
      threadId,
      userId,
      assistantMessageId: this.clock.newId(),
      status: 'queued',
      instanceId: null,
      tools: parsed.tools ?? [],
      ...(parsed.model ? { model: parsed.model } : {}),
      allowDestructive: parsed.allowDestructive ?? [],
      prompt: { text: parsed.text, attachments: parsed.attachments },
      error: null,
      createdAt: ts,
      startedAt: null,
      endedAt: null,
      heartbeatAt: ts,
    };
    const saved = await this.runStore.put(run);

    try {
      const { instanceId } = await this.starter.start(saved);
      return this.runStore.put({ ...saved, instanceId });
    } catch {
      // Could not start the worker — fail the run so the thread is not stuck "active".
      await this.runStore.put({
        ...saved,
        status: 'error',
        error: { code: 'internal', message: 'Could not start generation.' },
        endedAt: this.clock.now(),
      });
      throw new AppError('internal', 'Could not start generation.');
    }
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord> {
    await this.requireOwnThread(userId, threadId);
    const run = await this.runStore.get(threadId, runId);
    if (!run || run.userId !== userId) throw new AppError('not_found', 'Run not found.');
    return run;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    await this.requireOwnThread(userId, threadId);
    return this.runStore.listActive(threadId);
  }

  async cancel(userId: string, threadId: string, runId: string): Promise<RunRecord> {
    const run = await this.get(userId, threadId, runId);
    if (!isActive(run.status)) return run; // already terminal — idempotent
    if (run.instanceId) await this.starter.cancel(run).catch(() => {});
    return this.runStore.put({ ...run, status: 'canceled', endedAt: this.clock.now() });
  }
}
