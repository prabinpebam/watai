# 02 — Watai Memory Spec

This document specifies the product behavior, architecture, data model, retrieval path, extraction path, API surface, UI, and privacy rules for the Watai memory system.

Cross-references: [../02-architecture.md](../02-architecture.md), [../04-data-model.md](../04-data-model.md), [../06-server-runs-and-migration.md](../06-server-runs-and-migration.md), [01-research-and-benchmarks.md](01-research-and-benchmarks.md).

> **POLICY UPDATE (2026-07-01) — Project/work context is NOT stored in memory.**
> Users intentionally open separate threads to isolate different approaches and avoid cross-thread
> "baggage." Storing project / work-in-progress context (the `project_context` kind) breaks that
> isolation by bleeding one thread's task context into unrelated threads. Therefore, for now:
> - Auto-extraction **never** produces `project_context` (excluded from `autoKinds`).
> - Manual creation of `project_context` is **not offered / rejected** (excluded from `manualMemoryKinds`
>   and the Settings add-memory picker).
> - `project_context` is **never injected** into prompts — `MemoryContextService` filters it out of the
>   candidate set, so neither vector retrieval nor the always-on profile can surface it (including any
>   pre-existing records, which remain stored but dormant and are non-destructively kept).
> - The `project_context` value is retained in `MEMORY_KINDS` only so existing records still validate and
>   display in Settings. It is effectively deprecated for new storage.
> References below to storing "project context" are superseded by this policy.

## 1. Problem Statement

Watai currently has a memory toggle and local `MemoryItem` storage, but the server-run architecture means the browser is no longer the agent. If generation runs on the server, memory retrieval and memory writing must be server-owned too.

The goal is to let Watai build useful continuity across conversations without making every new response read the user's entire chat history. The memory system must balance four forces:

- **Speed:** keep retrieval p95 low enough that send-to-first-token still feels immediate.
- **Quality:** improve answers when memory is relevant, while avoiding constant over-personalization.
- **Accuracy:** use source-linked, time-aware memories; handle corrections and deletions as hard constraints.
- **Width:** cover user preferences, work style, durable facts, project context, and past work without storing secrets or one-off noise.

Therefore memory is a bounded serving layer, not an ever-growing prompt prefix.

## 2. Product Goals

A user should be able to:

1. Ask Watai to remember durable facts and preferences.
2. Let Watai automatically learn useful context from normal conversations when memory is enabled.
3. See what Watai remembers in a Memory page.
4. See which memories influenced a specific answer.
5. Correct, suppress, delete, import, export, pause, reset, and rebuild memory.
6. Use Temporary Chat without reading existing memory or writing new memory.
7. Sign in on another device and get the same memory-backed behavior.
8. Keep response speed predictable even as memory grows.
9. Separate explicit saved memories from chat-history-derived recall.
10. Understand why a memory was used and mark it as wrong, irrelevant, or no longer useful.

## 3. Non-Goals For The First Implementation

- Team/organization shared memory.
- External connectors such as Gmail or calendar memory ingestion.
- Full knowledge graph UI.
- Fine-tuning or model-weight personalization.
- Storing raw full chat history as memory records. Messages already exist as messages.
- Autonomous modification of destructive settings without user intent.
- Unbounded vector search over all user data on every run.
- Memory writes that block normal response streaming.
- Treating the memory summary as the only source of truth.

## 3.1 Design Critique Of The Naive Approach

The tempting implementation is: store chat summaries, embed them, retrieve top K, and prepend them to every prompt. Watai should not do that. It fails in five ways:

1. **Latency drift:** the hot path gets slower as history grows.
2. **Prompt pollution:** irrelevant memories distract the model and reduce answer quality.
3. **Deletion ambiguity:** summaries obscure which source created which personalized fact.
4. **Contradiction blindness:** embeddings do not understand that newer facts invalidate older ones.
5. **User trust gap:** users cannot inspect or correct why a response was personalized.

The right approach is a memory system with typed records, source refs, validity intervals, retrieval budgets, and response-level transparency.

## 4. Memory Types

Watai should treat memory as a layered system:

