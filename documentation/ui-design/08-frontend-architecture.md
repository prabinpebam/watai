# 08 — Frontend Architecture

The build-ready engineering contract for the Watai frontend: folder structure, routing,
state shape, TypeScript types for all data, the AI client contracts (aligned to the real
`/openai/v1` API in [../03-api-integration.md](../03-api-integration.md)), and the
**mock/local data layer** that lets the whole UI run with no backend. This is what makes
the frontend-first inspection possible.

Stack: **React + TypeScript (strict) + Vite**, installable PWA. Tokens/components per the
other UI-design docs.

---

## 1. Folder structure

```
src/
  app/
    App.tsx                 # providers + router outlet
    routes.tsx              # route table (§2)
    providers/              # theme, i18n, store, query, error-boundary
    AppFrame.tsx            # global frame (app bar + sidebar/drawer + composer slot)
  design/
    tokens.css              # :root + [data-theme=dark] (from 01-design-tokens.md)
    tokens.ts               # typed token object (generated)
    primitives/             # Button, IconButton, TextField, Switch, ... (02 §A)
    overlays/               # Drawer, Modal, BottomSheet, ActionSheet, Menu, Toast (02 §C)
    icons/                  # SVG icon modules + <Icon id=.../> (07 §13)
    ThemeProvider.tsx
  features/
    chat/                   # MessageList, MessageGroup, User/AssistantMessage,
                            #   Markdown, CodeBlock, MathBlock, TableBlock, Composer,
                            #   ModelSelector, message actions, streaming controller
    history/                # Drawer/Sidebar, ConversationRow, Search
    voice/                  # Dictation, VoiceMode, VoiceOrb, Waveform, voice machine
    images/                 # ImageCard, ImageViewer, Gallery
    onboarding/             # Splash, Welcome, Auth, KeyWizard, MicPriming
    settings/               # Hub + Account/Models/Personalization/Voice/Data/Appearance/About
  ai/
    http.ts                 # shared fetch layer: auth header, timeout, abort, retry, SSE
    chatClient.ts           # gpt-5.4 (chat/completions + responses)
    transcribeClient.ts     # gpt-4o-transcribe
    imageClient.ts          # gpt-image-2
    ttsClient.ts            # voice output (pending D4)
    capabilities.ts         # probe + capability matrix
    errors.ts               # normalize to AiError taxonomy (03 §6)
    types.ts                # request/response/stream types
  data/
    repository.ts           # Repository interface (§5)
    local/                  # IndexedDB adapter (Dexie or idb) — default in frontend-first
    remote/                 # Azure adapter (later) — same interface, no-op for now
    sync/                   # sync engine interface (no-ops against local for now)
    search/                 # client full-text index
    secureStore.ts          # BYO key/config storage (+ optional Web Crypto, O5)
  state/
    store.ts                # global UI store (Zustand) shape (§3)
    selectors.ts
  lib/
    i18n.ts                 # string table loader (07) + interpolation/plural
    markdown.ts             # sanitize + render config
    audio.ts                # MediaRecorder, VAD, analyser
    crypto.ts               # AES-GCM wrap/unwrap (O5)
    telemetry.ts            # privacy-preserving events (no content/keys)
    ids.ts                  # ULID/UUID
    format.ts               # dates, sizes, recency grouping
  mocks/
    seed.ts                 # demo threads/messages/images (§6)
    mockRepository.ts       # in-memory Repository for demo mode
    devMenu.tsx             # dev-only toggles (mock mode, theme, states)
  workers/
    sw.ts                   # service worker (app shell cache)
  main.tsx                  # bootstrap
public/
  manifest.webmanifest      # PWA manifest (icons from 07 §14)
  icons/                    # PWA icons
index.html
```

Principles: features own their components/state/hooks; cross-feature primitives live in
`design/`; **no component imports another feature's internals**; data access only through
`data/repository.ts`; AI access only through `ai/`.

---

## 2. Routing

Hash routing by default (GitHub Pages-safe; see [../02-architecture.md](../02-architecture.md)
§4); a `basename` is applied if hosted on a subpath.

| Route | View | Notes |
| --- | --- | --- |
| `/` | redirect → latest thread or `/new` | |
| `/new` | Chat empty (V-06) | |
| `/c/:threadId` | Chat active (V-07) | deep-linkable; restores scroll |
| `/voice/:threadId?` | Voice mode (V-15) | overlay route |
| `/search` | Search (V-12) | overlay route (compact) |
| `/settings` | Settings hub (V-19) | |
| `/settings/:section` | Settings subpage (V-20–26) | `models`, `account`, … |
| `/onboarding/*` | Splash/Welcome/Auth/Key/Mic | guarded by session+key state |
| `*` | Not-found → `/` | |

