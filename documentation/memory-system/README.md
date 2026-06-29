# Watai Memory System

This folder turns the memory placeholder in the product and data-model docs into an implementation-ready plan for Watai's full memory system. The goal is not merely to add "long-term memory"; it is to build a governed context layer that improves continuity, response quality, and task completion without slowing the app down or polluting prompts with stale history.

It answers four questions:

1. What are the current industry patterns for AI assistant memory systems?
2. Which parts of those patterns fit Watai's server-authoritative architecture?
3. What should the product, data model, retrieval path, extraction path, and user controls look like?
4. How do we implement and evaluate it without making memory a vague personalization feature or a slow history search feature?

## Recommended Direction

Watai should use a **hybrid, server-owned memory system** with explicit tiers:

- Keep **custom instructions** as explicit user-authored settings.
- Keep a compact, editable **memory summary** for user-visible review.
- Store extracted **atomic memories** as an additive collection of facts, preferences, work style, and durable user/project context.
- Store **thread summaries** as episodic memory for past work, not as raw whole-thread prompt stuffing.
- Treat recent thread history, uploaded files, generated artifacts, and tool results as **working context**, not permanent memory.
- Run memory extraction **after the assistant turn**, in a background queue, so send-to-first-token is not blocked by memory writing.
- Retrieve a small, source-linked **memory context block** before server generation and inject it into the server-run prompt.
- Show which memories influenced a response and give the user controls to correct, suppress, delete, export, and rebuild memory.

The most important architectural decision is that memory must move from today's local-only `MemoryItem` repository methods into the server-owned run path. The server is already responsible for generation; memory retrieval must live there too, otherwise closed-tab/server runs cannot use it reliably.

## System Stance

Memory in Watai is a **serving system**, not a passive database. Every run should get the narrowest useful context at the right time:

| Dimension | Target stance |
| --- | --- |
| Performance | Retrieval is on the hot path and must be bounded, observable, and fast. Extraction is never on the generation hot path. |
| Response quality | Memory should improve answers only when relevant; it must not cause the assistant to over-personalize every response. |
| Accuracy | Retrieved memories must be source-linked, time-aware, and suppressible/deletable. Contradictions invalidate old facts rather than silently overwriting them. |
| Memory width | Watai should remember across user preferences, work style, durable project context, past completed work, and thread summaries, while excluding temporary chats, secrets, and one-off noise. |
| User control | Users can inspect, edit, delete, suppress, pause, reset, import, export, and rebuild memory. Response-level sources show what was used. |

This means the MVP should be intentionally simple but not simplistic: start with Cosmos-backed records and deterministic lexical/entity/salience retrieval, then add embeddings or Azure AI Search only when evals show the simpler path is insufficient.

> **Update (2026-06):** Evals and a real session showed the deterministic regex/lexical path is insufficient (it silently dropped multi-turn personal facts). The decision direction has since evolved to **remove the regex gates entirely** — the mini extractor's own `ignore` output is the write decision, and an always-on capped profile plus embedding retrieval (with a similarity threshold) replaces the read gate. See [11-decoupled-memory-architecture.md](11-decoupled-memory-architecture.md).

## Documents