| Layer | Scope | Lifetime | Source | Use |
| --- | --- | --- | --- | --- |
| Custom instructions | User | Until edited | User-authored Settings | Always eligible when enabled. |
| Memory summary | User | Continuously updated | Synthesis of active memories | Compact review surface and prompt context. |
| Atomic memories | User | Until invalidated/deleted | Manual commands or extraction jobs | Precise facts/preferences with source links. |
| Thread summaries | Thread | Until thread deletion/retention expiry | Background summarization | Episodic recall for past work. |
| Session working memory | Run/thread | Run or task lifetime | Tool outputs/intermediate state | Not long-term; do not store as user memory. |
| Retrieval cache | User/thread | Minutes | Memory context service | Speed up repeated adjacent turns without changing source of truth. |

Memory **width** comes from these layers together, not from one large vector store. The system should be able to retrieve across:

- explicit user instructions,
- durable preferences and facts,
- current project/product context,
- past completed tasks,
- relevant thread summaries,
- temporary working context from the current thread.

Each layer has different retention, consent, ranking, and UI controls.

### 4.2 Structured Memory Direction

Atomic memories are evidence units, not the final user-facing model. Watai should evolve toward the structured architecture in [10-structured-hierarchical-memory.md](10-structured-hierarchical-memory.md): a profile tree for human review, temporal day/week/month buckets for short-term continuity, and typed entity/relationship records for relational facts.

Example: "User has a dog called Chopper inspired by One Piece" should not remain only a flat fact. It should also project into:

- `User > Family > Pets > Chopper`
- entity: `Chopper` of type `pet`
- entity: `One Piece` of type `interest`
- relationship: `User HAS_PET Chopper`
- relationship: `Chopper INSPIRED_BY One Piece`

Flat atomic records remain necessary for source refs, confidence, deletion, and audit. The profile tree and graph are derived views over that evidence.

### 4.3 Abstract Memory Is First-Class

Memory is not only for simple facts like names, locations, or resource groups. Watai should remember abstract context when it reliably improves future work:

- **Preferences:** concise plans, visual verification before claims, no automatic Electron launch, preferred deployment workflow.
- **Styles:** direct engineering prose, low-fluff explanations, design-system strictness, dense operational UI instead of marketing layouts.
- **Work habits:** commit/push/deploy after validated changes, benchmark architecture before optimizing hot paths, and verify UI behavior with browser-driven tests.
- **Project posture:** Watai is server-authoritative, memory must run server-side, GitHub Pages deploys from `docs/`, Azure Functions runs backend workers.
- **Avoidances:** do not mention suppressed topics, do not use deleted memories, do not suggest workflows the user has rejected.

The extractor should store abstract memories only when they are durable, source-linked, and useful. It should not infer personality traits, mood, or private attributes from tone.

## 5. High-Level Architecture

```mermaid
flowchart TD
    Browser[Browser PWA] -->|Settings and memory management API| API[Functions API]
    Browser -->|POST thread run| API
    API --> RunWorker[Server run worker]
    RunWorker --> MemoryContext[Memory context service]
    MemoryContext --> MemoryStore[(Cosmos memory)]
    MemoryContext --> Search[Index / hybrid retrieval]
    RunWorker --> AOAI[Azure OpenAI using user's stored credentials]
    RunWorker --> Messages[(Cosmos messages)]
    RunWorker -->|enqueue after terminal assistant turn| MemoryQueue[Memory extraction queue]
    MemoryQueue --> MemoryExtractor[Memory extractor]
    MemoryExtractor --> MemoryStore
    MemoryExtractor --> Search
    API --> MemoryStore
```

### 5.1 Read Path

1. User sends a prompt.
2. API accepts the server run.
3. Run worker loads settings and checks:
   - memory enabled,
   - thread is not temporary,
   - run request does not opt out of memory.
4. Memory context service builds a bounded `MemoryContextBlock` using:
   - custom instructions,
   - memory summary,
   - top atomic memories,
   - relevant thread summaries,
   - source refs for transparency.
5. Prompt assembly injects the memory context block before the latest conversation messages.
6. The assistant response stores `memoryRefs` so the UI can show sources.

Read-path service-level objective for MVP:

- p95 memory context build <= 250 ms.
- p99 memory context build <= 500 ms.
- default context block <= 1,200 tokens.
- hard max context block <= 2,000 tokens unless a test/runtime override explicitly opts in.
- retrieval must return an empty block on error rather than fail the whole run, but must emit non-content telemetry.

### 5.2 Write Path

1. Assistant message reaches a terminal state: `complete`, `interrupted`, or `error`.
2. If memory is enabled, the thread is not temporary, and enough useful signal exists, the worker enqueues a `memory.extract` job.
3. The extraction worker reads the relevant turn window and existing memory context.
4. It asks the configured model to produce strict JSON memory candidates.
5. The memory service validates, redacts, classifies, deduplicates, and stores additive records.
6. Summary refresh runs when enough memory changed or when the user requests refresh.

Manual commands such as "remember that..." and "forget that..." should take effect immediately through the memory service, but still avoid blocking normal answer generation more than necessary.

### 5.3 Serving Contract

The run worker consumes one object: `MemoryContextBlock`. It should not know how memories are stored, embedded, summarized, or deduplicated. That keeps the hot path testable and gives the memory system freedom to improve retrieval without changing prompt assembly.

Memory context construction has four stages:

1. **Eligibility:** memory enabled, non-temporary thread, user not paused, source data allowed.
2. **Candidate generation:** summary, pinned memories, lexical/entity candidates, thread summaries, optional vector candidates.
3. **Ranking and trimming:** score, diversify by kind/source, enforce budgets and hard exclusions.
4. **Audit artifact:** return selected source refs and telemetry fields for UI and observability.

## 6. Data Model

### 6.1 Cosmos Containers

| Container | Partition key | Purpose |
| --- | --- | --- |
| `memory` | `/userId` | Atomic memories, summaries, source refs, suppression records. |
| `memoryJobs` | `/userId` | Durable extraction job records for idempotency, audit, replay, backpressure, and queue-worker status. |

For the first build, `memory` can hold multiple memory document kinds. Extraction jobs belong in `memoryJobs`, not `memory`, so memory list/query paths never have to filter job records out of normal retrieval.

### 6.2 `MemoryRecord`

```ts
type MemoryKind =
  | 'fact'
  | 'preference'
  | 'instruction'
  | 'work_style'
  | 'project_context'
  | 'thread_summary'
  | 'avoidance'
  | 'entity'
  | 'procedure';

type MemoryStatus = 'active' | 'suppressed' | 'invalidated' | 'deleted';

interface MemoryRecord {
  id: string;
  userId: string;
  kind: MemoryKind;
  status: MemoryStatus;
  text: string;
  normalizedText?: string;
  summary?: string;
  entities?: string[];
  topics?: string[];
  sourceRefs: MemorySourceRef[];
  confidence: number;
  salience: number;
  pinned: boolean;
  sensitive: boolean;
  sourceHash?: string;
  visibility: 'normal' | 'top_of_mind' | 'background';
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
```

Field notes:

- `visibility` supports a review UI similar to "top of mind" vs background memories.
- `sourceHash` helps deduplicate imported/local memories without storing extra source content.
- `procedure` is for user-approved durable behavior rules. It is not model self-modification.
- `entity` is optional for the first release but keeps the schema compatible with graph-like retrieval later.

### 6.3 `MemorySourceRef`

```ts
interface MemorySourceRef {
  type: 'message' | 'thread' | 'manual' | 'import' | 'settings' | 'system';
  threadId?: string;
  messageId?: string;
  runId?: string;
  quote?: string;
  createdAt: string;
}
```

Rules:

- Source refs are required for automatically extracted memories.
- Manual memories may use `type: 'manual'` without a message id.
- Source quotes must be short and bounded.
- If a source message/thread is deleted, memories derived only from that source must be invalidated or deleted according to the user's deletion mode.

### 6.4 `MemorySummaryRecord`

```ts
interface MemorySummaryRecord {
  id: 'memory-summary';
  userId: string;
  kind: 'summary';
  text: string;
  sourceMemoryIds: string[];
  updatedAt: string;
  version: number;
}
```

The memory summary is reviewable and editable, but it is not the only source of truth. The atomic records preserve source traceability and deletion behavior.

### 6.5 `MemoryContextBlock`

```ts
interface MemoryContextBlock {
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
  retrievalMode: 'lexical' | 'hybrid' | 'cached' | 'empty';
}
```

