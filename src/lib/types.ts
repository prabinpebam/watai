// Core domain types — mirror documentation/ui-design/08-frontend-architecture.md §4.

export type Id = string;

export type Theme = 'system' | 'light' | 'dark';
export type TextScale = 0.9 | 1.0 | 1.1 | 1.25;
export type Density = 'comfortable' | 'compact';

export interface Thread {
  id: Id;
  title: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  model?: string;
  /** Vector store id holding this thread's uploaded documents (thread-scoped file search). */
  vectorStoreId?: string;
  /** Documents uploaded into this thread's knowledge base (vector store) for file search. */
  files?: ThreadFile[];
  /** Active run lock: set while a device is generating a reply here; null/absent when free. */
  lock?: ThreadLock | null;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  messageCount: number;
  lastMessagePreview?: string;
}

/** A document uploaded into a thread's knowledge base (vector store) for file search. */
export interface ThreadFile {
  /** Azure OpenAI file id (also the vector-store file id) — the delete key. */
  fileId: string;
  libraryItemId?: string;
  name: string;
  bytes: number;
  status: 'indexing' | 'ready' | 'error';
  createdAt: string;
  /** 'document' = searchable upload; 'image' = a generated image; 'artifact' = a generated
   *  downloadable file (code interpreter output), rendered from `blobPath`. */
  kind?: 'document' | 'image' | 'artifact';
  blobPath?: string;
  mime?: string;
}

/** Per-thread run lock (server-coordinated) so two devices never generate a reply at once. */
export interface ThreadLock {
  /** Stable id of the holding device (distinct from the user id). */
  deviceId: string;
  /** Human-friendly holder label for the "locked" UX, e.g. "Chrome on Windows". */
  deviceLabel: string;
  acquiredAt: string;
  /** Last heartbeat; the lock is considered stale (stealable) once this is old enough. */
  heartbeatAt: string;
}

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'complete' | 'streaming' | 'interrupted' | 'error';
export type MemoryKind =
  | 'fact'
  | 'preference'
  | 'instruction'
  | 'work_style'
  | 'project_context'
  | 'thread_summary'
  | 'avoidance'
  | 'entity'
  | 'procedure';

export interface Attachment {
  id: Id;
  libraryItemId?: Id;
  reuseMode?: 'attach' | 'reference';
  kind: 'image' | 'audio' | 'file';
  localBlobKey?: string;
  blobPath?: string;
  mime: string;
  bytes: number;
  name?: string;
  width?: number;
  height?: number;
}

export interface ImageRef {
  id: Id;
  libraryItemId?: Id;
  localBlobKey?: string;
  blobPath?: string;
  prompt: string;
  size: string;
  outputFormat: 'png' | 'jpeg' | 'webp';
  createdAt: string;
  /** Provenance (intent-aware image generation). All optional/additive. */
  expandedPrompt?: string;
  model?: string;
  sourceMessageIds?: Id[];
  editOf?: Id | null;
  referenceItemIds?: Id[];
  provenanceComplete?: boolean;
}

/** Transient placeholder for an image being generated. Render-only — never persisted or synced. */
export interface PendingImage {
  id: Id;
  /** Requested image size as `WxH` (e.g. `1024x1536`), used to size the placeholder. */
  size: string;
}

/** Kind of tool activity recorded on an assistant message. */
export type ToolKind = 'function' | 'web_search' | 'code_interpreter' | 'file_search' | 'image';

/** Artifact kinds drive the card icon + preview routing (derived from mime server-side). */
export type ArtifactKind =
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'image'
  | 'data'
  | 'archive'
  | 'code'
  | 'text';

/** A file the agent generated during a run (code interpreter output). Bytes live in Blob Storage
 *  at `blobPath`; resolved to a downloadable URL via the read-SAS flow. */
export interface Artifact {
  id: Id;
  libraryItemId?: Id;
  name: string;
  mime: string;
  kind: ArtifactKind;
  bytes: number;
  blobPath?: string;
  localBlobKey?: string;
  sourceToolCallId?: Id;
  sourceItemIds?: Id[];
  version?: number;
  provenanceComplete?: boolean;
  createdAt: string;
}

