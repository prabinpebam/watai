# Watai Memory — Implementation Plan & Test Framework

This plan builds the system defined in [memory-architecture.md](memory-architecture.md). Work is
cut into PR-sized slices. Each slice leaves the product in a coherent, shippable state and merges
only when its **EDD gate** — an automated check that proves a *product claim*, not just that code
runs — is green. Backend slices precede the frontend changes that depend on them.

Conventions follow [../05-execution-plan.md](../05-execution-plan.md) §6 (eval-driven testing) and
the slice format in [08-build-slices-and-acceptance.md](08-build-slices-and-acceptance.md).

---

## 1. Build order

| Slice | Outcome | Product claim the EDD gate proves |
| --- | --- | --- |
| 0 | Embedder + retriever interfaces, config, flags | Scaffolding compiles; no behavior change |
| E | Eval harness (`.env`-driven) + labeled prompt corpus | The corpus runs against the real models and reports per-category metrics |
| 1 | Capture: one lane + mechanical hygiene guard | A durable fact spread over short, keyword-free turns is captured |
| 2 | Embeddings written on persist + backfill | Every active memory carries a current-model vector |
| 3 | Serve: relevance channel (vector + scoring) | A paraphrased query recalls the right memory with no lexical overlap |
| 4 | Serve: always-on profile channel | Identity facts are in scope every turn; sensitive ones never are |
| 5 | Structuring from typed fields | Profile placement comes from `route`/`kind`, not prose parsing |
| 6 | Cosmos vector substrate (scale path) | Retrieval is identical behavior on the Cosmos retriever |
| 7 | Governance & observability polish | Attribution, cache invalidation, controls verified end-to-end |

**Slice E lands first** — it is the test substrate every gate below runs against. Slices 1–4 then
deliver the working system; 5 removes the last prose-parsing; 6 is the scale swap; 7 is hardening.
Each is independently revertible behind a flag (Slice 0).

---

## 2. Slices

### Slice 0 — Interfaces, config, flags (no behavior change)

**Goal:** introduce the seams the rest of the plan plugs into, with zero runtime change.

**Files**
- `api/src/ports/embedder.ts` *(new)* — `interface Embedder { embed(text: string): Promise<number[]>; readonly model: string; }`
- `api/src/ports/memoryRetriever.ts` *(new)* — `interface MemoryRetriever { retrieve(userId, queryEmbedding, opts): Promise<ScoredMemory[]> }`
- `api/src/ai/azureEmbedder.ts` *(new)* — Azure OpenAI embeddings client (uses `DecryptedCredentials.baseUrl`/`key`, deployment from `MEMORY_EMBED_MODEL`).
- `api/src/domain/appConfig.ts` — add admin flags `memoryRetrieval: 'lexical' | 'vector'` (default `lexical`) and `memoryProfile: boolean` (default `false`).
- `api/src/domain/memory.ts` — extend `memoryContextBlockSchema.retrievalMode` enum with `'vector'` and `'profile'`.
- `infra/main.bicep` — add `MEMORY_EMBED_MODEL` app setting (parameterized).
- `api/src/composition.ts` — construct the embedder; leave it unwired.

**Work**
- Define the two ports and the Azure embedder; unit-test the embedder against a recorded fixture.
- Add the flags to app config + admin view; default to current behavior.
- Widen the context-block schema enum.

**Acceptance / tests**
- Typecheck passes; no existing test changes behavior.
- `azureEmbedder.test.ts`: returns a fixed-length numeric vector for a fixture; maps non-200 to a normalized error.
- `memory.test.ts`: `retrievalMode: 'vector'` and `'profile'` now parse; unknown still rejected.
- App-config tests: new flags default to `lexical`/`false`.

---

### Slice E — Eval harness & prompt corpus (foundation)

**Goal:** the `.env`-driven live harness and the labeled prompt corpus that every later slice's gate
runs against. Built before Slice 1 so the gates exist when capture and serve land.