Prompt format:

```text
Relevant memory context. Use this only when it helps answer the user. Do not mention it unless relevant.

User summary:
...

Durable preferences and facts:
- [mem_...] User prefers concise implementation plans.
- [mem_...] User is working on Watai server-authoritative runs. (valid: 2026-06-20 - present)

Relevant prior work:
- [thr_...] Server-run migration moved generation to Azure Functions.
```

## 7. Retrieval Strategy

### 7.1 First Release

For initial Watai scale, the simplest reliable path is:

1. Query active, non-sensitive, non-suppressed user memories from Cosmos with caps.
2. Always consider pinned/top-of-mind memories, but still trim if they are unrelated and the user did not ask for personalization.
3. Score with lexical match, entity overlap, recency, salience, validity, and explicit pinned status.
4. Include the memory summary only when it is relevant or when the query is broad enough that profile context helps.
5. Include up to 8 atomic memories and up to 3 thread summaries.
6. Keep the memory context block under a configurable token budget, default 1,200 tokens.
7. Cache candidate IDs for short adjacent-turn windows, but re-check status/deletion before serving.

This avoids adding Azure AI Search before the product behavior is validated.

### 7.1.1 MVP Scoring

MVP scoring should be deterministic and testable:

```text
score = lexical * 0.30
  + entity * 0.25
  + salience * 0.20
  + recency * 0.10
  + validity * 0.10
  + pinned * 0.05
```

Rules:

- `validity = 0` for invalidated, suppressed, deleted, expired, or temporary-chat-derived records.
- `pinned` can lift a candidate but cannot override deletion/suppression.
- diversify final selection so one noisy topic cannot consume the entire block.
- if the top score is below threshold, return no atomic memories and only custom instructions if enabled.

### 7.2 Hybrid Retrieval Upgrade

After the MVP passes evals, add vector and hybrid search:

- Store embeddings on memory records if the user has configured an embedding deployment.
- Add entity extraction during memory write.
- Fuse scores from semantic similarity, keyword/BM25, entity overlap, salience, recency, and pinning.
- Consider Azure AI Search if memory grows beyond what a single-user Cosmos query can efficiently handle.

The final scoring shape should be explicit and testable:

```text
score = semantic * 0.35
      + lexical * 0.20
      + entity * 0.20
      + salience * 0.15
      + recency * 0.05
      + validity * 0.03
      + pinned * 0.02
```

Weights are defaults, not doctrine. Evals decide.

### 7.3 Memory Width Controls

Memory width is controlled through source budgets, not a single global `topK`:

| Source | Default cap | Purpose |
| --- | ---: | --- |
| Custom instructions | 2 fields | Stable user-authored behavior. |
| Summary | 1 compact block | Broad user/project profile when relevant. |
| Atomic memories | 8 records | Precise facts/preferences. |
| Thread summaries | 3 records | Past work recall. |
| Current thread recency | existing run history budget | Immediate conversation continuity. |

The memory context service should report which cap trimmed candidates. If evals show poor recall, widen the right source rather than increasing all caps.

## 8. Extraction Strategy

### 8.1 Candidate Categories

Extract only durable, useful context:

- stable user preferences,
- recurring work style,
- ongoing project context,
- durable facts the user asks Watai to remember,
- assistant-confirmed actions that matter later,
- corrections to prior memories,
- "do not mention/use" preferences.

Do not extract:

- secrets, API keys, access tokens, credentials,
- hidden chain-of-thought,
- one-off temporary requests,
- medical/legal/financial sensitive details unless the user explicitly asks to remember them and the sensitivity classifier permits it,
- content from temporary chats,
- raw tool outputs unless summarized into a durable fact.

### 8.2 Extraction Prompt Contract

The extractor must output strict JSON:

```jsonc
{
  "memories": [
    {
      "operation": "add" | "suppress" | "invalidate",
      "kind": "fact" | "preference" | "instruction" | "work_style" | "project_context" | "avoidance",
      "text": "User prefers...",
      "entities": ["Watai"],
      "topics": ["architecture"],
      "confidence": 0.0,
      "salience": 0.0,
      "validAt": "2026-06-27T00:00:00.000Z",
      "supersedes": ["mem_..."],
      "sourceMessageIds": ["msg_..."]
    }
  ]
}
```

