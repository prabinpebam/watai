# 06 — Data Model & Frontend Changes

The concrete code-level changes in `src/` (and the persistence-plane touch points) needed to
implement the specs in this folder. This is the bridge from design to implementation; it names
real files and types from the current codebase.

Cross-references: [02-architecture-and-adoption.md](02-architecture-and-adoption.md) (the
orchestrator & paths), feature specs [03](03-agentic-chat-and-tools.md)–[05](05-agentic-image-generation.md),
and the base data model [../04-data-model.md](../04-data-model.md).

---

## 1. New & changed modules (`src/ai/`)

The existing AI clients stay; we add an agentic layer beside them and reuse the shared HTTP
plumbing in [../../src/ai/http.ts](../../src/ai/http.ts).

```
src/ai/
  http.ts            # REUSE aiFetch/parseSse/loadConfig; extend AiPath events (see §1.1)
  chat.ts            # KEEP (classic fallback)
  image.ts           # KEEP (plain Image API fallback for Stage 2)
  capabilities.ts    # EXTEND: agentic probes + CapabilityMatrix fields (§4)
  errors.ts          # EXTEND: tool error codes (§5)
  responses.ts       # NEW: typed Responses API client (create + stream events)
  orchestrator.ts    # NEW: the tool-calling loop (the core of 02 §4)
  tools/
    registry.ts      # NEW: client-side function tool allow-list (03 §5)
    history.ts       # NEW: searchWataiHistory, getThreadSummary (repo-backed)
    threads.ts       # NEW: createThread/deleteThread(confirm)/exportThread
    memory.ts        # NEW: addMemory, updateSetting(confirm)
  research.ts        # NEW: deep-research task runner (04)
  imageAgent.ts      # NEW: Stage-1 prompt expansion + Stage-2 image_generation (05)
```

### 1.1 Responses client (`responses.ts`)

A thin client mirroring `chat.ts` but for `/responses`:

```ts
export interface ResponsesParams {
  model: string;
  input: ResponseInputItem[] | string;
  tools?: ToolDef[];
  toolChoice?: 'auto' | 'required' | { type: string; name?: string };
  conversationId?: string;
  previousResponseId?: string;
  extraHeaders?: Record<string, string>; // e.g. x-ms-oai-image-generation-deployment
  signal?: AbortSignal;
}

export type ResponsesEvent =
  | { type: 'text.delta'; textDelta: string }
  | { type: 'item.done'; item: ResponseOutputItem } // message | *_call | function_call
  | { type: 'completed'; responseId: string; outputText: string; usage?: Usage }
  | { type: 'error'; error: AiError };

export async function* streamResponses(p: ResponsesParams): AsyncGenerator<ResponsesEvent>;
export async function createResponse(p: ResponsesParams): Promise<ResponseResult>;
```

It reuses `aiFetch({ path: '/responses', ... })` and a Responses-aware variant of `parseSse`
that maps SSE event names (`response.output_text.delta`, `response.output_item.done`,
`response.completed`, `response.error`) onto `ResponsesEvent`.

### 1.2 Orchestrator (`orchestrator.ts`)

Implements the loop from [02](02-architecture-and-adoption.md) §4: build request → stream →
demux events → execute client-side `function_call`s via `tools/registry` (with destructive
confirmation) → continue with tool output → enforce budgets → yield a normalized stream the UI
renders. Returns the same kind of event stream `useChat` already consumes, plus tool/citation
events.

---

## 2. Type changes (`src/lib/types.ts`)

Extend existing types; do **not** break the current shapes (additive, optional fields).

### 2.1 `Message`

```ts
export interface ToolCall {
  id: Id;
  kind: 'web_search' | 'code_interpreter' | 'image_generation' | 'function' | 'mcp';
  name?: string;               // function/mcp name
  status: 'running' | 'done' | 'error';
  summary?: string;            // one-line ("Searched the web · 5 sources")
  argsPreview?: string;        // bounded, no secrets
  resultPreview?: string;      // bounded
  error?: AiError;
}

export interface Citation {
  url: string;
  title?: string;
  startIndex?: number;
  endIndex?: number;
  bingQueryUrl?: string;       // display obligation
}

export interface Message {
  // …existing fields…
  toolCalls?: ToolCall[];      // NEW
  citations?: Citation[];      // NEW
  researchId?: Id | null;      // NEW: links to a ResearchTask (04)
}
```