**Files**
- `api/scripts/memory-eval.ts` *(new)* — staged runner (capture / retrieval / profile / answer); loads `api/.env`; stratified sampling; repeats; θ sweep; cost ceiling; writes reports.
- `api/scripts/eval/corpus/**` *(new)* — versioned labeled corpus (target ≥ 400 cases, dotted taxonomy).
- `api/scripts/eval/metrics.ts` *(new)* — confusion matrix, recall@K, MRR/nDCG, flip-rate, token/$ cost.
- `api/scripts/eval/judge.ts` *(new)* — deep-model LLM-judge with a versioned rubric.
- `api/package.json` — `eval`, `eval:capture`, `eval:retrieval`, `eval:profile` scripts.

**Work**
- Build the loader/runner around the `.env` keys in §3.2 (stratified sample, repeats, θ sweep, hard cost cap).
- Author the canonical case per leaf category; expand with deep-model-generated paraphrase/edge variants (token spend expected); curate a reviewed sample; freeze the golden baseline.
- Emit per-case JSONL + Markdown/JSON summaries under `documentation/memory-system/eval-runs/<timestamp>/`.

**Acceptance / tests**
- `npm run eval -- --stage capture --sample 5` runs against the `.env` models and writes a report.
- `metrics.ts` is unit-tested on synthetic outcomes (known confusion matrix → known recall/precision).
- The runner aborts cleanly at `WATAI_EVAL_MAX_USD` and is reproducible under a fixed `WATAI_EVAL_SEED`.
- Corpus schema is validated: every case has `id`, `category`, `difficulty`, `expect`, and `why`.

---

### Slice 1 — Capture: one lane + hygiene guard

**Goal:** the write decision is the extractor's output; one background call per completed exchange.

**Files**
- `api/src/application/memoryExtractionService.ts` — `enqueueAfterMessage` enqueues a **turn** job only (drop the command lane); remove `hasExtractionSignal` from `enqueueTurn`/`enqueueCommand`; add `isTrivialWindow()` mechanical guard.
- `api/scripts/memory-pipeline-probe.ts` — update to reflect the gate's removal (decision stage = extractor `ignore`).

**Work**
- Replace the regex gate with a **mechanical** guard only: skip when the window is empty, a single ≤ N-char token, or byte-identical to the previously processed window (dedupe key already exists). No semantic judgement.
- Collapse to the single assistant-turn lane; keep the existing `applyOperations` thresholds, `sourceHash` dedup, supersession, and the `memory` SignalR event.
- Keep `mode: 'turn'` extraction with the ≤5-message window and the active-memory context.

**Acceptance / tests**
- `memoryExtractionService.test.ts`:
  - A two-message, keyword-free fixture ("I got a dog also." / "His name is Chopper, a Lhasa Apso.") with a stub extractor returning an `add` → **one** active `fact` memory is created.
  - A trivial window ("ok", "thanks") → no extractor call, job completes `ignored`.
  - Re-processing the same window is idempotent (dedupe key + `sourceHash`).
  - Only one job per exchange is enqueued (no duplicate command+turn notices).
- **EDD gate (capture):** the keyword-free multi-turn fixture yields the memory.

---

### Slice 2 — Embeddings on write + backfill

**Goal:** every active memory carries a current-model embedding.

**Files**
- `api/src/application/memoryExtractionService.ts` — inject `Embedder`; compute and store `embedding` + `embeddingModel` on `add` and on `merge` (text changes).
- `api/src/application/memoryService.ts` — embed on manual create/edit.
- `api/src/functions/` — a `memoryBackfill` admin-triggered job that embeds active records lacking a current-model vector (batched, idempotent).
- `api/src/composition.ts` — wire the embedder into both services.

**Work**
- Embed at persist; never block the write on embedding failure — store the record and mark it for backfill if embedding fails.
- Backfill walks active records where `embeddingModel != MEMORY_EMBED_MODEL`, re-embeds in batches.

**Acceptance / tests**
- On `add`/`merge`, the stored record has a vector of the embedder's dimension and the right `embeddingModel`.
- Embedder failure still persists the record (vector absent), and backfill later fills it.
- Backfill is idempotent and skips already-current vectors.

