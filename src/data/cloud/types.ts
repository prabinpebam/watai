// Wire records as returned by the Watai persistence API (mirrors api/src/ports/*),
// plus boundary mappers that translate to/from the frontend domain types. The server
// owns `userId`/`deletedAt` and never sees UI-ephemeral fields (attachments, images,
// usage, error, or the sending/streaming statuses), so those are stripped/defaulted here.
import type { MemoryKind, Message, Role, Thread, ThreadLock } from '../../lib/types';

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
  kind?: 'document' | 'image' | 'artifact';
  blobPath?: string;
  mime?: string;
}

export type ServerMessageStatus = 'streaming' | 'complete' | 'interrupted' | 'error';
export type MemoryStatus = 'active' | 'suppressed' | 'invalidated' | 'deleted';
export type MemoryVisibility = 'normal' | 'top_of_mind' | 'background';
export type MemorySourceType = 'message' | 'thread' | 'manual' | 'import' | 'settings' | 'system';

export interface MemorySourceRefRecord {
  type: MemorySourceType;
  threadId?: string;
  messageId?: string;
  runId?: string;
  quote?: string;
  createdAt: string;
}

export interface MemoryRecord {
  id: string;
  userId: string;
  kind: MemoryKind;
  status: MemoryStatus;
  text: string;
  normalizedText?: string;
  summary?: string;
  entities?: string[];
  topics?: string[];
  sourceRefs: MemorySourceRefRecord[];
  confidence: number;
  salience: number;
  pinned: boolean;
  sensitive: boolean;
  sourceHash?: string;
  visibility: MemoryVisibility;
  validAt?: string;
  invalidAt?: string;
  createdAt: string;
  updatedAt: string;
  lastUsedAt?: string;
  useCount: number;
  supersedes?: string[];
  supersededBy?: string;
  embedding?: number[];
  embeddingModel?: string;
  deletedAt?: string;
}

export interface MemorySummaryRecord {
  id: 'memory-summary';
  userId: string;
  kind: 'summary';
  text: string;
  sourceMemoryIds: string[];
  updatedAt: string;
  version: number;
}

export interface MemoryProfileItem {
  text: string;
  sourceMemoryIds: string[];
  confidence: number;
}

export interface MemoryProfileChild extends MemoryProfileItem {
  name: string;
  relationship: 'daughter' | 'son' | 'child';
  age?: number;
}

export interface MemoryProfileView {
  schemaVersion: 1;
  userId: string;
  updatedAt: string;
  evidenceCount: number;
  profile: {
    user: {
      details: Record<string, MemoryProfileItem>;
      family: {
        spouse: MemoryProfileItem[];
        children: MemoryProfileChild[];
        pets: Array<{ name: string; species?: string; inspiredBy: string[]; sourceMemoryIds: string[]; confidence: number }>;
      };
      preferences: {
        communication: MemoryProfileItem[];
        engineering: MemoryProfileItem[];
        design: MemoryProfileItem[];
        tools: MemoryProfileItem[];
        other: MemoryProfileItem[];
      };
      interests: {
        media: Array<{ name: string; sourceMemoryIds: string[] }>;
        hobbies: Array<{ name: string; sourceMemoryIds: string[] }>;
        other: Array<{ name: string; sourceMemoryIds: string[] }>;
      };
    };
    work: {
      projects: MemoryProfileItem[];
      repositories: MemoryProfileItem[];
      deployments: MemoryProfileItem[];
      currentFocus: MemoryProfileItem[];
    };
    avoidances: MemoryProfileItem[];
  };
  temporal: {
    today: { items: Array<{ memoryId: string; text: string; kind: MemoryKind; updatedAt: string }> };
    week: { items: Array<{ memoryId: string; text: string; kind: MemoryKind; updatedAt: string }> };
    month: { items: Array<{ memoryId: string; text: string; kind: MemoryKind; updatedAt: string }> };
  };
}

export interface MemoryContextBlock {
  summary?: string;
  customInstructions?: {
    aboutYou?: string;
    howRespond?: string;
  };
  instructions: string[];
  memories: Array<{
    id: string;
    kind: MemoryKind;
    text: string;
    validAt?: string;
    invalidAt?: string;
    score: number;
  }>;
  threadSummaries: Array<{
    threadId: string;
    title?: string;
    summary: string;
    score: number;
  }>;
  sourceRefs: Array<{
    memoryId: string;
    threadId?: string;
    messageId?: string;
  }>;
  tokenEstimate: number;
  latencyBudgetMs: number;
  retrievalMode: 'empty' | 'vector' | 'profile';
  profile?: string;
}

