# Watai Long-Term Memory

This folder turns the memory placeholder in the product and data-model docs into an implementation-ready plan. It answers four questions:

1. What are the current industry patterns for long-term memory in AI assistants?
2. Which parts of those patterns fit Watai's server-authoritative architecture?
3. What should the product, data model, retrieval path, and user controls look like?
4. How do we implement and evaluate it without making memory a vague personalization feature?

## Recommended Direction

Watai should use a **hybrid, server-owned long-term memory system**:

- Keep **custom instructions** as explicit user-authored settings.
- Keep a compact, editable **memory summary** for user-visible review.
- Store extracted **atomic memories** as an additive collection of facts, preferences, work style, and durable user/project context.
- Store **thread summaries** as episodic memory for past work, not as raw whole-thread prompt stuffing.
- Run memory extraction **after the assistant turn**, in a background queue, so send-to-first-token is not blocked by memory writing.
- Retrieve a small, source-linked **memory context block** before server generation and inject it into the server-run prompt.
- Show which memories influenced a response and give the user controls to correct, suppress, delete, export, and rebuild memory.

The most important architectural decision is that memory must move from today's local-only `MemoryItem` repository methods into the server-owned run path. The server is already responsible for generation; memory retrieval must live there too, otherwise closed-tab/server runs cannot use it reliably.

## Documents

| Doc | Purpose |
| --- | --- |
| [01-research-and-benchmarks.md](01-research-and-benchmarks.md) | Product patterns from ChatGPT, Claude, Gemini, LangGraph, Zep, Mem0, and MemGPT; benchmark landscape and lessons. |
| [02-watai-memory-spec.md](02-watai-memory-spec.md) | Product, architecture, data model, retrieval, extraction, API, privacy, and UI spec for Watai. |
| [03-implementation-plan.md](03-implementation-plan.md) | Phased implementation plan mapped to Watai's current frontend/backend files and Azure infrastructure. |
| [04-evaluation-and-governance.md](04-evaluation-and-governance.md) | Eval fixtures, metrics, regression gates, observability, privacy controls, and operational policy. |

## Load-Bearing Requirements

- Memory is **opt-in and inspectable**. Users can see, edit, delete, suppress, import, export, pause, and reset it.
- Temporary chats **must not read or write memory**.
- Deleted or suppressed memory **must not be used in future runs**.
- Memory retrieval must produce **source references** that can be displayed under an assistant response.
- Extraction is **not on the generation hot path**. Retrieval is on the hot path, so it must be bounded, cached where useful, and observable.
- Watai must not store secrets, raw keys, hidden chain-of-thought, or unredacted sensitive values as memory.

## Current Watai State

As of 2026-06-27:

- Product/data docs mention memory as optional personalization.
- The frontend has `Settings.personalization.memoryEnabled` and a Settings toggle.
- `Repository` exposes `listMemory`, `addMemory`, and `removeMemory`.
- `LocalRepository` stores memories locally in IndexedDB key-value storage.
- `SyncRepository` explicitly keeps memory local because there are no server endpoints.
- Server runs are now the architectural direction, so this local-only memory layer is insufficient for durable cross-device personalization.

The implementation plan treats existing local memory as a migration source, not the final architecture.