/** A bounded, secret-free record of one tool invocation (for the transcript). */
export interface ToolCall {
  id: Id;
  kind: ToolKind;
  name?: string;
  status: 'running' | 'awaiting-confirm' | 'done' | 'error';
  summary?: string;
  argsPreview?: string;
  resultPreview?: string;
  /** Requested image size (`WxH`) for an image tool call (drives the generating placeholder). */
  imageSize?: string;
  /** Ids of artifacts this tool call produced (code interpreter outputs). */
  artifactIds?: Id[];
  error?: AiError;
}

/** A grounding citation (web url_citation or file_citation). */
export interface Citation {
  url?: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
  bingQueryUrl?: string;
  source?: 'web' | 'file';
  fileId?: string;
  filename?: string;
  favicon?: string;
  /** Raw result content (e.g. the Tavily snippet) shown in the source detail pane. Bounded. */
  content?: string;
}

/** An image surfaced by web search: shown inline and offered as a one-tap chat attachment. The bytes
 *  are fetched on demand (via /web/image) only when the user taps "Use". */
export interface WebImage {
  id: Id;
  url: string;
  description?: string;
  sourceUrl?: string;
}

/** Memories selected into an assistant response context, shown in the Memory Used panel. */
export interface MessageMemoryRef {
  memoryId: Id;
  kind: MemoryKind;
  text: string;
  sourceThreadId?: Id;
  sourceMessageId?: Id;
  score: number;
}

export interface Message {
  id: Id;
  threadId: Id;
  role: Role;
  content: string;
  model?: string;
  parentId?: Id | null;
  status: MessageStatus;
  attachments?: Attachment[];
  images?: ImageRef[];
  pendingImages?: PendingImage[];
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: AiError;
  createdAt: string;
  /** Agentic activity (additive/optional). */
  toolCalls?: ToolCall[];
  citations?: Citation[];
  /** Images surfaced by web search (inline strip + one-tap "Use" to attach). */
  webImages?: WebImage[];
  memoryRefs?: MessageMemoryRef[];
  /** Files the agent generated this message (code interpreter outputs). */
  artifacts?: Artifact[];
}

export type EndpointKind = 'aoai' | 'foundry-project';

export interface ApiConfig {
  baseUrl: string;
  endpointKind?: EndpointKind;
  projectEndpoint?: string;
  models: { chat: string; transcribe: string; image: string; tts?: string; orchestrator?: string };
  chatDefaults: {
    reasoningEffort?: 'minimal' | 'low' | 'high' | 'medium';
    maxCompletionTokens?: number;
    systemPrompt?: string;
  };
  tools?: {
    webSearch?: boolean;
    codeInterpreter?: boolean;
    fileSearch?: boolean;
    bingConnectionId?: string;
    vectorStoreId?: string;
    /** Local-only filename registry for the file-search knowledge base (names never leave the browser). */
    kbFiles?: { id: string; name: string; status: 'ready' | 'indexing' | 'failed' }[];
  };
  consent?: { webSearchDataBoundary?: boolean };
  keyEncrypted: boolean;
}

export interface MemorySettings {
  enabled: boolean;
  paused: boolean;
  referenceSaved: boolean;
  referenceHistory: boolean;
  autoExtract: boolean;
}

export interface Settings {
  personalization: { aboutYou?: string; howRespond?: string; memoryEnabled: boolean; memory?: MemorySettings };
  appearance: {
    theme: Theme;
    textScale: TextScale;
    density: Density;
    reduceMotion: boolean | 'system';
    language: string;
  };
  voice: {
    engine: 'tts' | 'realtime';
    voiceId?: string;
    /** Preferred microphone input device id (empty/undefined = system default). */
    inputDeviceId?: string;
    rate: number;
    vad: number;
    autoSend: boolean;
    captions: boolean;
  };
  data: { sync: boolean; temporaryDefault: boolean; retention: 'forever' | '30d' | '90d' };
  tools?: {
    agenticMode: boolean;
    webSearch: boolean;
    codeInterpreter: boolean;
    fileSearch: boolean;
    imageAgent: boolean;
  };
}