Route guards: no session → `/onboarding/welcome`; session but no valid chat config →
`/onboarding/key`; otherwise app. Overlay routes (voice/search/settings on compact) render
above the chat without unmounting it.

---

## 3. Global state shape

Two tiers: **server-cache** (threads/messages via React Query against the Repository) and
**UI store** (Zustand) for ephemeral/app state.

```ts
interface UiStore {
  theme: 'system' | 'light' | 'dark';
  textScale: 0.9 | 1.0 | 1.1 | 1.25;
  density: 'comfortable' | 'compact';
  reduceMotion: boolean | 'system';

  drawerOpen: boolean;              // compact overlay
  sidebarCollapsed: boolean;        // expanded
  activeThreadId: string | null;
  activeModelByThread: Record<string, string>;
  composerDrafts: Record<string, string>;
  temporaryChat: boolean;

  stream: {
    status: 'idle' | 'pending' | 'streaming' | 'stopped' | 'error';
    threadId?: string;
    messageId?: string;
    abort?: () => void;
  };

  voice: VoiceMachineState;         // see §7 voice
  capability: CapabilityMatrix;     // from ai/capabilities
  connectivity: 'online' | 'offline';
  toasts: Toast[];
  modal: ModalDescriptor | null;    // dialog/sheet stack top
}
```

UI store is persisted (theme, scales, drafts, collapsed) to localStorage; volatile fields
(stream, voice, toasts) are not.

---

## 4. Core domain types

Mirror [../04-data-model.md](../04-data-model.md), trimmed to what the frontend needs.

```ts
type Id = string; // ULID

interface Thread {
  id: Id;
  title: string;
  pinned: boolean;
  archived: boolean;
  temporary: boolean;
  model?: string;                 // active chat model for this thread
  createdAt: string;              // ISO
  updatedAt: string;
  deletedAt?: string | null;
  messageCount: number;
  lastMessagePreview?: string;
}

type Role = 'user' | 'assistant' | 'system';
type MessageStatus = 'sending' | 'complete' | 'streaming' | 'interrupted' | 'error';

interface Message {
  id: Id;
  threadId: Id;
  role: Role;
  content: string;                // markdown for assistant; text for user
  model?: string;
  parentId?: Id | null;           // branch point (edit & resend)
  status: MessageStatus;
  attachments?: Attachment[];
  images?: ImageRef[];
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: AiError;
  createdAt: string;
}

interface Attachment {
  id: Id; kind: 'image' | 'audio' | 'file';
  localBlobKey?: string;          // IndexedDB blob key (frontend-first)
  blobPath?: string;              // Azure path (later)
  mime: string; bytes: number; name?: string;
  width?: number; height?: number;
}

interface ImageRef {
  id: Id; localBlobKey?: string; blobPath?: string;
  prompt: string; size: string; outputFormat: 'png'|'jpeg'|'webp';
  createdAt: string;
}

interface ApiConfig {                 // client-only; key stored separately/encrypted
  baseUrl: string;                    // .../openai/v1 — user-provided, never hardcoded
  models: { chat: string; transcribe: string; image: string; tts?: string };
  chatDefaults: {
    reasoningEffort?: 'minimal'|'low'|'medium'|'high';
    maxCompletionTokens?: number;
    systemPrompt?: string;
  };
  keyEncrypted: boolean;
}

interface Settings {
  personalization: { aboutYou?: string; howRespond?: string; memoryEnabled: boolean };
  appearance: { theme: UiStore['theme']; textScale: UiStore['textScale'];
                density: UiStore['density']; reduceMotion: UiStore['reduceMotion'];
                language: string };
  voice: { engine: 'tts'|'realtime'; voiceId?: string; rate: number;
           vad: number; autoSend: boolean; captions: boolean };
  data: { sync: boolean; temporaryDefault: boolean;
          retention: 'forever'|'30d'|'90d' };
}

interface MemoryItem { id: Id; text: string; source: string; createdAt: string }
```

---

## 5. Data layer — Repository interface (the swap seam)

All persistence goes through one interface. Frontend-first uses the **IndexedDB adapter**;
the **Azure adapter** implements the same interface later with zero UI changes
([../02-architecture.md](../02-architecture.md) §5).

