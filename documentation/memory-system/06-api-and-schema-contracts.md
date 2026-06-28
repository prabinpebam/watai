# 06 — API And Schema Contracts

This document is the build contract for the first memory-system implementation. It names the wire types, validation bounds, endpoint shapes, status semantics, and message integration needed before coding starts.

Cross-references: [02-watai-memory-spec.md](02-watai-memory-spec.md), [05-memory-ux-spec.md](05-memory-ux-spec.md), [07-retrieval-and-extraction-algorithms.md](07-retrieval-and-extraction-algorithms.md), [08-build-slices-and-acceptance.md](08-build-slices-and-acceptance.md).

## 1. Naming And Ownership

- Backend domain file: `api/src/domain/memory.ts`.
- Backend port: `api/src/ports/memoryStore.ts`.
- Backend application services:
  - `api/src/application/memoryService.ts`
  - `api/src/application/memoryContextService.ts`
  - `api/src/application/memoryExtractionService.ts`
- Backend HTTP controller: `api/src/http/memoryController.ts`.
- Frontend wire types: `src/data/cloud/types.ts`.
- Frontend repository methods stay in `src/data/repository.ts` but become cloud-backed through `SyncRepository` when sync is on.
- Memory is server-owned for signed-in synced users. Local `MemoryItem[]` is a migration/offline compatibility layer, not the final source of truth.

## 2. Canonical Enums

```ts
export const MEMORY_KINDS = [
  'fact',
  'preference',
  'instruction',
  'work_style',
  'project_context',
  'thread_summary',
  'avoidance',
  'entity',
  'procedure',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = ['active', 'suppressed', 'invalidated', 'deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_VISIBILITY = ['normal', 'top_of_mind', 'background'] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITY)[number];

export const MEMORY_SOURCE_TYPES = [
  'message',
  'thread',
  'manual',
  'import',
  'settings',
  'system',
] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];
```

## 3. Zod Schema Bounds

Use these exact bounds for backend schemas and keep frontend types aligned:

| Field | Bound |
| --- | ---: |
| `id`, `memoryId`, `threadId`, `messageId`, `runId` | 1-64 chars |
| `text` | 1-2,000 chars |
| `normalizedText` | 1-2,000 chars |
| `summary` | 0-800 chars |
| `source quote` | 0-500 chars |
| `entity`, `topic` | 1-80 chars each, max 32 each |
| `confidence`, `salience`, `score` | number 0-1 |
| `sourceRefs` | max 12 |
| `supersedes` | max 16 |
| `embedding` | optional, max 4,096 dimensions |
| `import batch` | max 500 records |
| `page limit` | default 50, max 100 |

All strings are trimmed. Empty strings reject unless explicitly optional. Unknown object keys reject at HTTP/domain boundaries.

## 4. Core Records

### 4.1 `MemorySourceRef`

```ts
export interface MemorySourceRef {
  type: MemorySourceType;
  threadId?: string;
  messageId?: string;
  runId?: string;
  quote?: string;
  createdAt: string;
}
```

Validation rules:

- `type: 'message'` requires `threadId` and `messageId`.
- `type: 'thread'` requires `threadId`.
- `type: 'manual'`, `import`, `settings`, and `system` do not require ids.
- Automatic extraction must include at least one non-system source ref.
- Source quotes are optional but recommended for UI transparency.

### 4.2 `MemoryRecord`

```ts
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
  sourceRefs: MemorySourceRef[];
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
```

Status semantics:

- `active`: eligible for retrieval if other filters pass.
- `suppressed`: visible in Hidden filter, excluded from retrieval.
- `invalidated`: visible as Outdated, excluded from current retrieval unless an audit/source view asks for history.
- `deleted`: excluded from normal list and retrieval. May remain as tombstone only for sync/audit safety.

Visibility semantics:

- `top_of_mind`: shown prominently and receives a ranking lift, but never overrides relevance or deletion/suppression.
- `normal`: default.
- `background`: retained and searchable but lower priority.

### 4.3 `MemorySummaryRecord`

```ts
export interface MemorySummaryRecord {
  id: 'memory-summary';
  userId: string;
  kind: 'summary';
  text: string;
  sourceMemoryIds: string[];
  updatedAt: string;
  version: number;
}
```

### 4.4 `MemoryContextBlock`

```ts
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
  retrievalMode: 'lexical' | 'hybrid' | 'cached' | 'empty';
}
```

## 5. Message Integration

Assistant messages need source refs for transparent response-level UI.

```ts
export interface MessageMemoryRef {
  memoryId: string;
  kind: MemoryKind;
  text: string;
  sourceThreadId?: string;
  sourceMessageId?: string;
  score: number;
}

export interface MessageRecord {
  // existing fields...
  memoryRefs?: MessageMemoryRef[];
}
```

