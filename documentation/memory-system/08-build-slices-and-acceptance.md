# 08 — Build Slices And Acceptance

This document turns the memory-system specs into implementation-sized work. Each slice should be small enough to review independently and should leave the product in a coherent state.

Cross-references: [03-implementation-plan.md](03-implementation-plan.md), [06-api-and-schema-contracts.md](06-api-and-schema-contracts.md), [07-retrieval-and-extraction-algorithms.md](07-retrieval-and-extraction-algorithms.md), [05-memory-ux-spec.md](05-memory-ux-spec.md).

## Slice 0 — Contracts And Test Fixtures

Goal: add shared types/schemas and eval fixtures without changing runtime behavior.

Files:

- `api/src/domain/memory.ts`
- `src/data/cloud/types.ts`
- `documentation/memory-system/*` if docs need final sync
- `api/src/domain/memory.test.ts`

Work:

- Add Zod schemas from [06](06-api-and-schema-contracts.md).
- Add frontend wire interfaces.
- Add fixture JSON files for preference, deletion, temporary, contradiction, and over-insertion cases.

Acceptance:

- Typecheck frontend/backend.
- Schema tests reject unknown fields, secrets, missing source refs, invalid statuses.
- No runtime app behavior changes.

## Slice 1 — Infra And Store

Goal: server can persist memory records but no UI/run behavior changes yet.

Files:

- `infra/main.bicep`
- `api/src/ports/memoryStore.ts`
- `api/src/adapters/memory/memoryStore.ts`
- `api/src/adapters/cosmos/memoryStore.ts`
- `api/src/composition.ts`

Work:

- Add Cosmos `memory` container `/userId`.
- Add memory store port and memory/cosmos adapters.
- Add local in-memory store for tests.

Acceptance:

- Existing app settings preserved in Bicep.
- Store tests cover list/get/put/patch/summary/pagination.
- No HTTP endpoints exposed yet.

## Slice 2 — Memory CRUD API

Goal: auth-gated server memory API works.

Files:

- `api/src/application/memoryService.ts`
- `api/src/http/memoryController.ts`
- `api/src/functions/api.ts`
- `api/src/composition.ts`
- `src/data/cloud/apiClient.ts`
- `src/data/cloud/types.ts`

Work:

- Implement endpoints from [06](06-api-and-schema-contracts.md).
- Implement status transitions and delete/suppress rules.
- Add frontend cloud client methods.

Acceptance:

- Controller tests for auth, validation, pagination, delete/suppress exclusion.
- API client tests for every endpoint.
- Delete memory immediately excludes from `MemoryService.list({status:'active'})`.

## Slice 3 — Repository Migration And Manual Memory UI

Goal: user can manage explicit memory in Settings across devices.

Files:

- `src/data/repository.ts`
- `src/data/local/localRepository.ts`
- `src/data/sync/syncRepository.ts`
- `src/features/settings/Settings.tsx` or extracted settings subcomponents
- `src/design/components.css`
- Storybook stories for Memory screens

Work:

- Replace local-only memory methods with cloud-backed synced behavior.
- Preserve local memory for sync-off mode.
- Implement Manage Memory screen from [05](05-memory-ux-spec.md).
- Implement local-to-cloud migration marker.

Acceptance:

- User can add/edit/delete/suppress/top-of-mind memory.
- Empty/loading/error/paused states render.
- Mobile action flows use menus/sheets, not hover-only controls.
- Storybook coverage for list, detail, empty, paused, memory-used panel shell.

## Slice 4 — Memory Context Retrieval In Runs

Goal: server runs can use bounded memory context.

Files:

- `api/src/application/memoryContextService.ts`
- `api/src/application/runWorker.ts`
- `api/src/domain/message.ts`
- `src/data/cloud/types.ts`
- `src/lib/types.ts`

Work:

- Implement `buildForRun` from [07](07-retrieval-and-extraction-algorithms.md).
- Inject rendered `MemoryContextBlock` into server-run prompt.
- Persist `memoryRefs` on assistant message.
- Add telemetry events.

Acceptance:

- Memory disabled returns empty block.
- Temporary thread returns empty block.
- Deleted/suppressed records never appear.
- Low-score query returns no atomic memory.
- Synthetic 500-memory fixture meets p95 budget in test/benchmark mode.
- Assistant message round-trips `memoryRefs` to frontend.

## Slice 5 — Response-Level Memory Used UI

Goal: user can inspect and act on memories used in a response.

Files:

- `src/features/chat/Message.tsx`
- new `src/features/chat/MemorySourcesPane.tsx` or similar
- `src/features/settings` memory detail components shared where appropriate
- `src/design/components.css`

Work:

- Render compact Memory used affordance only when `memoryRefs.length > 0`.
- Open details with used memory text, category, source, and actions.
- Wire Correct, Don't use, Delete, Mark not relevant.

Acceptance:

- Used memories match assistant message `memoryRefs`.
- Suppress/delete from panel affects future retrieval without reload.
- Mobile opens bottom sheet.
- Accessibility labels and keyboard behavior pass checks.

## Slice 6 — Background Extraction Worker

Goal: automatic memory extraction runs after responses without blocking generation.

Files:

- `api/src/domain/memoryExtraction.ts`
- `api/src/ai/memoryExtractor.ts`
- `api/src/application/memoryExtractionService.ts`
- `api/src/adapters/azure/queueMemoryStarter.ts`
- `api/src/functions/memoryWorker.ts`
- `api/src/index.ts`
- `infra/main.bicep`

Work:

- Enqueue extraction after terminal complete assistant messages.
- Implement strict JSON extractor contract.
- Validate/redact/dedupe/invalidate.
- Refresh summary when thresholds pass.

Acceptance:

- Extraction is never on send-to-first-token path.
- Secret-like values rejected.
- One-off prompts rejected.
- Corrections invalidate older memories.
- Assistant-confirmed durable work can become episodic memory.
- Queue retry/decode tests follow existing run worker pattern.

## Slice 7 — Import, Export, Rebuild, Retention

Goal: operational controls are complete.

Files:

- `api/src/application/memoryService.ts`
- `api/src/application/memoryExtractionService.ts`
- `src/features/settings` memory screens
- export/delete-all data paths

Work:

- Export/import memory JSON.
- Rebuild memory from eligible history.
- Delete-all-data cascades through memory.
- Retention policy invalidates/deletes derived memories.

Acceptance:

- Import preview shows accepted/rejected records.
- Rebuild is idempotent.
- Delete all data leaves no memory records, summaries, jobs, or refs.
- Retention expiry removes thread summaries and source-only derived memories.

## Slice 8 — Hybrid Retrieval Upgrade

Goal: improve retrieval only after MVP evals show need.

Files:

- `api/src/application/memoryContextService.ts`
- optional embedding service/adapter
- optional Azure AI Search adapter

Work:

- Add optional embeddings.
- Add hybrid score fusion.
- Add query preview diagnostics for retrieval tuning.

Acceptance:

- Recall improves without precision regression.
- p95 latency remains within budget.
- Token budget remains within budget.
- Vector/hybrid path is feature-flagged.

## Release Readiness Checklist

Before enabling memory for users:

- All hard gates in [04](04-evaluation-and-governance.md) pass.
- UX acceptance checklist in [05](05-memory-ux-spec.md) passes on desktop and mobile.
- Manual remember/forget works.
- Automatic extraction is behind a flag until evaluated.
- Temporary chats do not read/write memory.
- Deleted/suppressed memory is excluded immediately.
- Export/delete-all includes memory.
- Observability emits non-content telemetry only.