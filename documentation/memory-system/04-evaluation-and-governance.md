# 04 — Evaluation And Governance

Watai's memory system is only useful if it remembers the right things, forgets what the user deleted, stays fast, and avoids inventing personalized context. CRUD tests are necessary but not sufficient.

This document defines the eval plan, metrics, observability, and governance rules for Watai memory.

UX transparency requirements are specified in [05-memory-ux-spec.md](05-memory-ux-spec.md). The evaluation plan treats those controls as functional requirements: a memory that cannot be inspected, corrected, suppressed, or deleted from the relevant UX surface is not an acceptable memory.

## 1. Evaluation Principles

1. Test semantic behavior, not plumbing.
2. Treat deletion, suppression, temporary chat, and source deletion as first-class negative tests.
3. Measure recall, precision, latency, and token cost together.
4. Keep benchmark claims reproducible and label vendor numbers as vendor numbers.
5. Test memory in the real server-run path, not only a standalone retrieval function.

## 2. Required Eval Fixtures

### 2.1 Preference Recall

Setup:

- User says they prefer short implementation plans.
- Later asks for a plan without restating the preference.

Expected:

- Memory retrieval includes the preference.
- Answer style reflects it.
- Response memory source links to the original message or manual memory.

### 2.2 Explicit Remember Command

Setup:

- User says, "Remember that my Watai deploy target is rg-watai-dev."
- Next thread asks, "What resource group should I deploy to?"

Expected:

- Manual/hot-path memory write is available immediately.
- Retrieval includes the memory.
- Answer uses `rg-watai-dev` and shows source.

### 2.3 Contradiction Update

Setup:

- Earlier memory says Watai generation is client-side.
- Later conversation says Watai pivoted to server-authoritative generation.

Expected:

- Old memory is invalidated or scored as historical.
- Current answer uses server-authoritative fact.
- Memory detail shows validity/supersession.

### 2.4 Temporal Reasoning

Setup:

- User changes project status across several sessions.
- Later asks what changed since last week.

Expected:

- Retrieval includes time-stamped relevant facts.
- Answer distinguishes old and current state.

### 2.5 Multi-Hop Recall

Setup:

- Thread A says the user is building Watai.
- Thread B says Watai uses Azure Functions for server runs.
- Thread C asks what backend pattern their app uses.

Expected:

- Retrieval combines project identity and backend fact.
- Answer names Watai and Azure Functions server-run worker.

### 2.6 Temporary Chat Exclusion

Setup:

- User reveals a preference in a temporary chat.
- Later asks a related question in a normal chat.

Expected:

- Temporary chat content is not extracted.
- Existing memory is not read during the temporary chat.
- Later normal chat cannot use the temporary-only detail.

### 2.7 Deletion And Suppression

Setup:

- Memory is created and used once.
- User deletes it, or selects "do not mention this again."
- Later prompt would otherwise trigger it.

Expected:

- Deleted/suppressed memory is excluded from retrieval immediately.
- No source refs point to deleted/suppressed memory in new responses.

### 2.8 Sensitive Data Rejection

Setup:

- User pastes an API key or secret-like string.
- User does not explicitly ask Watai to remember it.

Expected:

- Extraction rejects it.
- No secret-like value appears in memory records, logs, telemetry, or prompt context.

### 2.9 Assistant-Generated Fact

Setup:

- Assistant says it created a plan or completed a specific app action.
- Later user asks what Watai already did.

Expected:

- Memory extraction can store assistant-confirmed durable facts when useful.
- Source refs include the assistant message.

### 2.10 Abstention

Setup:

- User asks a question that resembles a memory but has no stored support.

Expected:

- Watai does not invent a remembered fact.
- Answer either asks for clarification or answers without personalization.

## 3. Metrics

| Metric | Target For MVP | Notes |
| --- | ---: | --- |
| Retrieval p95 latency | <= 250 ms | Server-side memory context build, excluding model generation. |
| Retrieval p99 latency | <= 500 ms | Slow memory must degrade to empty context rather than block generation. |
| Memory context token budget | <= 1,200 tokens default | Configurable; eval should fail if exceeded without explicit override. |
| Memory context hard max | <= 2,000 tokens | Requires explicit test/runtime override to exceed. |
| Relevant recall@8 | >= 0.80 on local fixtures | At least one needed memory in top 8. |
| Irrelevant precision@8 | >= 0.70 on local fixtures | Avoid prompt clutter. |
| Deleted memory leakage | 0 | Hard gate. |
| Temporary chat leakage | 0 | Hard gate. |
| Secret leakage | 0 | Hard gate. |
| Source coverage | >= 0.95 | Used memories should have displayable source refs unless manually added. |
| Extraction hot-path latency | 0 ms | Automatic extraction must not block response streaming. |
| Over-insertion rate | <= 0.10 on local fixtures | One-off details should not become durable memory. |
| Abstention accuracy | >= 0.90 | Do not invent memory when no support exists. |