---

### Slice 3 — Serve: relevance channel

**Goal:** retrieval is semantic; the retrieve decision is a similarity floor.

**Files**
- `api/src/application/memoryContextService.ts` — replace `shouldConsiderMemory` + `lexicalScore` with: embed query → `MemoryRetriever.retrieve` → floor → composite rank. Set `retrievalMode: 'vector'`.
- `api/src/adapters/memory/inProcessRetriever.ts` *(new)* — cosine over `store.list({status:'active'})`.
- `api/src/composition.ts` — inject embedder + in-process retriever into `MemoryContextService` (line ~145); gate on the `memoryRetrieval` flag (fallback to the existing lexical path while `lexical`).

**Work**
- Candidate floor: `relevance ≥ θ_rel`; `pinned`/`top_of_mind` bypass; `background`/`suppressed` demoted/excluded.
- Composite score `w_r·relevance + w_i·importance + w_t·recency` (§3.8 targets); take top K within the token budget.
- Bounded + fail-open: the embed call has its own timeout and returns an empty block on timeout/error; the in-proc scoring stays within the 250 ms budget.

**Acceptance / tests**
- `memoryContextService.test.ts` (stub embedder, fixed vectors):
  - A query whose vector is near a seeded memory and far from others selects only that memory (ranking math).
  - An off-topic query (all below floor) returns an empty block — **no forced personalization**.
  - `pinned`/`top_of_mind` selected even below floor; `suppressed` never selected.
  - Embedder throw/timeout → empty block, `latencyBudgetMs` respected, no exception escapes.
- **EDD gate (retrieval, live):** the "what's my pup's name?" query recalls the Chopper memory with no shared tokens.

---

### Slice 4 — Serve: always-on profile channel

**Goal:** identity is in scope every run; sensitive facts never auto-injected.

**Files**
- `api/src/application/memoryContextService.ts` — prepend a bounded profile block on **every** run (gated by `memoryProfile` flag), independent of the relevance channel; add `retrievalMode: 'profile'` when only the profile contributes.
- `api/src/domain/memoryProfile.ts` — render a token-capped profile string from the structured view; exclude `sensitive`.
- `api/src/application/memoryProfileCache.ts` *(new)* — per-user cached render; invalidated by the capture `memory` event.
- `api/src/composition.ts` — wire the cache; invalidate on the memory event path.

**Work**
- Profile carries identity `fact`s, `instruction`s, `avoidance`s, durable `preference`s, current `project_context`; hard token cap (§3.8).
- Cache keyed by `userId` + memory `updatedAt` watermark; rebuilt on write event.
- `sensitive` records are excluded from the profile render unconditionally.

**Acceptance / tests**
- With profile on, **every** `buildForRun` (including an unrelated query) includes the identity facts up to the cap.
- A `sensitive` memory never appears in the profile render; it can still surface via the relevance channel.
- Cache returns the same render until a write event bumps the watermark, then rebuilds.
- Profile + relevance together stay within the combined token budget.
- **EDD gate (profile):** identity present every turn; sensitive absent from profile.

---

### Slice 5 — Structuring from typed fields

**Goal:** profile placement derives from typed `route`/`kind`/`entities`, never from parsing text.

**Files**
- `api/src/ai/memoryExtractor.ts` — strengthen the contract so `add`/`merge` reliably carry a `route` (layer / profilePath / entity / relationship / temporal).
- `api/src/domain/memoryProfile.ts` — assemble the tree from `route`/`kind`/`entities`; **remove** the prose regexes (`extractPet`, `extractInspirations`, …).
- `api/src/application/memoryExtractionService.ts` — persist `route` on `add` (already supported via `op.target`).

**Work**
- Assembly switches on structured fields; an unrouted legacy record falls back to a flat "facts" node (no regex).
- Backfill (Slice 2 job, extended) can re-route legacy records via the deep tier on rebuild.

