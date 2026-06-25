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
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  messageCount: number;
  lastMessagePreview?: string;
}

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'sending' | 'complete' | 'streaming' | 'interrupted' | 'error';

export interface Attachment {
  id: Id;
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
}

/** Transient placeholder for an image being generated. Render-only — never persisted or synced. */
export interface PendingImage {
  id: Id;
  /** Requested image size as `WxH` (e.g. `1024x1536`), used to size the placeholder. */
  size: string;
}

/** Kind of tool activity recorded on an assistant message. */
export type ToolKind = 'function' | 'web_search' | 'code_interpreter' | 'file_search' | 'image';

/** A bounded, secret-free record of one tool invocation (for the transcript). */
export interface ToolCall {
  id: Id;
  kind: ToolKind;
  name?: string;
  status: 'running' | 'awaiting-confirm' | 'done' | 'error';
  summary?: string;
  argsPreview?: string;
  resultPreview?: string;
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
  };
  consent?: { webSearchDataBoundary?: boolean };
  keyEncrypted: boolean;
}

export interface Settings {
  personalization: { aboutYou?: string; howRespond?: string; memoryEnabled: boolean };
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
}

export const DEFAULT_SETTINGS: Settings = {
  personalization: { memoryEnabled: true },
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