The service, not the model, owns final validation and storage.

### 8.4 Extraction Quality Gates

The extractor must reject or downgrade candidates when:

- confidence < 0.65 for automatic memories,
- source refs are missing,
- text is not durable beyond the current task,
- the candidate duplicates an active memory without adding new validity or source information,
- the candidate contains secret-like values,
- the candidate is about a third party and not clearly project context.

Manual "remember this" writes can bypass the confidence threshold but not secret/safety validation.

### 8.3 Additive Memory

Prefer adding new records and invalidating older ones over overwriting. Example:

- Old: "User is using client-side generation."
- New: "User migrated Watai to server-authoritative generation."

The old record should become `invalidated` with `invalidAt`, and the new record should reference it in `supersedes`.

## 9. API Surface

All endpoints are auth-gated and derive `userId` from the token.

| Method | Route | Purpose |
| --- | --- | --- |
| `GET` | `/api/memory` | List active/suppressed memories with filters and pagination. |
| `POST` | `/api/memory` | Add a manual memory. |
| `PATCH` | `/api/memory/{memoryId}` | Edit text, status, salience, pinned, or suppression state. |
| `DELETE` | `/api/memory/{memoryId}` | Delete a memory so it is no longer retrievable. |
| `GET` | `/api/memory/summary` | Read the current memory summary. |
| `PUT` | `/api/memory/summary` | User-edited summary update. |
| `POST` | `/api/memory/query` | Internal/admin/debug query preview for Settings; not used by model directly. |
| `POST` | `/api/memory/rebuild` | Rebuild memory from eligible chat history. |
| `POST` | `/api/memory/export` | Export memory JSON. |
| `POST` | `/api/memory/import` | Import memory JSON after user confirmation. |
| `DELETE` | `/api/memory` | Reset all memory records for the user. |

Server-run internal services can call the application layer directly rather than loop through HTTP.

## 10. UI Surface

Settings > Personalization should become a full memory management area:

- Memory master toggle.
- Reference saved memories toggle.
- Reference chat history/thread summaries toggle.
- Pause memory action.
- Reset memory action.
- Memory summary editor with last-updated time.
- Searchable memory list with kind, source, last used, and status.
- Memory detail view showing source thread/message, edit/delete/suppress controls.
- Import/export actions.
- Rebuild from chat history action.

Chat response UI should show a compact **Memory used** affordance when memory refs exist. Opening it shows:

- memory text used,
- source thread/message when available,
- correction action,
- suppress action,
- delete action.

## 11. Privacy And Safety Rules

- Memory is off for temporary chats.
- Memory must not store credentials or raw secret values.
- Sensitive categories require explicit user intent and conservative classification.
- Deleted memories are excluded from retrieval immediately.
- Suppressed memories are retained for audit/user review but excluded from prompt context.
- Data export includes memory records and summaries.
- Delete-all-data cascades through memory records and memory-derived summaries.
- Shared chats must not expose hidden memory source panels unless intentionally included in an authenticated export.

## 12. Prompt Assembly Rules

Prompt assembly order for server runs:

1. System/developer instructions.
2. Safety/tool policy.
3. User-authored custom instructions.
4. Memory context block.
5. Recent thread messages.
6. Current user message and attachments.

Memory instructions to the model:

- Use memory only if relevant.
- Do not reveal memory ids to the user.
- If a memory conflicts with the current message, trust the current message and allow the memory subsystem to update later.
- Do not infer sensitive facts beyond what is provided.

## 13. Open Decisions

| ID | Decision | Default |
| --- | --- | --- |
| M1 | Embedding deployment requirement | Optional. Start lexical/entity; add embeddings when configured. |
| M2 | Azure AI Search vs Cosmos-only retrieval | Cosmos-only MVP; Azure AI Search after evals show scale need. |
| M3 | Memory source retention after source deletion | Delete or invalidate memory if all source refs are deleted. |
| M4 | Sensitive memory handling | Block by default unless user explicitly says to remember and classifier allows. |
| M5 | Project-scoped memory | Defer until Watai has projects/spaces; keep schema scope-ready. |