**Acceptance / tests**
- A record with a structured `route` lands in the expected profile node with **no** text parsing involved.
- Removing the regexes does not change placement for routed fixtures.
- A legacy unrouted record appears under the flat fallback, never mis-parsed.
- **EDD gate (structuring):** profile tree for a routed fixture set matches expected paths with the regex code deleted.

---

### Slice 6 — Cosmos vector substrate (scale path)

**Goal:** the same retrieval behavior, served by Cosmos integrated vector search.

**Files**
- `infra/main.bicep` / provisioning — enable `EnableNoSQLVectorSearch`; container vector policy (`/embedding`, `float32`, dims, `cosine`).
- `api/src/adapters/cosmos/vectorRetriever.ts` *(new)* — `VectorDistance()` query filtered by `userId`/`status`, `TOP K`.
- `api/src/composition.ts` — select retriever impl by config; default stays in-process.

**Work**
- Implement the `MemoryRetriever` contract over Cosmos; identical inputs/outputs to the in-process impl.
- Behind config; flip per environment after parity passes.

**Acceptance / tests**
- Contract test runs the **same** retrieval eval set against both retrievers; selected ids/order match within tolerance.
- Query uses `TOP K` + partition filter (no full-container scans).

---

### Slice 7 — Governance & observability polish

**Goal:** controls and transparency verified end-to-end.

**Files**
- `src/features/chat/Message.tsx` / memory-used strip — show profile vs retrieved provenance.
- `src/features/settings/Settings.tsx` — pause/suppress/delete/rebuild reflect in serving immediately.
- `api/src/application/memoryContextService.ts` — record the used block (ids, scores) for inspection.

**Work**
- Surface attribution for both channels; ensure suppression/deletion excludes from both immediately.
- Emit per-run memory-used telemetry for the tuning loop.

**Acceptance / tests**
- Deleting/suppressing a memory removes it from profile and retrieval on the next run.
- Pausing memory yields an empty block on both channels.
- Each served memory is source-linked in the UI.

---

## 3. Validation & test framework

The bar is **proving the product behaves across a wide, adversarial range of real phrasings** — not a
handful of happy-path fixtures. Memory quality is model-dependent and non-deterministic, so the
**live harness driven by `api/.env` is the primary quality gate**; offline stub tests only guard the
deterministic plumbing. Spending tokens on a large live corpus, run repeatedly, is expected and
budgeted.

### 3.1 Test layers

| Layer | Tooling | Proves | When |
| --- | --- | --- | --- |
| Unit | Vitest | scoring math, cosine, hygiene guard, cache watermark, schema | PR |
| Service (stubbed) | Vitest + in-memory store + stub embedder/extractor | capture apply, selection, profile render — deterministic | PR |
| Offline eval | Vitest + fixed stub vectors | ranking/selection plumbing | PR |
| **Live eval (primary)** | `tsx` harness + `api/.env` real models | semantic capture/retrieval/profile quality across the full corpus | nightly + pre-flip |
| Contract | schema tests | record / context block / retriever parity | PR |
| Integration | mocked run path | block injected; failure is fail-open | PR |
| Red-team / safety | live + Vitest | injection, secrets, sensitive containment, IDOR | nightly + PR subset |

Offline tests (deterministic stub embedder mapping known phrases to fixed vectors) prove the
*ranking and selection math* in CI with no network. Only the live harness proves the *semantic*
claims ("pup" recalls "dog"; casual multi-turn fact is captured; chit-chat is ignored) that depend
on the real model.

### 3.2 `.env`-driven live harness

A single runner (`api/scripts/memory-eval.ts`, evolving the existing
[probe](../../api/scripts/memory-pipeline-probe.ts)) loads `api/.env` and exercises the **real**
pipeline end-to-end. It reads:

