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
}

/** Transient placeholder for an image being generated. Render-only — never persisted or synced. */
export interface PendingImage {
  id: Id;
  /** Requested image size as `WxH` (e.g. `1024x1536`), used to size the placeholder. */
  size: string;
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
}

export interface ApiConfig {
  baseUrl: string;
  models: { chat: string; transcribe: string; image: string; tts?: string };
  chatDefaults: {
    reasoningEffort?: 'minimal' | 'low' | 'high' | 'medium';
    maxCompletionTokens?: number;
    systemPrompt?: string;
  };
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
  | 'unsupported_capability';

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
  data: { sync: false, temporaryDefault: false, retention: 'forever' },
};