```ts
interface Repository {
  // threads
  listThreads(opts?: { includeArchived?: boolean }): Promise<Thread[]>;
  getThread(id: Id): Promise<Thread | null>;
  createThread(init?: Partial<Thread>): Promise<Thread>;
  updateThread(id: Id, patch: Partial<Thread>): Promise<Thread>;
  deleteThread(id: Id): Promise<void>;            // soft; purged after grace

  // messages
  listMessages(threadId: Id): Promise<Message[]>;
  appendMessage(m: Message): Promise<Message>;
  updateMessage(id: Id, patch: Partial<Message>): Promise<Message>;
  deleteMessage(id: Id): Promise<void>;

  // assets (blobs live in IndexedDB now, Blob Storage later)
  putBlob(key: string, blob: Blob): Promise<void>;
  getBlobUrl(key: string): Promise<string>;       // object URL (revoke on unmount)

  // settings / memory
  getSettings(): Promise<Settings>;
  saveSettings(s: Settings): Promise<void>;
  listMemory(): Promise<MemoryItem[]>;
  addMemory(m: MemoryItem): Promise<void>;
  removeMemory(id: Id): Promise<void>;

  // search (client index)
  search(query: string): Promise<Array<{ thread: Thread; messageId: Id; snippet: string }>>;

  // lifecycle
  exportAll(): Promise<Blob>;                      // zip/json
  deleteAll(): Promise<void>;
}
```

- **Secure store** (separate from Repository): `secureStore.ts` holds `ApiConfig` + the raw
  key in IndexedDB, optionally AES-GCM-wrapped behind a passphrase (O5). The key is never
  placed in the Repository, exports, logs, or telemetry.
- **Sync engine** (`data/sync`) is defined as an interface now and **no-ops** against the
  local adapter; the Azure adapter wires real optimistic sync later
  ([../04-data-model.md](../04-data-model.md) §5).

---

## 6. Mock / demo data mode

So the frontend can be inspected **without** a key or any AI calls:

- A **dev menu** (`mocks/devMenu.tsx`, dev builds only) toggles:
  - **Mock data**: load `mocks/seed.ts` into an in-memory `mockRepository` (populated
    threads grouped across recency buckets, messages with markdown/code/math/tables,
    generated-image cards, pinned/archived examples, long thread for virtualization).
  - **Mock AI**: a fake stream that emits a canned markdown response token-by-token (so
    streaming/typing/stop are demoable offline), a fake transcription, and placeholder
    images — selectable so reviewers see every state without spending tokens.
  - **Force state**: jump any surface to `loading` / `empty` / `error` / `offline` /
    `rate_limited` to inspect all states deterministically.
- Mock mode is gated out of production builds (tree-shaken via an env flag).

This directly serves the manual inspection checklist in
[README.md](README.md) §7 — a reviewer can walk every screen and state with or without a
real key.

---

## 7. AI client contracts (real `/openai/v1`)

Shared HTTP layer + four capability clients. All read `ApiConfig` lazily and send
`Authorization: Bearer <key>` with the **model in the body** (no `api-version`, no path
deployment), per [../03-api-integration.md](../03-api-integration.md).

```ts
// ai/http.ts
interface AiRequest {
  path: '/chat/completions' | '/responses' | '/audio/transcriptions'
      | '/audio/speech' | '/images/generations' | '/images/edits';
  body?: unknown;            // JSON
  form?: FormData;           // multipart (audio/image)
  stream?: boolean;
  signal?: AbortSignal;
  timeoutMs?: number;
}
// adds Authorization, Content-Type; handles timeout/abort/retry(429,5xx,network);
// parses SSE when stream; normalizes failures via errors.ts → AiError.

// ai/chatClient.ts
interface ChatParams {
  messages: ChatMessage[];                 // system/user/assistant; user may be parts[]
  model: string;                           // config.models.chat
  reasoningEffort?: 'minimal'|'low'|'medium'|'high';
  maxCompletionTokens?: number;
  signal?: AbortSignal;
}
interface ChatStreamEvent {
  type: 'delta' | 'done' | 'error';
  textDelta?: string;
  finishReason?: 'stop'|'length'|'content_filter'|'tool_calls';
  usage?: { promptTokens?: number; completionTokens?: number };
  error?: AiError;
}
function streamChat(p: ChatParams): AsyncIterable<ChatStreamEvent>;
// POST <baseUrl>/chat/completions { model, messages, max_completion_tokens,
//   reasoning_effort, stream:true }  → SSE deltas

// ai/transcribeClient.ts
interface TranscribeParams { file: Blob; language?: string; prompt?: string; signal?: AbortSignal }
function transcribe(p: TranscribeParams): Promise<{ text: string }>;
// POST <baseUrl>/audio/transcriptions (multipart: model, file, response_format=json, …)

// ai/imageClient.ts
interface ImageParams {
  prompt: string; size?: string; n?: number;
  outputFormat?: 'png'|'jpeg'|'webp'; outputCompression?: number; signal?: AbortSignal;
}
function generateImage(p: ImageParams): Promise<Array<{ b64: string }>>;
// POST <baseUrl>/images/generations { model, prompt, size, n, output_format,
//   output_compression } → data[].b64_json
function editImage(src: Blob, prompt: string, mask?: Blob): Promise<Array<{ b64: string }>>;

// ai/ttsClient.ts (pending D4)
interface TtsParams { input: string; voice?: string; signal?: AbortSignal }
function synthesize(p: TtsParams): Promise<Blob>; // POST <baseUrl>/audio/speech → mp3

// ai/errors.ts
type AiErrorCode = 'offline'|'unauthorized'|'forbidden'|'deployment_not_found'
  |'rate_limited'|'content_filtered'|'bad_request'|'server_error'|'timeout'
  |'aborted'|'unsupported_capability';
interface AiError { code: AiErrorCode; message: string; detail?: string;
  capability?: 'chat'|'transcribe'|'image'|'tts'; retryAfterMs?: number }

// ai/capabilities.ts
interface CapabilityMatrix {
  chat: boolean; chatStreaming: boolean; vision: boolean;
  transcribe: boolean; transcribeStreaming: boolean;
  image: boolean; imageEdit: boolean; tts: boolean;
}
function probe(config: ApiConfig): Promise<CapabilityMatrix>;
```

