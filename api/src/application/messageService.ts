import { AppError } from '../domain/errors';
import type { AppendMessageInput } from '../domain/message';
import type { MessageListOptions, MessageRecord, MessageStore } from '../ports/messageStore';
import type { ThreadRecord, ThreadStore } from '../ports/threadStore';
import type { ServiceClock } from './threadService';
import { libraryItemIdFor } from '../domain/library';

export interface MemoryExtractionScheduler {
  enqueueAfterMessage(record: MessageRecord, thread: ThreadRecord): Promise<void>;
}

/**
 * Application service for messages. Ownership is enforced via the parent thread
 * (a message is reachable only if the caller owns its thread), so cross-user reads
 * and writes fail closed even though the message store is partitioned by threadId.
 */
export class MessageService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly messageStore: MessageStore,
    private readonly clock: ServiceClock,
    private readonly memoryExtraction?: MemoryExtractionScheduler,
  ) {}

  private async requireOwnThread(userId: string, threadId: string): Promise<ThreadRecord> {
    const thread = await this.threadStore.get(userId, threadId);
    if (!thread || thread.deletedAt) {
      throw new AppError('not_found', 'Thread not found.');
    }
    return thread;
  }

  async append(userId: string, threadId: string, input: AppendMessageInput): Promise<MessageRecord> {
    const thread = await this.requireOwnThread(userId, threadId);

    const id = input.id ?? this.clock.newId();
    const existing = await this.messageStore.get(threadId, id);
    if (existing) return existing; // idempotent append (sync retry safe)

    const ts = this.clock.now();
    const record: MessageRecord = {
      id,
      threadId,
      userId,
      role: input.role,
      content: input.content,
      ...(input.model ? { model: input.model } : {}),
      ...(input.parentId ? { parentId: input.parentId } : {}),
      ...(input.images && input.images.length
        ? { images: input.images.map((image) => ({
            ...image,
            libraryItemId: image.libraryItemId ?? libraryItemIdFor(userId, 'chat_generated_image', image.id),
          })) }
        : {}),
      ...(input.attachments && input.attachments.length
        ? { attachments: input.attachments.map((attachment) => ({
            ...attachment,
            libraryItemId: attachment.libraryItemId ?? libraryItemIdFor(userId, 'chat_attachment', attachment.id),
          })) }
        : {}),
      ...(input.toolCalls && input.toolCalls.length ? { toolCalls: input.toolCalls } : {}),
      ...(input.citations && input.citations.length ? { citations: input.citations } : {}),
      ...(input.memoryRefs && input.memoryRefs.length ? { memoryRefs: input.memoryRefs } : {}),
      status: 'complete',
      // `createdAt` is the server append time (delta-sync cursor). `orderAt` is the device's
      // logical creation time (chronology), preserved as-sent so late-finalized assistant
      // messages still sort right after their user message on every device.
      createdAt: ts,
      orderAt: input.orderAt ?? ts,
      deletedAt: null,
    };
    await this.messageStore.append(record);
    if (this.memoryExtraction) void this.memoryExtraction.enqueueAfterMessage(record, thread).catch(() => {});
    await this.threadStore.put({
      ...thread,
      messageCount: thread.messageCount + 1,
      lastMessagePreview: (
        input.content.trim() ||
        (input.images?.length ? 'Image' : input.attachments?.length ? 'Attachment' : '')
      ).slice(0, 140),
      updatedAt: ts,
    });
    return record;
  }

  async list(userId: string, threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]> {
    await this.requireOwnThread(userId, threadId);
    return this.messageStore.list(threadId, opts);
  }
}