export interface ListMemoryQuery {
  status?: MemoryStatus;
  kind?: MemoryKind;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface ListMemoryResponse {
  memories: MemoryRecord[];
  cursor?: string;
}

export interface CreateMemoryBody {
  text: string;
  kind?: Exclude<MemoryKind, 'thread_summary' | 'entity'>;
  visibility?: MemoryVisibility;
  pinned?: boolean;
  sourceRef?: MemorySourceRefRecord;
}

export interface PatchMemoryBody {
  text?: string;
  kind?: MemoryKind;
  status?: Extract<MemoryStatus, 'active' | 'suppressed' | 'invalidated'>;
  visibility?: MemoryVisibility;
  pinned?: boolean;
  salience?: number;
}

export interface MemorySummaryResponse {
  summary: MemorySummaryRecord | null;
}

export interface PutMemorySummaryBody {
  text: string;
}

export interface MemoryQueryPreviewBody {
  threadId?: string;
  text: string;
  includeSuppressed?: boolean;
  limit?: number;
}

export interface MemoryQueryPreviewResponse {
  context: MemoryContextBlock;
  candidates: Array<{
    memory: MemoryRecord;
    score: number;
    reason: string[];
    selected: boolean;
  }>;
}

export interface MemoryExportResponse {
  exportedAt: string;
  version: 1;
  memories: MemoryRecord[];
  summary: MemorySummaryRecord | null;
}

export interface MemoryImportBody {
  version: 1;
  memories: Array<Pick<MemoryRecord, 'text' | 'kind' | 'sourceRefs' | 'visibility' | 'pinned'>>;
  mode: 'preview' | 'commit';
}

export interface MemoryImportResponse {
  added: number;
  skipped: number;
  rejected: Array<{ text: string; reason: string }>;
  preview?: MemoryRecord[];
}

export interface MemoryRebuildBody {
  mode: 'preview' | 'commit';
  includeArchived?: boolean;
  since?: string;
}

export interface MemoryRebuildResponse {
  jobId?: string;
  status: 'queued' | 'preview_ready';
  previewCount?: number;
}

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

/** Generated-artifact record synced with a message (bytes in Blob Storage at `blobPath`). */
export interface ArtifactRecord {
  id: string;
  name: string;
  mime: string;
  kind: 'pdf' | 'document' | 'spreadsheet' | 'presentation' | 'image' | 'data' | 'archive' | 'code' | 'text';
  bytes: number;
  blobPath: string;
  sourceToolCallId?: string;
  createdAt: string;
}

export type LibraryKind =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'data'
  | 'audio'
  | 'archive'
  | 'code'
  | 'text'
  | 'other';

export type LibraryOrigin =
  | 'chat_upload'
  | 'library_upload'
  | 'chat_generated_image'
  | 'studio_generated_image'
  | 'code_artifact'
  | 'thread_document';

export type LibraryState = 'pending' | 'active' | 'trashed' | 'purging' | 'purged' | 'missing' | 'failed';

export interface LibraryItemDTO {
  id: string;
  state: LibraryState;
  kind: LibraryKind;
  origin: LibraryOrigin;
  name: string;
  mime: string;
  bytes: number;
  blobPath?: string;
  contentHash?: string;
  derivatives?: Array<{
    kind: 'thumbnail';
    blobPath: string;
    mime: 'image/jpeg' | 'image/webp';
    bytes: number;
    width: number;
    height: number;
  }>;
  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  purgeAfter?: string;
  purgedAt?: string;
  error?: { code: string; message: string } | null;
  source: {
    surface: 'chat' | 'image_studio' | 'library';
    threadId?: string;
    messageId?: string;
    runId?: string;
    toolCallId?: string;
    threadTitleSnapshot?: string;
    createdAt: string;
  };
  image?: {
    width?: number;
    height?: number;
    size?: string;
    format?: 'png' | 'jpeg' | 'webp';
    prompt?: string;
    revisedPrompt?: string;
    promptSnapshot?: string;
    model?: string;
    quality?: 'low' | 'medium' | 'high';
    referenceItemIds?: string[];
    provenanceComplete: boolean;
  };
  artifact?: { sourceItemIds?: string[]; version?: number; provenanceComplete: boolean };
  userMetadata?: { title?: string; starred?: boolean };
  url?: string;
  thumbnailUrl?: string;
}

export interface LibraryListResult {
  items: LibraryItemDTO[];
  cursor?: string;
  totalApprox?: number;
}

export interface LibraryStorageSummary {
  activeBytes: number;
  trashedBytes: number;
  activeCount: number;
  trashedCount: number;
  byKind: Array<{ kind: LibraryKind; bytes: number; count: number }>;
  byOrigin: Array<{ origin: LibraryOrigin; bytes: number; count: number }>;
  largestSourceThreads: Array<{ threadId: string; title: string; bytes: number; count: number }>;
  duplicateGroups: number;
  estimate?: {
    monthlyCapacityCost: number;
    currency: string;
    ratePerGbMonth: number;
    region: string;
    sku: string;
    rateAsOf: string;
    exclusions: string[];
  };
  reconciledAt?: string;
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
  webImages?: WebImageRecord[];
  memoryRefs?: MessageMemoryRefRecord[];
  artifacts?: ArtifactRecord[];
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
  /** Ids of artifacts this tool call produced (code interpreter outputs). */
  artifactIds?: string[];
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

/** An image surfaced by web search (inline + one-tap "Use" to attach). */
export interface WebImageRecord {
  id: string;
  url: string;
  description?: string;
  sourceUrl?: string;
}

/** Memories selected into an assistant response context. */
export interface MessageMemoryRefRecord {
  memoryId: string;
  kind: MemoryKind;
  text: string;
  sourceThreadId?: string;
  sourceMessageId?: string;
  score: number;
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
  webImages?: WebImageRecord[];
  memoryRefs?: MessageMemoryRefRecord[];
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

/** Admin view of the server-decided models used for background memory work. Two tiers:
 *  `base` is routine extraction (a lighter/faster model); `deep` is heavy operations
 *  (rebuilds, merges, conflict resolution). `model === null` means it falls back to the
 *  user's own chat model. */
export interface MemoryModelSlot {
  model: string | null;
  source: 'override' | 'env' | 'chat' | 'base';
  envDefault: string | null;
  override: string | null;
}

export interface MemoryModelConfig {
  base: MemoryModelSlot;
  deep: MemoryModelSlot;
  updatedAt?: string;
  updatedBy?: string;
}

// --- credential vault (server-side AI keys) ---

/** Model deployment names configured server-side (mirrors api credentials schema). */
export interface ModelDeployments {
  chat: string;
  chatOptions?: string[];
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
  knowledgeBaseVectorStoreId?: string | null;
  capabilities?: CredentialCapabilities;
}

/** What the configured endpoint + models can do (derived server-side from the saved config). */
export interface CredentialCapabilities {
  chat: boolean;
  image: boolean;
  transcribe: boolean;
  tts: boolean;
  agentic: boolean;
  codeInterpreter: boolean;
  fileSearch: boolean;
  webSearch: boolean;
}

/** Write payload for PUT /credentials. The key is encrypted server-side and never returned. */
export interface CredentialsInput {
  /** Bare resource name or full base URL; the server normalizes to the `…/openai/v1` base. */
  baseUrl: string;
  models: ModelDeployments;
  /** Optional on update — omit to keep the already-stored (write-only) key. */
  key?: string;
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
  model?: string;
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
  model?: string;
  tools?: string[];
  allowDestructive?: string[];
}

/** The 202 acknowledgement from POST /threads/{id}/runs. */
export interface SubmitRunResult {
  runId: string;
  assistantMessageId: string;
  status: RunStatus;
}

/** Image-generation lifecycle (server-authoritative image studio). */
export type ImageGenStatus = 'queued' | 'generating' | 'ready' | 'error';

/** Server image record (GET /images, GET /images/{id}). One row per image. */
export interface StudioImage {
  id: string;
  userId: string;
  batchId: string;
  status: ImageGenStatus;
  prompt: string;
  revisedPrompt?: string;
  size: string;
  quality?: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  model: string;
  blobPath?: string;
  sourceImageId?: string;
  useReference?: boolean;
  error?: { code: string; message: string } | null;
  createdAt: string;
  updatedAt: string;
  /** Short-lived read URL, present only when `ready` (never persisted server-side). */
  url?: string;
}

/** Create images (POST /images). Generation continues server-side after the 202. */
export interface CreateImagesBody {
  prompt: string;
  size?: string;
  count?: number;
  quality?: 'low' | 'medium' | 'high';
  /** Remix lineage: generate from one of the caller's own images. */
  sourceImageId?: string;
  /** When remixing, use the source image as an edit reference (image-to-image). */
  useReference?: boolean;
}

export interface ListImagesQuery {
  q?: string;
  size?: string;
  sort?: 'newest' | 'oldest';
  cursor?: string;
  limit?: number;
}

export interface ListImagesResult {
  images: StudioImage[];
  cursor?: string;
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
    ...(r.webImages?.length ? { webImages: r.webImages.map((w) => ({ ...w })) } : {}),
    ...(r.memoryRefs?.length ? { memoryRefs: r.memoryRefs.map((m) => ({ ...m })) } : {}),
    ...(r.artifacts?.length
      ? {
          artifacts: r.artifacts.map((a) => ({
            id: a.id,
            name: a.name,
            mime: a.mime,
            kind: a.kind,
            bytes: a.bytes,
            blobPath: a.blobPath,
            ...(a.sourceToolCallId !== undefined ? { sourceToolCallId: a.sourceToolCallId } : {}),
            createdAt: a.createdAt,
          })),
        }
      : {}),
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
    ...(m.webImages?.length
      ? { webImages: m.webImages.map((w) => ({ id: w.id, url: w.url, ...(w.description ? { description: w.description } : {}), ...(w.sourceUrl ? { sourceUrl: w.sourceUrl } : {}) })) }
      : {}),
    ...(m.memoryRefs?.length ? { memoryRefs: m.memoryRefs.map((memoryRef) => ({ ...memoryRef })) } : {}),
  };
}