| Doc | Purpose |
| --- | --- |
| [memory-architecture.md](memory-architecture.md) | **Canonical architecture.** The absolute, final statement of the memory system: principles, record model, capture (write) path, serve (read) path with profile + relevance channels, retrieval scoring, Azure substrate, governance, and interfaces. |
| [memory-implementation-plan.md](memory-implementation-plan.md) | **Implementation plan + test framework.** PR-sized build slices (interfaces → capture → embeddings → relevance → profile → structuring → Cosmos vector → polish) with files, work, acceptance, EDD gates, the offline/live eval harness, fixtures, semantic-invariant claims, numeric regression targets, rollout flags, and the tuning loop. |
| [01-research-and-benchmarks.md](01-research-and-benchmarks.md) | Product patterns from ChatGPT, Claude, Gemini, LangGraph, Zep, Mem0, and MemGPT; benchmark landscape and lessons. |
| [02-watai-memory-spec.md](02-watai-memory-spec.md) | Product, architecture, data model, retrieval, extraction, API, privacy, and UI spec for Watai. |
| [03-implementation-plan.md](03-implementation-plan.md) | Phased implementation plan mapped to Watai's current frontend/backend files and Azure infrastructure. |
| [04-evaluation-and-governance.md](04-evaluation-and-governance.md) | Eval fixtures, metrics, regression gates, observability, privacy controls, and operational policy. |
| [05-memory-ux-spec.md](05-memory-ux-spec.md) | Build-ready Memory UX: settings IA, rows, detail views, response-level Memory Used panel, touch/mobile behavior, and acceptance checklist. |
| [06-api-and-schema-contracts.md](06-api-and-schema-contracts.md) | Exact wire/domain contracts: schemas, endpoints, store/service interfaces, message refs, settings migration, and API errors. |
| [07-retrieval-and-extraction-algorithms.md](07-retrieval-and-extraction-algorithms.md) | Deterministic MVP retrieval, scoring, budgeting, extraction, redaction, dedupe, invalidation, summary refresh, and feedback algorithms. |
| [08-build-slices-and-acceptance.md](08-build-slices-and-acceptance.md) | PR-sized implementation slices with touched files, work items, and acceptance criteria. |
| [09-background-extraction-system.md](09-background-extraction-system.md) | Implementation-ready design for the active asynchronous memory learner: triggers, queue jobs, LLM extraction contract, validation gates, apply semantics, and tests. |
| [10-structured-hierarchical-memory.md](10-structured-hierarchical-memory.md) | Directional architecture for profile-tree memory, typed temporal graph records, day/week/month buckets, structured retrieval, and migration from flat atomic evidence. |
| [11-decoupled-memory-architecture.md](11-decoupled-memory-architecture.md) | Decision record + research: remove regex gates (write = mini extractor's `ignore`; read = always-on capped profile + embedding RAG with a similarity threshold); critique vs MemGPT/Mem0/Generative Agents; Azure storage/retrieval options (in-proc cosine → Cosmos vector → AI Search). Supersedes the regex-gate + lexical MVP in doc 07. |

## What "Implementation-Ready" Means Here

Implementation-ready means a developer can build the feature without inventing product behavior, data semantics, or acceptance criteria. For this memory system, the docs must define:

- exact server ownership and run-worker integration points,
- exact record types, statuses, source refs, and deletion/suppression semantics,
- exact retrieval budgets, scoring inputs, fallback behavior, and telemetry,
- exact extraction timing, model-output contract, validation, and rejection rules,
- exact user-facing screens, copy, states, and controls,
- exact response-level transparency model for "Memory used",
- exact tests/evals that decide whether recall, precision, speed, deletion, temporary-chat behavior, and over-insertion are acceptable.

If any implementation choice would affect user trust, response quality, latency, or deletion/privacy behavior, it belongs in these specs before coding.

## Load-Bearing Requirements

- Memory is **opt-in and inspectable**. Users can see, edit, delete, suppress, import, export, pause, and reset it.
- Temporary chats **must not read or write memory**.
- Deleted or suppressed memory **must not be used in future runs**.
- Memory retrieval must produce **source references** that can be displayed under an assistant response.
- Extraction is **not on the generation hot path**. Retrieval is on the hot path, so it must be bounded, cached where useful, and observable.
- Watai must not store secrets, raw keys, hidden chain-of-thought, or unredacted sensitive values as memory.
- The system must support both **narrow precision** (only the right memories for the current turn) and **wide coverage** (preferences, facts, project context, past work, and thread summaries) through scoring and budgets, not prompt stuffing.
- Memory must be evaluated through behavior: recall, precision, latency, token cost, deletion leakage, temporary-chat leakage, contradiction handling, and abstention.

## Current Watai State

As of 2026-06-28:

- Manual memory CRUD is implemented with server-owned records and cloud-backed repository methods.
- Settings > Personalization has a memory manager for manual memories.
- Server runs retrieve active saved memories and persist response-level `memoryRefs`.
- Chat renders a Memory Used disclosure with Hide/Delete controls.
- The missing core capability is the active background learner: LLM-based extraction from every eligible turn. [09-background-extraction-system.md](09-background-extraction-system.md) is the implementation contract for that next slice.