The voice state machine (`features/voice`) composes these:

```ts
type VoiceMachineState =
  | { tag: 'idle' }
  | { tag: 'connecting' }
  | { tag: 'listening'; interim: string }
  | { tag: 'thinking' }
  | { tag: 'speaking'; text: string }
  | { tag: 'muted' }
  | { tag: 'error'; error: AiError }
  | { tag: 'ended' };
// listening → transcribe → thinking → streamChat → speaking(synthesize) → listening
```

---

## 8. Streaming controller (chat)

- One in-flight stream at a time; `streamChat` iterated in a controller that appends
  `textDelta` to the active assistant `Message`, updates `UiStore.stream`, and exposes
  `abort()` to the composer Stop button.
- Markdown re-render is incremental and memoized per message to avoid reflow during
  streaming; the caret is a CSS pseudo-element, not part of the text buffer.
- On `done`, persist the final message + usage via `Repository.appendMessage/updateMessage`;
  request a title for first exchange.

---

## 9. Theming, i18n, PWA

- **Theming:** `ThemeProvider` sets `data-theme` on `<html>` from `Settings.appearance`;
  `system` subscribes to `prefers-color-scheme`. Text scale sets root font-size; density
  toggles a spacing class.
- **i18n:** `lib/i18n` loads the string table ([07-content-and-assets.md](07-content-and-assets.md));
  `t('key', {vars})`; RTL sets `dir` and mirrors layout.
- **PWA:** `manifest.webmanifest` (name, icons from [07](07-content-and-assets.md) §14,
  `display: standalone`, theme/background colors from tokens); service worker caches the
  app shell + visited threads for offline reading; AI features gated offline.

---

## 10. Config & environments

- **Build-time public config** via Vite env (`VITE_*`): base path, feature flags
  (`VITE_ENABLE_MOCKS`, `VITE_ENABLE_REALTIME`), telemetry sink. **No secrets** ship to
  the client.
- **Runtime user config**: `ApiConfig` + key from `secureStore` (entered in the wizard).
- **Proxy seam**: `AiClientConfig.baseUrlOverride` allows pointing the AI layer at a
  pass-through proxy later ([../02-architecture.md](../02-architecture.md) §3) without
  touching features.

---

## 11. Quality gates (frontend)

- TypeScript strict; ESLint + Prettier; no `any` in `ai/` and `data/`.
- Unit (Vitest): SSE parser, error normalization, recency grouping, secure-store
  wrap/unwrap, search index.
- Component (Testing Library): every component's states render in light + dark.
- E2E (Playwright) with **mock AI + mock data**: onboarding → key wizard (mocked probes) →
  chat streaming → history/search → voice (mocked) → image (mocked) → settings.
- a11y (axe) + Lighthouse budgets per [../README.md](../README.md) §6.
- Visual regression snapshots across themes/breakpoints.

---

## 12. Architecture acceptance criteria

1. The entire UI runs from `mockRepository` + mock AI with **no key and no backend**, and
   every screen/state is reachable via the dev menu.
2. Entering a real `ApiConfig` makes chat, transcription, and image generation work
   **directly** against `/openai/v1` with Bearer auth and model-in-body.
3. Swapping the local Repository for a (stub) remote one requires **no** change in any
   `features/*` component.
4. The BYO key never appears in Repository data, exports, logs, or telemetry.
5. Routing is GitHub Pages-safe (deep links + refresh work); overlay routes preserve the
   chat beneath.
6. Strict types, lint, and the test gates pass in CI.

When these and the per-screen acceptance criteria pass — and the manual inspection
checklist in [README.md](README.md) §7 is green — the frontend is approved and backend
work begins ([../05-execution-plan.md](../05-execution-plan.md) Phase 2).