### 2.2 `ImageRef` (provenance for agentic images, [05](05-agentic-image-generation.md) §5)

```ts
export interface ImageRef {
  // …existing: id, localBlobKey, blobPath, prompt, size, outputFormat, createdAt…
  expandedPrompt?: string;     // NEW: Stage-1 engineered prompt
  intent?: string;             // NEW
  params?: { quality?: string; background?: string };  // NEW
  sourceMessageIds?: Id[];     // NEW
  editOf?: Id | null;          // NEW: edit/inpaint lineage
  model?: string;              // NEW
}
```

### 2.3 `ResearchTask` (new entity, [04](04-deep-research.md) §4)

Add the `ResearchTask` interface (status, steps, sources, report, usage). Stored locally and
synced as a thread artifact.

### 2.4 `ApiConfig` & `Settings`

`ApiConfig` gains `endpointKind`, `projectEndpoint`, extra `models` (`orchestrator`, `image`
as `gpt-image-1`, `deepResearch`), a `tools` block, `bingConnectionId`, and `consent`
([02](02-architecture-and-adoption.md) §5). `Settings` gains a **Tools** section:

```ts
// Settings (new section)
tools: {
  agenticMode: boolean;        // master toggle (default true when supported)
  webSearch: boolean;
  codeInterpreter: boolean;
  imageAgent: boolean;
  deepResearch: boolean;
  mcpServers: { label: string; url: string }[];  // headers kept in secureStore
  consentWebDataBoundary: boolean; // A8 gate
};
```

### 2.5 `CapabilityMatrix`

```ts
export interface CapabilityMatrix {
  // …existing: chat, chatStreaming, vision, transcribe, image, imageEdit, tts…
  responses: boolean;          // NEW: /responses available
  webSearch: boolean;          // NEW
  codeInterpreter: boolean;    // NEW
  imageTool: boolean;          // NEW: image_generation tool
  deepResearch: boolean;       // NEW
  functions: boolean;          // NEW
  mcp: boolean;                // NEW
}
```

---

## 3. State & data (`src/state`, `src/data`)

- **Zustand `useUi`** ([../../src/state/store.ts](../../src/state/store.ts)) gains transient
  agent state: current run id, per-message tool-call progress, research progress, and an
  `agentBudget` snapshot. Persistent data still lives behind `repo` (UI holds no thread data,
  per existing convention).
- **`Repository`** ([../../src/data/repository.ts](../../src/data/repository.ts)) gains
  research persistence and is the backing for client-side tools:
  ```ts
  // additions to Repository
  listResearch(threadId: Id): Promise<ResearchTask[]>;
  saveResearch(t: ResearchTask): Promise<void>;
  ```
  `search`, `listThreads`, `createThread`, `deleteThread`, `addMemory`, `saveSettings`
  already exist and are wrapped by the function-tool registry — **no new persistence-API
  surface is required for Path C** beyond research storage.
- **`secureStore`** holds MCP/tool secrets (headers, project keys) next to the AI key; never
  synced, never sent to the Watai backend.

---

## 4. Capability detection (`src/ai/capabilities.ts`)

Add `probeAgentic(config)` that runs once on config save and caches into the extended
`CapabilityMatrix`:

1. `responses`: POST `/responses` with a trivial `input`, expect a `response` object (else
   false → classic chat only).
2. `webSearch`: POST with `tools:[{type:'web_search'}]`, `tool_choice:'auto'`, tiny input;
   `200` → true, `400 tool not supported` / `disabled` → false.
3. `imageTool`: POST with `tools:[{type:'image_generation'}]` + the image header; classify
   like above (cheap probe with `quality:'low'`, immediately aborted if possible).