| Var | Purpose |
| --- | --- |
| `WATAI_PROBE_BASEURL` | Azure AI Foundry inference endpoint (`…/openai/v1`) |
| `WATAI_PROBE_KEY` | API key (secret; gitignored, never committed) |
| `MEMORY_MODEL` / `WATAI_PROBE_MINI_MODEL` | routine extractor under test |
| `MEMORY_DEEP_MODEL` / `WATAI_PROBE_FULL_MODEL` | reconcile + LLM-judge model |
| `MEMORY_EMBED_MODEL` | embeddings deployment for retrieval |
| `WATAI_EVAL_CORPUS` | corpus path (default `api/scripts/eval/corpus/`) |
| `WATAI_EVAL_SAMPLE` | `all` or N (stratified by category) |
| `WATAI_EVAL_REPEAT` | runs per case (default 3) to measure stability |
| `WATAI_EVAL_SEED` | sampling seed for reproducibility |
| `WATAI_EVAL_THETA_SWEEP` | floor sweep, e.g. `0.15:0.45:0.05` |
| `WATAI_EVAL_MAX_USD` | hard cost ceiling; the run aborts when exceeded |
| `WATAI_EVAL_CATEGORIES` | optional category filter |

Stages, each runnable standalone and each emitting per-case JSONL + a Markdown/JSON summary under
`documentation/memory-system/eval-runs/<timestamp>/`:

- **capture** — run each conversation fixture through the real extractor + `applyOperations`; record predicted operations and final store state.
- **retrieval** — embed seeded memories with the real model, embed the query, run the retriever; record selected/excluded ids + scores.
- **profile** — build and render the profile; record included paths and sensitive exclusion.
- **answer** (optional, judged) — run a full chat turn with the injected block; the LLM-judge decides whether the answer actually used the memory.

Tokens in/out, `$`, and p50/p95 latency are tracked per call and totalled; repeats yield a per-case
flip-rate that exposes model nondeterminism.

### 3.3 The prompt corpus

A large, versioned, stratified corpus under `api/scripts/eval/corpus/` (target **≥ 400 labeled
cases**, growing). It supersedes the inline probe corpus. Each case:

```jsonc
{
  "id": "cap-pet-0007",
  "category": "capture.identity.pet",      // dotted taxonomy
  "difficulty": "hard",                     // easy | medium | hard | adversarial
  "locale": "en",
  "conversation": [                          // 1..n turns; multi-turn is first-class
    { "role": "user", "content": "we finally caved and got a little guy" },
    { "role": "assistant", "content": "congrats! tell me about him" },
    { "role": "user", "content": "he's a lhasa apso, we went with Chopper" }
  ],
  "seedMemories": [ /* prior state for reconcile / retrieval cases */ ],
  "expect": { "op": "add", "kind": "fact", "entity": "pet", "mustContain": ["Chopper", "Lhasa Apso"] },
  "query": "what's my pup called?",          // retrieval expectation (when applicable)
  "expectRetrieved": ["mem_dog"],
  "expectExcluded": ["mem_car", "mem_job"],
  "why": "multi-turn, no my-keyword, breed split across turns"
}
```

Coverage (minimum target counts; expand over time):

| Bucket | Cases | What it stresses |
| --- | --- | --- |
| `capture.identity.*` | 80 | name, nickname, age, location, job/employer, family (spouse, children w/ names+ages), pets (name/breed), health/allergies, vehicles — each in explicit / casual / indirect / multi-turn / typo phrasings |
| `capture.preference.*` | 40 | comms style, language/locale, formatting, tools/stack, food, design |
| `capture.instruction.*` | 25 | "always / never / from now on / going forward" directives |
| `capture.avoidance.*` | 15 | "don't / avoid / stop doing X" |
| `capture.project.*` | 25 | repos, deploy targets, stack, current focus, deadlines |
| `capture.procedure.*` | 10 | "the way I do X" |
| `capture.negative.*` | 90 | chit-chat, greetings, one-off task requests, hypotheticals, jokes, **third-party** facts, transient formatting, questions-with-entities, pasted examples, speculation |
| `capture.reconcile.*` | 40 | new-detail→merge, contradiction→invalidate, repeat→dedup, refinement, status-change-over-time |
| `capture.safety.*` | 30 | secrets/keys/passwords→reject, sensitive PII→reject/flag, **prompt injection**, third-party private data |
| `retrieval.positive.*` | 60 | paraphrase, synonym, indirect reference, multi-hop, temporal, **cross-session** |
| `retrieval.negative.*` | 50 | off-topic with distractors present, generic-knowledge questions, lexical false-friends |
| `robustness.*` | 35 | very long / very short / emoji-only / code blocks / mixed-language / unicode / role-play attempts |

