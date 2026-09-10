import { AppError } from '../domain/errors';
import type { AppendMessageInput } from '../domain/message';
import type { MessageListOptions, MessageRecord, MessageStore } from '../ports/messageStore';
import type { ThreadRecord, ThreadStore } from '../ports/threadStore';
import type { ServiceClock } from './threadService';
import { libraryIngestionKey, libraryItemIdFor, libraryKindForMime, type LibraryItemRecord } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';
import { ALLOWED_CONTENT_TYPES, canonicalAttachmentBlobPath, isOwnerBlobPath, type AllowedContentType } from '../domain/asset';

export interface MemoryExtractionScheduler {
  enqueueAfterMessage(record: MessageRecord, thread: ThreadRecord): Promise<void>;
}

/**
 * Application service for messages. Ownership is enforced via the parent thread
 * and every child-record operation is owner-qualified so public thread/message IDs may collide
 * across accounts without exposing or overwriting another owner's data.
 */
export class MessageService {
  constructor(
    private readonly threadStore: ThreadStore,
    private readonly messageStore: MessageStore,
    private readonly clock: ServiceClock,
    private readonly memoryExtraction?: MemoryExtractionScheduler,
    private readonly libraryStore?: LibraryStore,
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
    const existing = await this.messageStore.get(userId, threadId, id);
    if (existing) return existing; // idempotent append (sync retry safe)

    const ts = this.clock.now();
    if (input.images?.some((image) => !isOwnerBlobPath(userId, image.blobPath, threadId))) {
      throw new AppError('validation', 'Image path does not belong to this account.');
    }
    const attachments = input.attachments?.length
      ? await Promise.all(input.attachments.map(async (attachment) => {
          if (!attachment.libraryItemId) {
            if (!attachment.blobPath || !ALLOWED_CONTENT_TYPES.includes(attachment.mime as AllowedContentType)) {
              throw new AppError('validation', 'Attachment does not reference a supported upload.');
            }
            const expectedPath = canonicalAttachmentBlobPath(
              userId,
              threadId,
              attachment.id,
              attachment.mime as AllowedContentType,
              thread.temporary,
            );
            if (attachment.blobPath !== expectedPath) {
              throw new AppError('validation', 'Attachment path does not belong to this account and upload.');
            }
            return attachment;
          }
          if (!this.libraryStore) throw new AppError('conflict', 'Library reuse is unavailable.');
          const item = await this.libraryStore.get(userId, attachment.libraryItemId);
          if (!item) throw new AppError('not_found', 'Library item not found.');
          if (item.state !== 'active' || !item.blobPath) throw new AppError('conflict', 'Library item is not available for reuse.');
          const kind = item.kind === 'image' ? 'image' as const : item.kind === 'audio' ? 'audio' as const : 'file' as const;
          return {
            id: attachment.id,
            libraryItemId: item.id,
            ...(attachment.reuseMode ? { reuseMode: attachment.reuseMode } : {}),
            kind,
            blobPath: item.blobPath,
            mime: item.mime,
            bytes: item.bytes,
            name: item.userMetadata?.title ?? item.name,
            ...(item.image?.width ? { width: item.image.width } : {}),
            ...(item.image?.height ? { height: item.image.height } : {}),
          };
        }))
      : undefined;
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
            ...(image.libraryItemId || !thread.temporary ? { libraryItemId: image.libraryItemId ?? libraryItemIdFor(userId, 'chat_generated_image', image.id) } : {}),
          })) }
        : {}),
      ...(attachments && attachments.length
        ? { attachments: attachments.map((attachment) => ({
            ...attachment,
            ...(attachment.libraryItemId || !thread.temporary ? { libraryItemId: attachment.libraryItemId ?? libraryItemIdFor(userId, 'chat_attachment', attachment.id) } : {}),
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
    if (this.libraryStore && !thread.temporary) {
      const candidates: LibraryItemRecord[] = [];
      for (const attachment of record.attachments ?? []) {
        if (!attachment.libraryItemId || !attachment.blobPath?.includes('/library/')) continue;
        candidates.push({
          id: attachment.libraryItemId,
          userId,
          ingestionKey: libraryIngestionKey('chat_attachment', attachment.id),
          state: 'active',
          kind: libraryKindForMime(attachment.mime),
          origin: 'chat_upload',
          name: attachment.name ?? `Attachment ${attachment.id}`,
          mime: attachment.mime,
          bytes: attachment.bytes,
          blobPath: attachment.blobPath,
          createdAt: record.orderAt ?? ts,
          updatedAt: ts,
          source: { surface: 'chat', threadId, messageId: id, threadTitleSnapshot: thread.title, createdAt: record.orderAt ?? ts },
          ...(attachment.kind === 'image' ? { image: { ...(attachment.width ? { width: attachment.width } : {}), ...(attachment.height ? { height: attachment.height } : {}), provenanceComplete: true } } : {}),
        });
      }
      for (const item of candidates) {
        if (!(await this.libraryStore.get(userId, item.id))) await this.libraryStore.put(item);
      }
    }
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
    return this.messageStore.list(userId, threadId, opts);
  }
}
