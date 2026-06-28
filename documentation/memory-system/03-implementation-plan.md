# 03 — Implementation Plan

This plan maps the memory system spec to Watai's current codebase. It assumes the server-authoritative direction in [../02-architecture.md](../02-architecture.md) and [../06-server-runs-and-migration.md](../06-server-runs-and-migration.md).

The implementation must optimize for four outcomes together: fast hot-path retrieval, high response quality, accurate/current personalization, and enough memory width to cover user preferences, project context, and past work without dumping history into prompts. UX requirements are specified in [05-memory-ux-spec.md](05-memory-ux-spec.md), exact contracts in [06-api-and-schema-contracts.md](06-api-and-schema-contracts.md), algorithms in [07-retrieval-and-extraction-algorithms.md](07-retrieval-and-extraction-algorithms.md), and PR-sized slices in [08-build-slices-and-acceptance.md](08-build-slices-and-acceptance.md). These are part of the implementation contract, not follow-up polish.

## 1. Current Code Facts

As of 2026-06-27:

- Frontend type: `MemoryItem { id, text, source, createdAt }` in `src/lib/types.ts`.
- Repository methods: `listMemory`, `addMemory`, `removeMemory` in `src/data/repository.ts`.
- Local storage: `src/data/local/localRepository.ts` stores memory in local key-value storage.
- Sync behavior: `src/data/sync/syncRepository.ts` explicitly keeps memory local because there are no server endpoints.
- Settings: `Settings.personalization.memoryEnabled` and a Settings toggle exist.
- Backend: no memory domain, service, port, adapter, controller, or Cosmos store exists yet.

The migration should preserve existing local memories by importing them into server memory when the user signs in and enables sync.

## 2. Phase 0 — Contracts And Documentation

Goal: make the intended behavior testable before adding storage.

Deliverables:

- Add backend domain schemas in `api/src/domain/memory.ts`.
- Add shared frontend wire types in `src/data/cloud/types.ts`.
- Add prompt assembly contract for `MemoryContextBlock` in the server-run worker docs/tests.
- Add eval fixtures from [04-evaluation-and-governance.md](04-evaluation-and-governance.md).
- Add the initial scorer contract and source caps to tests before implementing retrieval.
- Add telemetry event names and non-content fields to the API contract.

Validation:

- Typecheck both projects.
- Unit tests for schema parse/reject behavior.

## 3. Phase 1 — Server Memory CRUD

Goal: server-owned memory exists and is manageable, but not yet used during generation.

Backend files:

- `api/src/domain/memory.ts`
- `api/src/ports/memoryStore.ts`
- `api/src/adapters/memory/memoryStore.ts`
- `api/src/adapters/cosmos/memoryStore.ts`
- `api/src/application/memoryService.ts`
- `api/src/http/memoryController.ts`
- `api/src/functions/api.ts` route registration
- `api/src/composition.ts` dependency wiring

Infrastructure:

- Add Cosmos `memory` container to `infra/main.bicep` with partition key `/userId`.
- Ensure Bicep app settings include any memory queue/index flags added later. Remember: app settings in Bicep are full replacement.

API:

- `GET /api/memory`
- `POST /api/memory`
- `PATCH /api/memory/{id}`
- `DELETE /api/memory/{id}`
- `GET /api/memory/summary`
- `PUT /api/memory/summary`
- `DELETE /api/memory`

Frontend:

- Extend `CloudApi` in `src/data/cloud/apiClient.ts`.
- Add wire mappers in `src/data/cloud/types.ts`.
- Replace sync repository local-only memory methods with cloud-backed methods when sync is enabled.
- Keep local repository as offline/local mode storage.

Validation:

- Backend unit tests for service authorization/status transitions.
- Controller tests for validation, pagination, delete exclusion.
- Frontend api client tests.
- Sync repository tests proving memory is cloud-backed when sync is on and local-only when sync is off.

## 4. Phase 2 — Settings UI And Manual Memory

Goal: users can manage memory explicitly.

Frontend files likely touched:

- `src/features/settings/Settings.tsx`
- `src/data/repository.ts`
- `src/data/local/localRepository.ts`
- `src/data/sync/syncRepository.ts`
- `src/lib/types.ts`
- design CSS only if existing components cannot express the list/detail UI.