export interface MemoryItem {
  id: Id;
  text: string;
  source: string;
  createdAt: string;
}

export type AiErrorCode =
  | 'offline'
  | 'unauthorized'
  | 'forbidden'
  | 'deployment_not_found'
  | 'rate_limited'
  | 'content_filtered'
  | 'bad_request'
  | 'server_error'
  | 'timeout'
  | 'aborted'
  | 'unsupported_capability'
  | 'tool_unsupported'
  | 'tool_unauthorized'
  | 'web_search_disabled'
  | 'file_search_unavailable'
  | 'budget_exceeded';

export interface AiError {
  code: AiErrorCode;
  message: string;
  detail?: string;
  capability?: 'chat' | 'transcribe' | 'image' | 'tts';
  retryAfterMs?: number;
}

export interface CapabilityMatrix {
  chat: boolean;
  chatStreaming: boolean;
  vision: boolean;
  transcribe: boolean;
  transcribeStreaming: boolean;
  image: boolean;
  imageEdit: boolean;
  tts: boolean;
  responses: boolean;
  functions: boolean;
  codeInterpreter: boolean;
  webSearch: boolean;
  fileSearch: boolean;
}

export interface Toast {
  id: Id;
  message: string;
  kind?: 'info' | 'success' | 'error';
  persistent?: boolean;
  key?: string;
}

export const DEFAULT_SETTINGS: Settings = {
  personalization: {
    memoryEnabled: true,
    memory: { enabled: true, paused: false, referenceSaved: true, referenceHistory: true, autoExtract: true },
  },
  appearance: {
    theme: 'system',
    textScale: 1.0,
    density: 'comfortable',
    reduceMotion: 'system',
    language: 'en',
  },
  voice: { engine: 'tts', rate: 1, vad: 0.5, autoSend: true, captions: true },
  data: { sync: true, temporaryDefault: false, retention: 'forever' },
  tools: {
    agenticMode: true,
    webSearch: false,
    codeInterpreter: true,
    fileSearch: false,
    imageAgent: true,
  },
};

export function effectiveMemorySettings(settings: Settings): MemorySettings {
  return settings.personalization.memory ?? {
    enabled: settings.personalization.memoryEnabled,
    paused: false,
    referenceSaved: settings.personalization.memoryEnabled,
    referenceHistory: settings.personalization.memoryEnabled,
    autoExtract: settings.personalization.memoryEnabled,
  };
}

// ---------------------------------------------------------------------------
// Agent Skills (canonical SKILL.md folders the assistant loads on demand).
// `default` skills ship with the app and can be toggled off; `user` skills are
// uploaded as zips and fully user-managed. See documentation/skills-system-spec.md.
// ---------------------------------------------------------------------------
export type SkillSource = 'default' | 'user';
export type SkillStatus = 'ready' | 'invalid';

/** Catalog row for the Skills settings list. */
export interface SkillSummary {
  id: Id;
  /** Frontmatter `name` (== the skill folder). */
  name: string;
  /** Frontmatter `description` (what it does + when to use it). */
  description: string;
  source: SkillSource;
  version: number;
  enabled: boolean;
  status: SkillStatus;
  /** First validation problem when `status === 'invalid'`. */
  error?: string;
  /** Uploaded zip size (user skills). */
  bytes?: number;
  fileCount?: number;
}

/** One bundled file inside a skill (for the detail file tree). */
export interface SkillFileEntry {
  /** Relative path from the skill root, e.g. `references/REFERENCE.md`. */
  path: string;
  bytes: number;
}

/** Full skill detail for the preview dialog. */
export interface SkillDetail extends SkillSummary {
  license?: string;
  files: SkillFileEntry[];
  /** The SKILL.md markdown body (instructions), for read-only preview. */
  body: string;
}

/** A single upload-validation failure (server-authoritative), surfaced in the UI. */
export interface SkillValidationError {
  /** Short rule id, e.g. `name`, `description`, `skill-md`, `path`, `size`. */
  rule: string;
  /** Human-readable explanation of what's wrong and how to fix it. */
  message: string;
}