**Construction:** hand-author the canonical case per leaf category, then **use the deep model to
generate paraphrase and edge variants at scale** (token spend is expected here), curate a reviewed
sample, and freeze it as the golden set. The corpus is versioned; every addition carries a label and
`why`.

### 3.4 Metrics

Reported per stage and broken down **per category and per difficulty** — an aggregate average hides
the buckets that fail:

- **Capture:** operation confusion matrix (predicted vs expected across add / merge / invalidate / suppress / ignore / reject), kind accuracy, entity match, dedup correctness, reject rate on `capture.safety.*`, precision (no junk adds) and recall (no missed durable facts).
- **Retrieval:** recall@1/3/5, MRR, nDCG@5, distractor-rejection rate, false-inject rate on `retrieval.negative.*`.
- **Profile:** identity-coverage rate, **sensitive-leak rate (must be 0)**, token-cap adherence.
- **Stability:** per-case flip-rate across `WATAI_EVAL_REPEAT`; cases that flip pass/fail are flagged.
- **Cost / latency:** tokens, `$`, p50/p95 per stage, and total run cost.

### 3.5 Calibration (θ and weights from data)

The relevance floor `θ_rel` and the score weights are **chosen from the sweep, not guessed**. The
retrieval stage runs across `WATAI_EVAL_THETA_SWEEP`, emits a precision/recall curve per category,
and recommends the operating point that meets the §3.8 targets at the best precision. Weights
`w_r / w_i / w_t` are swept on a coarse grid. Chosen values are written into config and the curve is
archived with the run.

### 3.6 LLM-as-judge (only where deterministic checks can't reach)

Prefer deterministic assertions (operation type, memory id present, entity / `mustContain` match).
For the fuzzy "did the answer actually *use* the memory?" claim, the **deep model judges** with a
strict pass/fail rubric and a returned reason. Judge prompts are versioned and spot-checked against a
human-labeled subset; judge disagreement above a threshold fails the run — the judge is itself under
test.

### 3.7 Golden baseline & regression diffing

Each live run's per-case outcomes are diffed against the committed golden baseline. A case flipping
pass→fail beyond the stability noise band is a **regression** and blocks the flag flip / merge; net
improvements update the baseline by PR. This catches silent quality drops from prompt, threshold, or
model changes.

### 3.8 Numeric targets

Asserted by the harness, **per category** so a strong average cannot mask a weak bucket.

| Metric | Target |
| --- | --- |
| Capture recall — durable facts (per `capture.identity.*` sub-bucket) | ≥ 0.90 |
| Capture precision — no junk adds | ≥ 0.88 |
| Ignore accuracy — `capture.negative.*` | ≥ 0.90 |
| Reconcile op accuracy — `capture.reconcile.*` | ≥ 0.85 |
| Safety reject rate — `capture.safety.*` | = 1.00 |
| Retrieval recall@3 — `retrieval.positive.*` | ≥ 0.90 |
| False-inject rate — `retrieval.negative.*` | ≤ 0.08 |
| Profile sensitive-leak rate | = 0.00 |
| Per-case flip-rate (stability) | ≤ 0.10 |
| Read path (in-proc scoring) | p95 ≤ 250 ms |
| Query embedding call | timeout ≤ 600 ms, fail-open |
| Token caps | profile ≤ 600, relevance ≤ 400 (top 3) |
| Starting `θ_rel` / weights (pre-calibration) | 0.30 cosine / 0.60·0.25·0.15 |

### 3.9 Semantic invariants (named hard gates)

These specific claims are drawn from the corpus and must always pass:

| # | Claim | Corpus case | Assertion | Gate |
| --- | --- | --- | --- | --- |
| 1 | Keyword-free multi-turn fact is captured | `capture.identity.pet/dog-no-keyword` | one active `fact` after the turn | Slice 1 |
| 2 | Paraphrase recall, no lexical overlap | `retrieval.positive/pup-name` | Chopper memory in top-K | Slice 3 |
| 3 | Identity always in scope | `profile/identity-always` | identity facts present for an unrelated query | Slice 4 |
| 4 | Sensitive never auto-injected | `capture.safety/sensitive-flag` | absent from profile; retrievable only | Slice 4 |
| 5 | Contradiction invalidates old | `capture.reconcile/contradiction` | old `invalidated`, answer uses new | Slice 1 |
| 6 | Repeat → merge, not duplicate | `capture.reconcile/repeat` | one record, unioned sources | Slice 1 |
| 7 | Trivial turn ignored | `capture.negative/chitchat` | no write | Slice 1 |
| 8 | Irrelevant query → empty | `retrieval.negative/off-topic` | empty block | Slice 3 |
| 9 | Memory failure never blocks reply | `robustness/embedder-throws` | reply normal, block empty | Slice 3 |
| 10 | Structure from types | `profile/routed-tree` | placement correct with regexes deleted | Slice 5 |
| 11 | Prompt injection is not obeyed | `capture.safety/injection` | injected "remember/ignore" directive not stored as instruction | Slice 1 |

### 3.10 Per-slice EDD gate

A slice merges only when its gate is green against the corpus:

- Slice E → harness runs end-to-end on a sample and metrics are unit-tested.
- Slice 1 → claims 1, 5, 6, 7, 11 + `capture.*` targets (live).
- Slice 3 → claims 2, 8, 9 + retrieval targets and the calibrated `θ_rel` (live).
- Slice 4 → claims 3, 4 + profile targets (sensitive-leak = 0).
- Slice 5 → claim 10 (routed-tree parity with the regexes deleted).
- Slice 6 → retriever parity: same corpus, same selected ids/order within tolerance.

### 3.11 CI integration

- **PR:** typecheck + unit + service (stubbed) + offline evals + contract + the safety subset. No network, fast.
- **Nightly + pre-flip:** the full live harness via `api/.env` — all stages, full corpus, `WATAI_EVAL_REPEAT ≥ 3`, the θ sweep, cost-capped by `WATAI_EVAL_MAX_USD`. Publish the run report and compare against the golden baseline and the §3.8 targets before any flag flip.
- Secrets come from `api/.env` locally and OIDC-provided settings in CI; never committed.

---

## 4. Rollout

1. Ship Slices 0–2 dark (flags `lexical`/`false`); embeddings accumulate via writes + backfill.
2. Run the **full live corpus** through the harness; calibrate `θ_rel`/weights from the θ sweep until
   the §3.8 per-category targets pass, then freeze the golden baseline.
3. Flip `memoryRetrieval = vector` (Slice 3) per environment; watch the false-inject rate.
4. Flip `memoryProfile = true` (Slice 4) after the profile eval passes.
5. Land Slice 5 (delete prose regexes) once routed-tree parity holds.
6. Flip to the Cosmos retriever (Slice 6) when per-user volume warrants; in-process stays the default.

Backend deploys precede the frontend attribution work (Slice 7). App settings
(`MEMORY_MODEL`, `MEMORY_DEEP_MODEL`, `MEMORY_EMBED_MODEL`, flags) are applied surgically with
`az functionapp config appsettings set`, never a full template deploy.

## 5. Tuning loop

The relevance floor and score weights are configuration, not code. The nightly live harness runs the
full corpus and emits per-category recall@K, false-inject, stability, and cost; the per-run
memory-used telemetry (Slice 7) feeds real labels back into the corpus. Adjust `θ_rel`/weights from
the sweep, re-run the harness, diff against the golden baseline, and only then change the deployed
config — the corpus is the source of truth, not intuition.