4. `deepResearch`: true only if `endpointKind==='foundry-project'` **and** a `deepResearch`
   deployment is configured (don't spend a real run to detect).
5. `functions`/`codeInterpreter`: inferred from `responses` (functions) and a cheap probe
   (code interpreter), respectively.

`endpointKind` is derived from the URL (`/api/projects/` ⇒ `foundry-project`) and confirmed by
the probes. The UI reads the matrix to **gate** chips, the `/research` route, and the image
agent, with explanatory tooltips when a capability is off.

---

## 5. Errors (`src/ai/errors.ts`)

Extend `AiErrorCode` and the HTTP/normalization map:

```ts
// new codes
| 'tool_unsupported'
| 'tool_unauthorized'
| 'web_search_disabled'
| 'budget_exceeded'
| 'research_unavailable'
| 'image_tool_unavailable'
```

Each maps to a clear, non-leaking message and (where relevant) a Settings deep-link, matching
the existing taxonomy and the toast pattern in `useChat`/`ImagesView`.

---

## 6. UI components (`src/features`, `src/design`)

- `src/features/chat/` — extend `Message.tsx` to render **tool cards** + **citations**; extend
  `Composer.tsx` with a **Tools** menu (web search / code / image / MCP) gated by capabilities;
  extend `useChat.ts` to call the **orchestrator** when agentic mode is on (else current path).
- `src/features/research/` — **new**: `ResearchView.tsx` (clarify → progress → report) on a
  `/research` route added in [../../src/app/AppShell.tsx](../../src/app/AppShell.tsx) nav.
- `src/features/images/` — upgrade `ImagesView.tsx` to run Stage-1 expansion + show the
  engineered prompt; add **edit/inpaint** affordances to the viewer/`Lightbox.tsx`.
- `src/design/` — small additions: tool-card, citation chip, step-ticker, and an inpaint mask
  brush; all using `tokens.css`/`components.css`. Icons via `icons.tsx` (Fluent, no emoji).
- `src/features/settings/Settings.tsx` — new **Tools** section (toggles, MCP servers, consent,
  extra deployment names, endpoint kind display + "Detect capabilities").

---

## 7. Persistence-plane impact (`api/`)

Minimal and additive — the backend **still never sees the AI key**:

- **Messages:** `toolCalls`, `citations`, `researchId` are stored as part of the message
  document (extend the message zod validator in `api/src/domain/message.ts` to allow the new
  optional fields). Raw tool payloads are **not** stored — only bounded previews + citations.
- **Research artifacts:** either stored on the thread or as a new lightweight `research`
  container (mirrors the existing Cosmos container pattern; PK `/threadId`). A new
  `ResearchService` + `ResearchStore` port/adapter following the existing clean-architecture
  layout (`domain` → `application` → `ports` → `adapters/cosmos`). Optional for v1 if research
  is kept local-only initially.
- **Assets:** generated images continue through the existing SAS-minted blob path; only the
  `ImageRef` provenance fields are new (string/array fields on the asset/message document).
- **No new secrets** in the backend; MCP/tool credentials live in the browser `secureStore`.

Follow the repo's **strict TDD** for any backend additions (HANDOFF §11): test first, minimal
on-scope code.

---

## 8. Testing

- **Frontend (vitest + jsdom):** unit-test `responses.ts` event mapping, `orchestrator.ts`
  loop (with a fake Responses stream + fake tool registry, mirroring `mockAi.ts`), the
  function-tool registry (incl. destructive-confirm), capability probes (mocked fetch), and
  citation parsing. Add an agentic path to `mockAi.ts` so the dev menu (`DevMenu.tsx`) can run
  agentic flows offline.
- **Backend (vitest, TDD):** validator changes for new message fields; `ResearchService`/store
  if added (offline + Cosmos integration like the existing adapters).
- **Manual/e2e:** the acceptance criteria at the end of [03](03-agentic-chat-and-tools.md)–[05](05-agentic-image-generation.md).

---

## 9. Backward-compatibility checklist

- All new `Message`/`ImageRef`/`Settings`/`ApiConfig` fields are **optional** → old local data
  loads unchanged.
- With `responses:false`, `useChat` uses the **existing** `/chat/completions` path verbatim.
- With tools off, the composer shows no Tools menu and behaves exactly as today.
- `mockAi` mode keeps working for offline UI development.
