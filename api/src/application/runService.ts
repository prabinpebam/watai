import { AppError } from '../domain/errors';
import { parseRunInput, isActive } from '../domain/run';
import { createHash } from 'node:crypto';
import type { AppendMessageInput } from '../domain/message';
import type { MessageRecord } from '../ports/messageStore';
import type { ThreadStore } from '../ports/threadStore';
import type { RunRecord, RunStore } from '../ports/runStore';
import type { RunStarter } from '../ports/runStarter';
import type { ServiceClock } from './threadService';

/** Narrow dependency on message appending; `MessageService` satisfies this structurally. */
export interface MessageAppender {
  append(userId: string, threadId: string, input: AppendMessageInput): Promise<MessageRecord>;
  get(userId: string, threadId: string, messageId: string): Promise<MessageRecord | null>;
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
    private readonly releaseId = process.env.WATAI_RELEASE_ID?.trim() || 'local-development',
  ) {}

  private async requireOwnThread(userId: string, threadId: string): Promise<void> {
    const t = await this.threadStore.get(userId, threadId);
    if (!t || t.deletedAt) throw new AppError('not_found', 'Thread not found.');
  }

  async submit(userId: string, threadId: string, input: unknown): Promise<RunRecord> {
    await this.requireOwnThread(userId, threadId);
    const parsed = parseRunInput(input);
    const legacyMessageExists = parsed.clientMessageId
      ? (await this.messages.get(userId, threadId, parsed.clientMessageId)) !== null
      : false;

    const ts = this.clock.now();
    const clientMessageId = parsed.clientMessageId ?? this.clock.newId();
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
      releaseId: this.releaseId,
      executionToken: this.clock.newId(),
      dispatchAttempt: 1,
    };
    const requestFingerprint = createHash('sha256').update(JSON.stringify({
      text: parsed.text ?? '',
      attachments: parsed.attachments ?? [],
      model: parsed.model ?? null,
      tools: parsed.tools ?? [],
      allowDestructive: parsed.allowDestructive ?? [],
    })).digest('hex');
    const admission = await this.runStore.admit({
      run,
      idempotencyKey: clientMessageId,
      requestFingerprint,
      legacyMessageExists,
    });
    if (admission.outcome === 'replay') return admission.run;
    if (admission.outcome === 'payload_mismatch') {
      throw new AppError('conflict', 'This message id was already used with different run input.');
    }
    if (admission.outcome === 'legacy_conflict') {
      throw new AppError('conflict', 'This message predates reliable run receipts and cannot be submitted again.');
    }
    if (admission.outcome === 'active_conflict') {
      throw new AppError('conflict', 'A response is already being generated in this thread.');
    }
    const saved = admission.run;

    try {
      await this.messages.append(userId, threadId, {
        id: clientMessageId,
        role: 'user',
        content: parsed.text ?? '',
        orderAt: ts,
        ...(parsed.attachments?.length ? { attachments: parsed.attachments } : {}),
      });
      const { instanceId } = await this.starter.start(saved);
      const dispatch = (await this.runStore.listPendingDispatch()).find((record) =>
        record.userId === userId && record.threadId === threadId && record.runId === saved.id);
      if (dispatch) await this.runStore.markDispatchSent(dispatch, this.clock.now());
      return (await this.runStore.acknowledgeStart(userId, threadId, saved.id, instanceId)) ?? saved;
    } catch {
      return saved;
    }
  }

  async get(userId: string, threadId: string, runId: string): Promise<RunRecord> {
    await this.requireOwnThread(userId, threadId);
    const run = await this.runStore.get(userId, threadId, runId);
    if (!run || run.userId !== userId) throw new AppError('not_found', 'Run not found.');
    return run;
  }

  async listActive(userId: string, threadId: string): Promise<RunRecord[]> {
    await this.requireOwnThread(userId, threadId);
    return this.runStore.listActive(userId, threadId);
  }

  async cancel(userId: string, threadId: string, runId: string): Promise<RunRecord> {
    const run = await this.get(userId, threadId, runId);
    if (!isActive(run.status)) return run; // already terminal — idempotent
    if (run.instanceId) await this.starter.cancel(run).catch(() => {});
    const result = await this.runStore.transition(userId, threadId, runId, ['queued', 'running'], {
      status: 'canceled',
      endedAt: this.clock.now(),
    });
    return result.outcome === 'missing' ? run : result.run;
  }
}