Rules:

- Store only selected memories actually included in `MemoryContextBlock`.
- Do not store hidden candidates or raw retrieval scores beyond selected item score.
- The UI panel must render from `memoryRefs`; it should not re-run retrieval client-side.
- Shared public exports must omit `memoryRefs` unless authenticated export explicitly includes them.

## 6. Settings Contract

Current `Settings.personalization.memoryEnabled` remains for compatibility, but the server schema should evolve to:

```ts
export interface MemorySettings {
  enabled: boolean;
  paused: boolean;
  referenceSaved: boolean;
  referenceHistory: boolean;
  autoExtract: boolean;
}

export interface Settings {
  personalization: {
    aboutYou?: string;
    howRespond?: string;
    memoryEnabled: boolean; // compatibility alias for enabled
    memory?: MemorySettings;
  };
}
```

Migration rules:

- If `memory` is absent, derive `enabled = memoryEnabled`, `referenceSaved = memoryEnabled`, and `paused = false`.
- For existing users, default `referenceHistory = false` and `autoExtract = false` until the upgraded Memory settings copy has been shown or product explicitly decides the old toggle covered automatic learning.
- For new users who see onboarding/settings copy that explains automatic learning, default `referenceHistory = memoryEnabled` and `autoExtract = memoryEnabled`.
- Turning the compatibility `memoryEnabled` switch off must also set `memory.enabled = false` on new writes.

## 7. HTTP Endpoints

All endpoints are auth-gated and derive `userId` from the token.

### 7.1 List Memories

`GET /api/memory?status=active&kind=preference&q=typescript&cursor=...&limit=50`

Response:

```ts
interface ListMemoryResponse {
  memories: MemoryRecord[];
  cursor?: string;
}
```

Filtering:

- `status`: optional, default excludes `deleted`.
- `kind`: optional.
- `q`: optional lexical search over `text`, `summary`, `entities`, `topics`.
- `limit`: default 50, max 100.

### 7.2 Add Manual Memory

`POST /api/memory`

Request:

```ts
interface CreateMemoryRequest {
  text: string;
  kind?: Exclude<MemoryKind, 'thread_summary' | 'entity'>;
  visibility?: MemoryVisibility;
  pinned?: boolean;
  sourceRef?: MemorySourceRef; // defaults to { type: 'manual' }
}
```

Response: `MemoryRecord`.

Behavior:

- Validates/redacts secret-like text.
- Defaults `kind = 'fact'`, `visibility = 'normal'`, `confidence = 1`, `salience = 0.7`.

### 7.3 Patch Memory

`PATCH /api/memory/{memoryId}`

Request:

```ts
interface PatchMemoryRequest {
  text?: string;
  kind?: MemoryKind;
  status?: Extract<MemoryStatus, 'active' | 'suppressed' | 'invalidated'>;
  visibility?: MemoryVisibility;
  pinned?: boolean;
  salience?: number;
}
```

Response: `MemoryRecord`.

Rules:

- Patching `text` updates `normalizedText`, `updatedAt`, and invalidates embedding if present.
- Patching `status = suppressed` immediately excludes retrieval.
- Patching invalidated requires `invalidAt = now`.

### 7.4 Delete Memory

`DELETE /api/memory/{memoryId}`

Response: `204`.

Behavior:

- Sets `status = 'deleted'`, `deletedAt = now`.
- Retrieval excludes immediately.

### 7.5 Summary

`GET /api/memory/summary`

Response:

```ts
interface MemorySummaryResponse {
  summary: MemorySummaryRecord | null;
}
```

`PUT /api/memory/summary`

Request:

```ts
interface PutMemorySummaryRequest {
  text: string;
}
```

Response: `MemorySummaryRecord`.

### 7.6 Query Preview

`POST /api/memory/query`

Request:

```ts
interface MemoryQueryPreviewRequest {
  threadId?: string;
  text: string;
  includeSuppressed?: boolean;
  limit?: number;
}
```

Response:

```ts
interface MemoryQueryPreviewResponse {
  context: MemoryContextBlock;
  candidates: Array<{
    memory: MemoryRecord;
    score: number;
    reason: string[];
    selected: boolean;
  }>;
}
```

This endpoint is for Settings/debug preview only. The model path calls `MemoryContextService` directly.

### 7.7 Import/Export/Rebuild

`POST /api/memory/export`

Response:

```ts
interface MemoryExportResponse {
  exportedAt: string;
  version: 1;
  memories: MemoryRecord[];
  summary: MemorySummaryRecord | null;
}
```

`POST /api/memory/import`

Request:

```ts
interface MemoryImportRequest {
  version: 1;
  memories: Array<Pick<MemoryRecord, 'text' | 'kind' | 'sourceRefs' | 'visibility' | 'pinned'>>;
  mode: 'preview' | 'commit';
}
```

Response:

```ts
interface MemoryImportResponse {
  added: number;
  skipped: number;
  rejected: Array<{ text: string; reason: string }>;
  preview?: MemoryRecord[];
}
```

`POST /api/memory/rebuild`

Request:

```ts
interface MemoryRebuildRequest {
  mode: 'preview' | 'commit';
  includeArchived?: boolean;
  since?: string;
}
```

Response:

```ts
interface MemoryRebuildResponse {
  jobId?: string;
  status: 'queued' | 'preview_ready';
  previewCount?: number;
}
```

## 8. Application Service Contract

```ts
interface MemoryService {
  list(userId: string, query: ListMemoryQuery): Promise<ListMemoryResponse>;
  createManual(userId: string, input: CreateMemoryRequest): Promise<MemoryRecord>;
  patch(userId: string, memoryId: string, input: PatchMemoryRequest): Promise<MemoryRecord>;
  delete(userId: string, memoryId: string): Promise<void>;
  getSummary(userId: string): Promise<MemorySummaryRecord | null>;
  putSummary(userId: string, text: string): Promise<MemorySummaryRecord>;
  export(userId: string): Promise<MemoryExportResponse>;
  import(userId: string, input: MemoryImportRequest): Promise<MemoryImportResponse>;
}

interface MemoryContextService {
  buildForRun(input: {
    userId: string;
    threadId: string;
    latestUserText: string;
    now: string;
    tokenBudget?: number;
  }): Promise<MemoryContextBlock>;
}
```

## 9. Store Contract

```ts
interface MemoryStore {
  list(userId: string, opts: MemoryStoreListOptions): Promise<MemoryRecord[]>;
  get(userId: string, memoryId: string): Promise<MemoryRecord | null>;
  put(record: MemoryRecord): Promise<MemoryRecord>;
  patch(userId: string, memoryId: string, patch: Partial<MemoryRecord>): Promise<MemoryRecord>;
  listSummaries(userId: string): Promise<MemorySummaryRecord | null>;
  putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord>;
}
```

Cosmos MVP query patterns:

- List active memories: `WHERE c.userId = @userId AND c.docType = 'memory' AND c.status IN (...)`.
- List thread summaries: same container, `kind = 'thread_summary'`.
- Summary: item id `memory-summary`, partition `/userId`.
- Cursor: base64 JSON `{ updatedAt, id }` for deterministic paging.

## 10. Error Codes

Use existing API envelope style with these codes:

| Code | Meaning |
| --- | --- |
| `validation` | Bad request body or unsafe memory text. |
| `not_found` | Memory id not found for user. |
| `conflict` | Patch conflicts with deleted/invalidated state. |
| `forbidden` | User cannot access memory due to invite/auth state. |
| `internal` | Unexpected failure. |

## 11. Acceptance For Contracts

- Backend schemas reject unknown fields.
- Deleted/suppressed records cannot be returned by `MemoryContextService`.
- Source refs are required for automatic extraction records.
- API pagination is deterministic.
- `memoryRefs` on messages are round-tripped by cloud mappers.
- Local memory migration can run idempotently.

## 12. Automatic Extraction Contracts

The active learner is specified in [09-background-extraction-system.md](09-background-extraction-system.md). The key additional contracts are:

```ts
export interface MemoryJobMessage {
  jobId: string;
  userId: string;
  threadId: string;
  kind: 'command' | 'turn' | 'rebuild';
}

export interface MemoryExtractionJobRecord {
  id: string;
  userId: string;
  threadId: string;
  kind: 'command' | 'turn' | 'rebuild';
  status: 'queued' | 'running' | 'completed' | 'ignored' | 'failed';
  userMessageId?: string;
  assistantMessageId?: string;
  runId?: string;
  dedupeKey: string;
  attempts: number;
  operationCounts?: {
    add: number;
    merge: number;
    invalidate: number;
    suppress: number;
    ignore: number;
  };
  acceptedCount?: number;
  rejectedCount?: number;
  lastErrorCode?: string;
  lastErrorMessage?: string;
  createdAt: string;
  updatedAt: string;
  completedAt?: string;
}
```

Job records live in a dedicated Cosmos `memoryJobs` container partitioned by `/userId`. Queue payloads carry ids only; workers load the job record and then rehydrate message content from stores after verifying ownership.

Extractor output is strict JSON with operations `add`, `merge`, `invalidate`, `suppress`, and `ignore`. Model output is never stored directly; `MemoryExtractionService` validates source ownership, temporary-thread eligibility, confidence, safety, dedupe, and contradiction rules before writing `MemoryRecord` changes.