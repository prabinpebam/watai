# 07 — Retrieval And Extraction Algorithms

This document defines the deterministic first-pass algorithms for serving and writing memory. It exists so implementation does not drift into vague vector search or ad hoc prompt stuffing.

Cross-references: [02-watai-memory-spec.md](02-watai-memory-spec.md), [06-api-and-schema-contracts.md](06-api-and-schema-contracts.md), [04-evaluation-and-governance.md](04-evaluation-and-governance.md).

## 1. Retrieval Eligibility

```ts
function memoryEligibleForRun(input): boolean {
  if (!input.settings.personalization.memory?.enabled && !input.settings.personalization.memoryEnabled) return false;
  if (input.settings.personalization.memory?.paused) return false;
  if (input.thread.temporary) return false;
  if (input.run.prompt?.memory === 'off') return false;
  return true;
}
```

If ineligible, return:

```ts
{
  instructions: [],
  memories: [],
  threadSummaries: [],
  sourceRefs: [],
  tokenEstimate: 0,
  latencyBudgetMs: 250,
  retrievalMode: 'empty'
}
```

## 2. Build Context Algorithm

```ts
async function buildForRun({ userId, threadId, latestUserText, now, tokenBudget = 1200 }) {
  const start = clock.nowMs();
  if (!eligible) return emptyBlock('ineligible');

  const query = normalizeQuery(latestUserText);
  const cacheKey = hash(userId, threadId, query, settings.memoryVersion, memoryVersion);
  const cached = cache.get(cacheKey);
  if (cached && cached.ageMs < 120_000) {
    return filterDeletedSuppressed(cached.block);
  }

  const [summary, pinned, lexicalCandidates, threadSummaries] = await Promise.all([
    store.getSummary(userId),
    store.list(userId, { status: 'active', visibility: 'top_of_mind', limit: 30 }),
    store.list(userId, { status: 'active', q: query.lexical, limit: 150 }),
    store.list(userId, { status: 'active', kind: 'thread_summary', limit: 30 }),
  ]);

  const candidates = dedupeById([...pinned, ...lexicalCandidates, ...threadSummaries]);
  const scored = candidates
    .map(memory => ({ memory, score: scoreMemory(memory, query, now), reasons: scoreReasons(memory, query) }))
    .filter(x => x.score >= MIN_SCORE && isRetrievable(x.memory, now))
    .sort(byScoreThenRecencyThenId);

  const diversified = diversify(scored, SOURCE_CAPS);
  const block = trimToBudget({ summary, customInstructions, diversified }, tokenBudget);
  cache.set(cacheKey, block);
  emitTelemetry(block, clock.nowMs() - start);
  return block;
}
```

Failure rule: if storage/search fails, emit `memory_context_skipped` with reason and return an empty block. Do not fail the run.

## 3. Query Normalization

```ts
interface NormalizedQuery {
  raw: string;
  terms: string[];
  entities: string[];
  topics: string[];
  asksForPersonalization: boolean;
  asksAboutPastWork: boolean;
}
```

MVP implementation:

- Lowercase.
- Strip punctuation except path-like tokens and code identifiers.
- Remove stopwords.
- Keep product/project tokens such as `watai`, `azure`, `storybook`, `pdf`, `deploy`.
- Extract entities from capitalized/project-like tokens and known memory entities.
- Detect personalization intent through phrases such as `my preference`, `how do I usually`, `what did we decide`, `remember`, `last time`, `previously`.

## 4. Scoring

MVP score:

```text
score = lexical * 0.30
      + entity * 0.25
      + salience * 0.20
      + recency * 0.10
      + validity * 0.10
      + pinned * 0.05
```

### 4.1 Lexical

```ts
lexical = overlap(query.terms, memory.terms) / max(1, min(query.terms.length, memory.terms.length));
```

Boost exact phrase matches by `+0.15`, capped at `1.0`.

### 4.2 Entity

```ts
entity = overlap(query.entities, memory.entities) / max(1, query.entities.length);
```

If query has no entities but memory has project topics matching query terms, use topic overlap up to `0.6`.

### 4.3 Salience

Use stored `memory.salience`, clamped 0-1.

Defaults:

- manual memory: `0.8`
- extracted preference/work style: `0.7`
- project context: `0.75`
- thread summary: `0.55`
- background visibility: multiply by `0.7`

### 4.4 Recency

```ts
ageDays = daysBetween(memory.updatedAt ?? memory.createdAt, now)
recency = exp(-ageDays / 90)
```

Manual and pinned memories have a floor of `0.4`.

### 4.5 Validity

- `0` if status is not `active`.
- `0` if `validAt > now`.
- `0` if `invalidAt <= now`.
- `1` otherwise.

### 4.6 Pinned

- `1` if `pinned` or `visibility = 'top_of_mind'`.
- `0` otherwise.

Pinned never overrides validity.

## 5. Diversification And Caps

Default final caps:

```ts
const SOURCE_CAPS = {
  preference: 3,
  work_style: 3,
  project_context: 4,
  fact: 4,
  procedure: 2,
  avoidance: 2,
  thread_summary: 3,
  totalAtomic: 8,
  totalThreadSummaries: 3,
};
```

Algorithm:

1. Take pinned/top-of-mind records that pass threshold.
2. Add highest-scoring records by kind until per-kind caps are reached.
3. Prefer diverse source threads/messages when scores are close.
4. Never include two memories where one supersedes the other unless the prompt asks for history.
5. Stop at token budget.

## 6. Token Budgeting

Estimate token count as `ceil(chars / 4)` for MVP.

Budget order:

1. custom instructions,
2. relevant high-confidence avoidance/instruction memories,
3. relevant top atomic memories,
4. relevant thread summaries,
5. summary block if still useful and budget remains.

If budget is exceeded:

- Drop lowest score memories first.
- Then drop thread summaries.
- Then shorten summary to 300 chars.
- Never drop custom instructions due to memory budget; they are a separate settings budget.

## 7. Context Block Rendering

```text
Relevant memory context. Use only if relevant; current user message wins if it conflicts.

User summary:
...

Preferences and work style:
- [mem_1] User prefers direct implementation when requirements are clear.
- [mem_2] User wants UI claims verified with screenshots or DOM evidence.

Project context:
- [mem_3] Watai runs generation server-side in Azure Functions.

Relevant prior work:
- [thr_1] Storybook harness was added to make UI stories app-like.
```

Rules:

- Include ids only so response `memoryRefs` can map sources; tell the model not to reveal ids.
- Do not include suppressed/deleted/outdated text.
- Do not include source quotes in the model prompt unless needed; keep them for UI.

## 8. Extraction Triggering

Automatic extraction is queued after terminal assistant turns when:

- memory enabled and not paused,
- thread is not temporary,
- assistant status is `complete`,
- current turn window contains at least one user message,
- no extraction job for the same assistant message exists.

Do not enqueue on `error` or `interrupted` unless the interruption still completed a durable user-confirmed action.

Manual remember/forget commands bypass queue delay for user-visible effect.

## 9. Extraction Window

Use a bounded window:

- latest user message,
- latest assistant message,
- previous 2 user/assistant pairs,
- relevant memory candidates from `MemoryContextBlock`,
- thread metadata and temporary flag.

Do not send full thread history to the extractor.

## 10. Extraction Prompt Contract

System instruction:

```text
You extract durable memory candidates for Watai. Store only useful future context.
Do not store secrets, credentials, one-off requests, private third-party details, or emotion guesses.
Prefer source-linked, concise memories. Current user statements can invalidate older memories.
Return strict JSON only.
```

JSON schema:

```ts
interface MemoryExtractionOutput {
  memories: Array<{
    operation: 'add' | 'suppress' | 'invalidate';
    kind: Exclude<MemoryKind, 'thread_summary' | 'entity'>;
    text: string;
    entities?: string[];
    topics?: string[];
    confidence: number;
    salience: number;
    validAt?: string;
    supersedes?: string[];
    sourceMessageIds: string[];
    reason: string;
  }>;
}
```

Validation rejects:

- unknown fields,
- missing source message ids for automatic add/invalidate,
- `confidence < 0.65`, except explicit manual remember,
- secret-like values,
- text over 2,000 chars,
- unsupported kind.

## 11. Redaction And Sensitive Rejection

Reject automatic memory if text matches:

- API keys/tokens: `sk-`, `eyJ`, `Bearer `, Azure connection strings, private key blocks.
- Password phrases: `password is`, `passphrase is`, `secret is`, `token is`.
- Payment/government IDs.
- Health/legal/financial/biometric details without explicit remember intent.

For manual remember of sensitive categories:

- reject secrets outright,
- allow non-secret sensitive preferences only after explicit confirmation in the UI once product policy supports it.

## 12. Deduplication

Dedup key:

```ts
sourceHash = sha256(normalizedText + kind + sortedEntities.join('|'))
```

If a candidate matches an active memory:

- Add source ref if new.
- Update `updatedAt`, `confidence = max`, `salience = max`.
- Do not create a duplicate.

If candidate contradicts an active memory:

- Store new memory.
- Set old `status = invalidated`, `invalidAt = now`, `supersededBy = newId`.
- Set new `supersedes = [oldId]`.

Contradiction detection MVP:

- same entity/topic,
- mutually exclusive value or explicit correction phrase,
- extractor marks `supersedes`,
- service validates source ids and old record ownership.

## 13. Summary Refresh

Refresh summary when:

- >= 5 active memories changed since last summary,
- summary is older than 7 days and new memory exists,
- user explicitly clicks Refresh summary,
- rebuild/import completes.

Summary prompt consumes active top-of-mind/normal memories and produces <= 1,200 chars. It must not include deleted/suppressed memories.

## 14. Feedback Loop

When user marks a memory as not relevant from Memory Used:

1. Persist feedback event: `memory_feedback` with memory id, response id, action.
2. Do not delete memory.
3. Reduce retrieval score for similar query fingerprints.
4. Show feedback in Memory detail history.

This is a post-MVP scoring improvement, but the schema should allow feedback events early.

## 15. Algorithm Acceptance

- Temporary threads produce empty context and no extraction job.
- Deleted/suppressed memories score 0 and never appear in prompt context.
- Query with no relevant memory returns empty atomic memory list.
- Contradictory current user message overrides retrieved memory in answer behavior.
- Retrieval returns within budget under synthetic 500-memory fixture.
- Extraction rejects secrets and one-off requests.
- Manual remember writes are immediately listable and retrievable.