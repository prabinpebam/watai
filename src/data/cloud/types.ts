// Wire records as returned by the Watai persistence API (mirrors api/src/ports/*),
// plus boundary mappers that translate to/from the frontend domain types. The server
// owns `userId`/`deletedAt` and never sees UI-ephemeral fields (attachments, images,
// usage, error, or the sending/streaming statuses), so those are stripped/defaulted here.
import type { Message, Role, Thread, ThreadLock } from '../../lib/types';

export interface ThreadRecord {
  id: string;
  userId: string;
  title: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  messageCount: number;
  lastMessagePreview?: string;
  vectorStoreId?: string;
  files?: ThreadFileRecord[];
  /** Active run lock (set while a device generates a reply); null/absent when free. */
  lock?: ThreadLock | null;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
}

/** A document in a thread's knowledge base (vector store), as returned by the API. */
export interface ThreadFileRecord {
  fileId: string;
  name: string;
  bytes: number;
  status: 'indexing' | 'ready' | 'error';
  createdAt: string;
  kind?: 'document' | 'image';
  blobPath?: string;
  mime?: string;
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

/** Cloud attachment metadata (user-uploaded; bytes live in Blob Storage at `blobPath`). */
export interface AttachmentRecord {
  id: string;
  kind: 'image' | 'audio' | 'file';
  blobPath: string;
  mime: string;
  bytes: number;
  name?: string;
  width?: number;
  height?: number;
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
  attachments?: AttachmentRecord[];
  toolCalls?: ToolCallRecord[];
  citations?: CitationRecord[];
  status: ServerMessageStatus;
  createdAt: string;
  /** Logical creation time (chronology key); preserved from the originating device. */
  orderAt?: string;
  deletedAt: string | null;
}

/** Bounded tool-activity record synced with a message (mirrors api message validator). */
export interface ToolCallRecord {
  id: string;
  kind: 'function' | 'web_search' | 'code_interpreter' | 'file_search' | 'image';
  name?: string;
  status: 'running' | 'done' | 'error';
  summary?: string;
  /** Bounded tool output (e.g. code-interpreter result) shown in the tool card. */
  resultPreview?: string;
  /** Requested image size (`WxH`) for an image tool call (drives the generating placeholder). */
  imageSize?: string;
}

/** Grounding citation record synced with a message (full, so the source pane matches everywhere). */
export interface CitationRecord {
  url?: string;
  title?: string;
  source?: 'web' | 'file';
  filename?: string;
  content?: string;
  favicon?: string;
  bingQueryUrl?: string;
  fileId?: string;
  startIndex?: number;
  endIndex?: number;
}

export interface CreateThreadBody {
  /** Client-supplied id so local and cloud stay consistent (server create is idempotent on it). */
  id?: string;
  title: string;
  temporary?: boolean;
  vectorStoreId?: string;
}

/** The server's update schema is strict: only these fields are accepted. */
export interface UpdateThreadBody {
  title?: string;
  pinned?: boolean;
  archived?: boolean;
  vectorStoreId?: string;
}

export interface AppendMessageBody {
  id?: string;
  role: Role;
  content: string;
  model?: string;
  parentId?: string;
  /** Logical creation time (chronology); the server preserves it. */
  orderAt?: string;
  images?: ImageRecord[];
  attachments?: AttachmentRecord[];
  toolCalls?: ToolCallRecord[];
  citations?: CitationRecord[];
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

// --- credential vault (server-side AI keys) ---

/** Model deployment names configured server-side (mirrors api credentials schema). */
export interface ModelDeployments {
  chat: string;
  image?: string;
  transcribe?: string;
  tts?: string;
}

/**
 * Non-secret credential status (GET/PUT /credentials). This is the ONLY credential shape the
 * server returns — it never carries the key or any ciphertext, only a last-4 hint.
 */
export interface CredentialStatus {
  configured: boolean;
  baseUrl?: string;
  models?: ModelDeployments;
  keyHint?: string;
  tavilyConfigured: boolean;
  tavilyHint?: string | null;
}

/** Write payload for PUT /credentials. The key is encrypted server-side and never returned. */
export interface CredentialsInput {
  /** Bare resource name or full base URL; the server normalizes to the `…/openai/v1` base. */
  baseUrl: string;
  models: ModelDeployments;
  key: string;
  tavilyKey?: string;
  /** Account-wide knowledge base store, searched as a fallback alongside per-thread files. */
  knowledgeBaseVectorStoreId?: string;
}

// --- runs (server-authoritative generation) ---

export type RunStatus = 'queued' | 'running' | 'complete' | 'error' | 'canceled';

export interface RunError {
  code: string;
  message: string;
}

/** Server run record (GET /threads/{id}/runs/{runId}). One row per generation. */
export interface RunRecord {
  id: string;
  threadId: string;
  userId: string;
  assistantMessageId: string;
  status: RunStatus;
  instanceId?: string | null;
  tools: string[];
  allowDestructive: string[];
  prompt?: { text?: string; attachments?: AttachmentRecord[] };
  error?: RunError | null;
  createdAt: string;
  startedAt?: string | null;
  endedAt?: string | null;
  heartbeatAt: string;
}

/** Submit a run (POST /threads/{id}/runs). Generation continues server-side after the 202. */
export interface SubmitRunBody {
  text?: string;
  attachments?: AttachmentRecord[];
  /** Idempotency key for the user message — pass the locally-created user message id so the
   *  server's copy and the local one converge to a single record when sync pulls it back. */
  clientMessageId?: string;
  tools?: string[];
  allowDestructive?: string[];
}

/** The 202 acknowledgement from POST /threads/{id}/runs. */
export interface SubmitRunResult {
  runId: string;
  assistantMessageId: string;
  status: RunStatus;
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
    // Always present so a server-cleared lock overwrites a stale local one on merge.
    lock: r.lock ?? null,
    ...(r.lastMessagePreview !== undefined ? { lastMessagePreview: r.lastMessagePreview } : {}),
    ...(r.vectorStoreId !== undefined ? { vectorStoreId: r.vectorStoreId } : {}),
    ...(r.files !== undefined ? { files: r.files } : {}),
  };
}

/** Extract only the fields the server's strict update schema accepts. */
export function updateBodyFromPatch(patch: Partial<Thread>): UpdateThreadBody {
  const body: UpdateThreadBody = {};
  if (patch.title !== undefined) body.title = patch.title;
  if (patch.pinned !== undefined) body.pinned = patch.pinned;
  if (patch.archived !== undefined) body.archived = patch.archived;
  if (patch.vectorStoreId !== undefined) body.vectorStoreId = patch.vectorStoreId;
  return body;
}

export function messageFromRecord(r: MessageRecord): Message {
  return {
    id: r.id,
    threadId: r.threadId,
    role: r.role,
    content: r.content,
    status: r.status,
    // Order by the preserved logical time; fall back to the server append time for old records.
    createdAt: r.orderAt ?? r.createdAt,
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
    ...(r.attachments?.length
      ? {
          attachments: r.attachments.map((a) => ({
            id: a.id,
            kind: a.kind,
            blobPath: a.blobPath,
            mime: a.mime,
            bytes: a.bytes,
            ...(a.name !== undefined ? { name: a.name } : {}),
            ...(a.width !== undefined ? { width: a.width } : {}),
            ...(a.height !== undefined ? { height: a.height } : {}),
          })),
        }
      : {}),
    ...(r.toolCalls?.length ? { toolCalls: r.toolCalls.map((t) => ({ ...t })) } : {}),
    ...(r.citations?.length ? { citations: r.citations.map((c) => ({ ...c })) } : {}),
  };
}

export function appendBodyFromMessage(m: Message): AppendMessageBody {
  // Only assets already uploaded to Blob Storage (blobPath set) are synced; local-only ones
  // are uploaded first by the sync engine, which then re-derives this body.
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
  const uploadedAtts: AttachmentRecord[] = (m.attachments ?? [])
    .filter((a): a is typeof a & { blobPath: string } => !!a.blobPath)
    .map((a) => ({
      id: a.id,
      kind: a.kind,
      blobPath: a.blobPath,
      mime: a.mime,
      bytes: a.bytes,
      ...(a.name !== undefined ? { name: a.name } : {}),
      ...(a.width !== undefined ? { width: a.width } : {}),
      ...(a.height !== undefined ? { height: a.height } : {}),
    }));
  return {
    id: m.id,
    role: m.role,
    content: m.content,
    // Stamp the logical creation time so chronology is preserved across devices.
    orderAt: m.createdAt,
    ...(m.model !== undefined ? { model: m.model } : {}),
    ...(m.parentId != null ? { parentId: m.parentId } : {}),
    ...(uploaded.length ? { images: uploaded } : {}),
    ...(uploadedAtts.length ? { attachments: uploadedAtts } : {}),
    ...(m.toolCalls?.length
      ? {
          toolCalls: m.toolCalls.map((t) => ({
            id: t.id,
            kind: t.kind,
            ...(t.name !== undefined ? { name: t.name } : {}),
            // Persisted activity is terminal; coerce transient UI states to 'done'.
            status: t.status === 'done' || t.status === 'error' ? t.status : ('done' as const),
            ...(t.summary !== undefined ? { summary: t.summary } : {}),
            ...(t.resultPreview !== undefined ? { resultPreview: t.resultPreview } : {}),
            ...(t.imageSize !== undefined ? { imageSize: t.imageSize } : {}),
          })),
        }
      : {}),
    ...(m.citations?.length
      ? {
          citations: m.citations.map((c) => ({
            ...(c.url !== undefined ? { url: c.url } : {}),
            ...(c.title !== undefined ? { title: c.title } : {}),
            ...(c.source !== undefined ? { source: c.source } : {}),
            ...(c.filename !== undefined ? { filename: c.filename } : {}),
            ...(c.content !== undefined ? { content: c.content } : {}),
            ...(c.favicon !== undefined ? { favicon: c.favicon } : {}),
            ...(c.bingQueryUrl !== undefined ? { bingQueryUrl: c.bingQueryUrl } : {}),
            ...(c.fileId !== undefined ? { fileId: c.fileId } : {}),
            ...(c.startIndex !== undefined ? { startIndex: c.startIndex } : {}),
            ...(c.endIndex !== undefined ? { endIndex: c.endIndex } : {}),
          })),
        }
      : {}),
  };
}
