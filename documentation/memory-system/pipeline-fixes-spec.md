# Memory Pipeline — Audit, Spec & Fix Plan

Status: in build. This document records the evidence-based audit of the live memory failures
reported after the first deploy, and the spec for the fixes. It complements
[memory-architecture.md](memory-architecture.md) (the target architecture) and
[memory-implementation-plan.md](memory-implementation-plan.md).

---

## 1. Audit (evidence from the live dev system)

The deployed system was inspected directly (Cosmos data + real embedding latency + settings).

### 1.1 Retrieval returns nothing — PRIMARY BUG
The vector read path makes a **network embedding call** for the query, then ranks. But the run
worker wraps the whole build in a tight timeout:

```
const DEFAULT_MEMORY_CONTEXT_BUDGET_MS = 250;            // runWorker.ts
memoryBlock = await withTimeout(buildForRun(...), 250, emptyMemoryBlock());
```

Measured query-embedding latency against the real endpoint:

| call | latency |
| --- | --- |
| cold | **7552 ms** |
| warm | 1713 ms / 1655 ms / 726 ms |

Every call exceeds 250 ms, so `withTimeout` **always** returns the empty block → retrieval is
silently disabled. The 250 ms budget was correct for the *old in-memory lexical* path (no network);
it is wrong for the vector path.

Everything downstream is healthy (verified):
- The 2 active memories carry valid `text-embedding-3-small` 1536‑dim embeddings.
- Cosine on real data: "How old is my daughter?" → Laija 0.504; "what's my dog's name?" → Chopper 0.398.
- Settings gate is open: `memoryEnabled=true` ⇒ `effectiveMemorySettings` derives `referenceSaved=true`.

### 1.2 Relevance floor slightly too high
Real cosine for a paraphrase: "tell me about my pet" → dog **0.286**, below the **0.30** floor →
missed. Unrelated ("capital of France") scores ~0.04, so there is headroom to lower the floor.

### 1.3 Transient no-embedding memory
A "Laija … 9 years old" record was written at 20:04 **without an embedding** (during the deploy
window), superseded by an embedded copy at 20:06. A record stored without an embedding is
permanently unretrievable (vector-only, no backfill, no retry).

### 1.4 "Memory updated" shows at the wrong turn
The `memory` SignalR event payload is `{ jobId, threadId, kind, acceptedCount, updatedAt }` — it has
**no source message id**. The client stores notices per **thread** (`memoryNotices[threadId]`) and
renders them in the timeline by `updatedAt`. A late-completing extraction lands at the wrong
position (or appears to belong to a later turn). This also explains the *perceived* "extraction was
dropped" — each completed turn does enqueue a unique job (`dedupeKey = memory-turn:<assistantId>`),
so jobs are not dropped; the notice is just mis-anchored.

### 1.5 Chat outruns the async pipeline
Extraction + embedding is a background queue job (seconds). A fact asked about immediately after it
is stated — in a *new* thread — may not be embedded yet. Within the *same* thread this is moot (the
fact is already in the conversation history). This is inherent to async capture; the fix is speed +
reliability + visibility, not blocking chat.

---

## 2. Spec

### Fix A — Make vector retrieval fit the hot path (1.1)
1. Raise the memory-context budget so a normal embed fits: `DEFAULT_MEMORY_CONTEXT_BUDGET_MS = 3000`.
2. Give the read-path query embed its own bounded timeout (~2500 ms) and abort cleanly on exceed, so a cold/slow endpoint fails open to empty rather than hanging.
3. **Parallelize**: kick off `buildForRun` early in the run and `await` it just before the system prompt is assembled, so the embed latency overlaps the other run setup (skills, history) instead of adding serially.
4. Reuse a keep-alive HTTP connection for the embedder so warm calls stay ~0.7–1.5 s (avoids repeated TLS cold cost).

### Fix B — Lower the relevance floor (1.2)
`RELEVANCE_FLOOR 0.30 → 0.25`. Catches paraphrases (0.286) while still rejecting unrelated (~0.04)
and the weak cross-topic match (daughter-on-dog-query 0.201). Re-validated by the real-embedding
retrieval eval.

### Fix C — Embedding reliability (1.3)
1. Retry the write-time embed once on failure before persisting without a vector.
2. **Opportunistic backfill**: when the worker processes a user's job, also embed any of that user's active memories missing a current-model embedding (bounded batch). Self-heals transient failures and pre-rollout records, using the user's own credentials.
3. Observability: log embed failures and retrieval outcomes (candidate count, embedded count, top score, mode) so the live system is diagnosable.

### Fix D — Correct notice attribution (1.4)
1. Add `assistantMessageId` (the source turn) to the `memory` SignalR event.
2. Client: store the notice keyed to that message id and render "Memory updated" anchored to that specific assistant message, not the thread tail.

### Non-fix — Async timing (1.5)
Accept eventual consistency. Fix C+A make it fast and reliable; Fix D makes "saved" visible at the
right turn. Within-thread recall is already covered by conversation history.

---

## 3. Validation
- **Unit**: budget/parallel build, floor selection on stub vectors, event payload carries the message id, embed-retry, backfill.
- **Eval (real embeddings)**: extend the retrieval corpus with paraphrase cases (e.g. "tell me about my pet"); assert recall at the new floor; confirm negatives still rejected. Re-run `npm run eval`.
- **Live**: re-run the on-data retrieval probe; after deploy, confirm a cross-thread question returns the fact.

## 4. Rollout
Backend (surgical app settings unchanged) + frontend (Pages). Flags and rollback tags from the
prior deploy remain valid. Backfill runs opportunistically post-deploy.
