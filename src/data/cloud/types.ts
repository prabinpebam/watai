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

/** Cloud image metadata (bytes live in Blob Storage at `blobPath`). */
export interface ImageRecord {
  id: string;
  blobPath: string;
  prompt: string;
  size: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  createdAt: string;
}

export interface MessageRecord {
  id: string;
  threadId: string;
  userId: string;
  role: Role;
  content: string;
  model?: string;
  parentId?: string;
  images?: ImageRecord[];
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
  images?: ImageRecord[];
}

/** Request a scoped, short-lived SAS URL for an asset blob. */
export interface SasRequestBody {
  threadId: string;
  assetId: string;
  op: 'read' | 'write';
  contentType: string;
}

export interface SasResult {
  blobPath: string;
  url: string;
  expiresAt: string;
}

/** The caller's access status (from GET /me). */
export interface MeInfo {
  email: string | null;
  isAdmin: boolean;
  isInvited: boolean;
}

/** An allowlisted invite (admin view). */
export interface InviteRecord {
  email: string;
  invitedBy: string;
  createdAt: string;
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
    ...(r.images?.length
      ? {
          images: r.images.map((i) => ({
            id: i.id,
            blobPath: i.blobPath,
            prompt: i.prompt,
            size: i.size,
            outputFormat: i.outputFormat,
            createdAt: i.createdAt,
          })),
        }
      : {}),
  };
}

export function appendBodyFromMessage(m: Message): AppendMessageBody {
  // Only images already uploaded to Blob Storage (blobPath set) are synced; local-only
  // images are uploaded first by the sync engine, which then re-derives this body.
  const uploaded: ImageRecord[] = (m.images ?? [])
    .filter((i): i is typeof i & { blobPath: string } => !!i.blobPath)
    .map((i) => ({
      id: i.id,
      blobPath: i.blobPath,
      prompt: i.prompt,
      size: i.size,
      outputFormat: i.outputFormat,
      createdAt: i.createdAt,
    }));
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    ...(m.model !== undefined ? { model: m.model } : {}),
    ...(m.parentId != null ? { parentId: m.parentId } : {}),
    ...(uploaded.length ? { images: uploaded } : {}),
  };
}
