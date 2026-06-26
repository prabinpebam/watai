import type {
  MessageAttachment,
  MessageCitation,
  MessageImage,
  MessageStatus,
  MessageToolCall,
  Role,
} from '../domain/message';

/** Server-side message document (Cosmos `messages` container, partition key /threadId). */
export interface MessageRecord {
  id: string;
  threadId: string;
  userId: string;
  role: Role;
  content: string;
  model?: string;
  parentId?: string;
  images?: MessageImage[];
  attachments?: MessageAttachment[];
  toolCalls?: MessageToolCall[];
  citations?: MessageCitation[];
  status: MessageStatus;
  createdAt: string;
  /** Logical creation time (chronology key); preserved from the originating device. */
  orderAt?: string;
  deletedAt: string | null;
}

export interface MessageListOptions {
  /** Return only messages with `createdAt` strictly greater than this. */
  since?: string;
  limit?: number;
}

export interface MessageStore {
  get(threadId: string, id: string): Promise<MessageRecord | null>;
  list(threadId: string, opts?: MessageListOptions): Promise<MessageRecord[]>;
  append(record: MessageRecord): Promise<MessageRecord>;
}