## 4. Benchmark Strategy

### 4.1 Local Watai Evals First

Before adapting public benchmarks, build a small Watai-native eval suite. It should run in CI with deterministic fake model outputs for extraction and deterministic retrieval fixtures.

Minimum fixtures:

- 10 preference recall cases.
- 10 contradiction/update cases.
- 10 temporary-chat exclusion cases.
- 10 deletion/suppression cases.
- 10 no-memory abstention cases.
- 10 over-insertion rejection cases.
- 10 project-context recall cases.
- 10 source-ref correction cases.

### 4.2 Public Benchmarks Later

After the MVP works, adapt the [mem0ai/memory-benchmarks](https://github.com/mem0ai/memory-benchmarks) ingest -> search -> evaluate shape to a Watai adapter:

- Ingest benchmark conversations as Watai threads/messages.
- Run Watai memory extraction.
- Implement search by calling `MemoryContextService` or an internal query method.
- Evaluate answer correctness with the same answerer/judge setup.

Use these benchmarks directionally. Do not compare Watai scores to vendor-hosted scores unless models, retrieval depth, prompts, and judge models are controlled.

## 5. Regression Gates

A change must fail CI or release validation if:

- Deleted memory appears in a new prompt context.
- Temporary chat content appears in memory records or prompt context.
- A secret-like value is stored as memory.
- Memory context exceeds budget without an explicit test override.
- A response records memory refs that the user cannot inspect.
- A response-level memory source cannot be corrected, suppressed, or deleted from the UI.
- Server-run prompt assembly uses client-only memory state.
- Retrieval p95 exceeds the release budget in benchmark mode.
- Precision falls because the retriever widened memory without a source cap or threshold change approved by evals.

## 6. Observability

Log structured, non-content telemetry:

```jsonc
{
  "event": "memory_context_built",
  "userHash": "...",
  "threadId": "thr_...",
  "candidateCount": 43,
  "selectedCount": 6,
  "tokenEstimate": 812,
  "latencyMs": 74,
  "usedVector": false,
  "memoryEnabled": true
}
```

Do not log memory text, source quotes, raw prompts, secrets, or embeddings.

Events:

- `memory_context_built`
- `memory_context_skipped`
- `memory_extraction_enqueued`
- `memory_extraction_completed`
- `memory_extraction_rejected`
- `memory_deleted`
- `memory_suppressed`
- `memory_summary_refreshed`
- `memory_rebuild_started`
- `memory_rebuild_completed`

## 7. User Controls

Required controls:

- Enable/disable memory.
- Pause memory without deleting stored data.
- Delete one memory.
- Delete all memories.
- Suppress or "do not mention this again".
- Edit memory text.
- Edit memory summary.
- Export memory.
- Import memory.
- Rebuild memory from eligible history.
- Disable chat-history-derived memory while keeping explicit saved memories.

Controls must be available from Settings. Response-level memory source panels should expose delete/suppress/correct shortcuts.

## 8. Data Lifecycle

### 8.1 Temporary Chats

- Never retrieve memory for temporary runs.
- Never extract memory from temporary messages.
- Do not show temporary chats as memory sources.

### 8.2 Thread Deletion

When a thread is deleted:

- Thread summaries for that thread are deleted.
- Atomic memories whose only source is that thread are deleted or invalidated.
- Atomic memories with multiple sources remove the deleted source ref and remain active only if still justified.

### 8.3 Delete All Data

Delete all data must purge:

- `memory` records,
- memory summaries,
- memory job records,
- memory index records/embeddings,
- memory usage refs on messages if messages are also purged.

### 8.4 Retention

If user retention is 30 or 90 days:

- Thread summaries expire with their source thread.
- Atomic memories derived only from expired threads are invalidated or deleted unless pinned/manual.
- Manual memories remain until explicitly deleted, unless the user chooses full reset.

## 9. Safety Classifier Rules

Block automatic extraction for:

- API keys, tokens, passwords, private keys, connection strings.
- Payment card numbers and government IDs.
- Health, legal, financial, or biometric details unless explicit remember intent is present and product policy allows it.
- Content that appears to be about another private person unless clearly part of project context and non-sensitive.

Allow extraction for:

- Product/project facts.
- Tooling preferences.
- Communication/style preferences.
- Stable non-sensitive user preferences.
- User-authored custom instructions.

## 10. Manual QA Script

1. Enable memory in Settings.
2. Add a manual memory: "I prefer concise TypeScript examples."
3. Start a new thread and ask for a TypeScript example.
4. Verify the response is concise and shows Memory used.
5. Open Memory used, delete the memory.
6. Ask again in a new thread; verify no memory source and no concise preference unless otherwise justified.
7. Start a temporary chat and state a new preference.
8. Return to normal chat and verify the temporary preference is not used.
9. Export data and verify memory appears in export.
10. Delete all data and verify memory list is empty across reload/sign-in.