Product behavior:

- Memory list with search/sort.
- Add manual memory.
- Edit memory text.
- Delete memory.
- Suppress/do not mention.
- Summary editor.
- Pause/reset controls.
- Import existing local memory into cloud on first enable/sync.
- Top-of-mind/background priority controls.
- Memory detail view with category, source, use state, history, and danger zone.
- Mobile bottom sheets/full-screen editors for memory actions.

Validation:

- Settings UI tests for toggle/list/add/delete flows.
- A data deletion test proving memory is included in delete-all-data behavior.
- UX acceptance checks from [05-memory-ux-spec.md](05-memory-ux-spec.md) for empty/loading/error/paused states and mobile controls.

## 5. Phase 3 — Memory Retrieval In Server Runs

Goal: memory can influence responses with bounded source-linked context.

Backend files likely touched:

- `api/src/application/memoryContextService.ts`
- `api/src/application/runWorker.ts`
- `api/src/ai/chat.ts` or server prompt assembly equivalent
- `api/src/domain/message.ts` to allow `memoryRefs` on assistant messages
- `src/lib/types.ts` and cloud message mappers to render memory refs later

Implementation:

1. Add `MemoryContextService.buildForRun(userId, threadId, latestUserText)`.
2. Check settings: memory disabled, temporary thread, or run opt-out returns empty block.
3. Query active memories and thread summaries.
4. Rank with lexical/entity/salience/recency/pinned scoring.
5. Build a token-bounded block.
6. Inject block into server-run prompt.
7. Persist memory refs used on the assistant message.
8. Exclude suppressed/deleted/invalidated records.
9. Emit `memory_context_built` or `memory_context_skipped` telemetry with candidate count, selected count, token estimate, latency, and retrieval mode.
10. If retrieval fails, continue the run with an empty memory block and log non-content telemetry.

Validation:

- Unit tests for scorer ordering and token budget trimming.
- Run worker tests proving memory context is included only when eligible.
- Tests for temporary chat exclusion.
- Tests proving deleted/suppressed memories are not referenced.
- Latency tests or synthetic benchmarks for p95 under the MVP budget.
- Tests proving low-score candidates produce an empty memory block rather than irrelevant prompt context.

## 6. Phase 4 — Background Extraction

Goal: Watai automatically learns useful memories after turns complete.

Backend files likely added/touched:

- `api/src/domain/memoryExtraction.ts`
- `api/src/application/memoryExtractionService.ts`
- `api/src/functions/memoryWorker.ts`
- `api/src/adapters/azure/queueMemoryStarter.ts`
- `api/src/ai/memoryExtractor.ts`
- `api/src/index.ts` imports the new worker

Infrastructure:

- Storage Queue `memory-jobs`.
- Optional app setting `MEMORY_QUEUE`.
- Optional app setting for memory extraction model/deployment if not derived from user credentials.

Implementation:

1. On terminal assistant message, enqueue `{ userId, threadId, runId, assistantMessageId }`.
2. Worker loads recent turn window and eligible existing memories.
3. Calls extraction model with strict JSON output.
4. Validates candidates and source refs.
5. Applies redaction/sensitive filters.
6. Stores additive records and invalidations.
7. Refreshes memory summary when changed memory count or age threshold is reached.

Validation:

- Extraction tests with deterministic fake model output.
- Sensitive/secret rejection tests.
- Contradiction tests: new memory invalidates old one, old one no longer retrieves as current.
- Queue decode/retry tests following the existing run queue pattern.
- Over-insertion tests: one-off requests should not become memory.
- Assistant-fact tests: useful completed work can become episodic memory with assistant-message source refs.

## 7. Phase 5 — Memory Sources In Chat UI

Goal: users can see why a response was personalized.

Frontend files likely touched:

- `src/features/chat/Message.tsx` or equivalent message renderer.
- `src/features/chat` subcomponents for memory source disclosure.
- `src/data/cloud/types.ts` message mappers.
- `api/src/domain/message.ts` already updated in Phase 3.

Product behavior:

- Show a compact "Memory used" affordance when `memoryRefs` are present.
- Detail view shows used memories and source links.
- User can correct, suppress, or delete directly from the source detail.
- User can mark a memory as not relevant without deleting it, for retrieval feedback.

Validation:

- Component tests for disclosure visibility.
- API tests for correction/suppression from response source actions.
- Accessibility tests for keyboard/screen reader controls.
- Mobile bottom-sheet tests for response-level memory sources.

## 8. Phase 6 — Hybrid Retrieval Upgrade

Goal: improve recall and precision once MVP behavior is proven.

Options:

- Store embeddings directly on memory records and perform app-side vector scoring for small user memory sets.
- Use Cosmos DB vector indexing if available in the target account mode.
- Add Azure AI Search for hybrid vector + keyword retrieval if memory volume or latency requires it.

Recommended sequence:

1. Add `embedding` and `embeddingModel` fields but keep them optional.
2. Generate embeddings during memory extraction when the user has an embedding deployment configured.
3. Add entity extraction and entity overlap scoring.
4. Run evals before and after enabling vector retrieval.
5. Only add Azure AI Search if eval/latency data justify the extra service.

Validation:

- Recall@K and answer-correctness deltas on the memory eval suite.
- p95 retrieval latency budget.
- Token budget regression check.
- Precision regression check: hybrid retrieval cannot improve recall by flooding prompt context with irrelevant memories.

## 9. Phase 7 — Import, Export, Rebuild, Retention

Goal: make memory operationally complete.

Deliverables:

- Export memory JSON in account export.
- Import memory JSON with preview and confirmation.
- Rebuild memory from eligible chat history.
- Delete-all-data cascades through memory.
- Retention policy invalidates/deletes memory derived only from expired threads.
- Optional compatibility with memory import formats from other AI tools.

Validation:

- End-to-end export/import tests.
- Delete-all-data integration test.
- Rebuild idempotency test.

## 10. Suggested Code Ownership Boundaries

```text
api/src/domain/memory.ts
  Pure zod schemas, status rules, token/source bounds.

api/src/application/memoryService.ts
  CRUD, validation, status transitions, summaries, import/export.

api/src/application/memoryContextService.ts
  Retrieval, scoring, token budgeting, prompt block construction.

api/src/application/memoryExtractionService.ts
  Turn-window extraction orchestration, model output validation, store writes.

api/src/ports/memoryStore.ts
  Store interface only.

api/src/adapters/cosmos/memoryStore.ts
  Cosmos queries and persistence.

api/src/http/memoryController.ts
  HTTP request parsing and response envelopes.

src/data/cloud/apiClient.ts
  Wire calls only.

src/features/settings/Settings.tsx
  User controls and memory management UI.
```

## 11. Migration From Local Memory

When a signed-in user enables sync:

1. Read local `MemoryItem[]`.
2. Fetch cloud memory list.
3. For each local item not already imported, create a cloud `MemoryRecord` with source `import` and `sourceRefs.type = 'manual'`.
4. Mark local migration complete in local kv, e.g. `memory.cloudMigratedAt`.
5. Continue showing cloud memory through `SyncRepository`.

Do not delete local memory until the cloud write succeeds and the user has not opted out of sync.

## 12. Rollout Flags

Use feature flags to reduce risk:

- `watai.flags.serverMemoryCrud`
- `watai.flags.memoryInRuns`
- `watai.flags.memoryExtraction`
- `watai.flags.memorySourcesUi`
- `watai.flags.memoryHybridRetrieval`

The first production rollout can enable manual memory CRUD before automatic extraction.

## 13. Definition Of Done

Memory is implementation-complete when:

- Server memory CRUD is deployed and auth-gated.
- Settings can list/add/edit/delete memory across devices.
- Server runs retrieve memory and persist response-level memory refs.
- Temporary chats neither read nor write memory.
- Background extraction creates useful source-linked records.
- Users can pause/reset/export/import memory.
- Delete-all-data cascades through memory.
- The memory eval suite passes all required gates in [04-evaluation-and-governance.md](04-evaluation-and-governance.md).
- Retrieval p95, token budget, recall, precision, and leakage metrics are observable and stay within release thresholds.
