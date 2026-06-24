// Wire records as returned by the Watai persistence API (mirrors api/src/ports/*),
// plus boundary mappers that translate to/from the frontend domain types. The server
// owns `userId`/`deletedAt` and never sees UI-ephemeral fields (attachments, images,
// usage, error, or the sending/streaming statuses), so those are stripped/defaulted here.
import type { Message, Role, Thread } from '../../lib/types';

export interface ThreadRecord {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  messageCount: number;
  lastMessagePreview?: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

export type ServerMessageStatus = 'complete' | 'interrupted' | 'error';

export interface MessageRecord {
  id: string;
  threadId: string;
  userId: string;
  role: Role;
  content: string;
  model?: string;
  parentId?: string;
  status: ServerMessageStatus;
  createdAt: string;
  deletedAt: string | null;
}

export interface CreateThreadBody {
  /** Client-supplied id so local and cloud stay consistent (server create is idempotent on it). */
  id?: string;
  title: string;
  temporary?: boolean;
}

/** The server's update schema is strict: only these three fields are accepted. */
export interface UpdateThreadBody {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
}

export interface AppendMessageBody {
  id?: string;
  role: Role;
  content: string;
  model?: string;
  parentId?: string;
}

export function threadFromRecord(r: ThreadRecord): Thread {
  return {
    id: r.id,
    title: r.title,
    pinned: r.pinned,
    archived: r.archived,
    temporary: r.temporary,
    createdAt: r.createdAt,
    updatedAt: r.updatedAt,
    deletedAt: r.deletedAt,
    messageCount: r.messageCount,
    ...(r.lastMessagePreview !== undefined ? { lastMessagePreview: r.lastMessagePreview } : {}),
  };
}

/** Extract only the fields the server's strict update schema accepts. */
export function updateBodyFromPatch(patch: Partial<Thread>): UpdateThreadBody {
  const body: UpdateThreadBody = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.pinned !== undefined) body.pinned = patch.pinned;
  if (patch.archived !== undefined) body.archived = patch.archived;
  return body;
}

export function messageFromRecord(r: MessageRecord): Message {
  return {
    id: r.id,
    threadId: r.threadId,
    role: r.role,
    content: r.content,
    status: r.status,
    createdAt: r.createdAt,
    ...(r.model !== undefined ? { model: r.model } : {}),
    ...(r.parentId !== undefined ? { parentId: r.parentId } : {}),
  };
}

export function appendBodyFromMessage(m: Message): AppendMessageBody {
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.model !== undefined ? { model: m.model } : {}),
    ...(m.parentId != null ? { parentId: m.parentId } : {}),
  };
}
