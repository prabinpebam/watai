# 02 — Memory system: implementation audit and improvement proposal

**Audit date:** 2026-09-10  
**Evidence baseline:** `f7dc195300c4039aae5b9a7a8fb1691327864ea1`  
**Scope:** memory write/extraction/consolidation/retrieval/prompt/disclosure/correction/deletion, memory Settings, data contracts, tests and documentation. Code references use **baseline line ranges**; abbreviated filenames resolve to repository-relative paths below. No application changes, commits, production calls, credentials, or production data access were made.

Memory UI review was source-based; no live visual inspection or user study was performed.

**Research:** twelve freshly consulted primary sources, plus one separated survey. [The evidence register](research/memory-sources.md) records versions, visible dates, consulted sections, limitations, and category mappings. Coverage is not exhaustive; the newest verified revision consulted is ACE v3, March 2026.

### Exact evidence locators

| Abbreviated filename | Repository-relative baseline path |
| --- | --- |
| `memoryService.ts` | `api\src\application\memoryService.ts` |
| `memoryExtractionService.ts` | `api\src\application\memoryExtractionService.ts` |
| `memoryContextService.ts` | `api\src\application\memoryContextService.ts` |
| `runWorker.ts` | `api\src\application\runWorker.ts` |
| `memoryExtractor.ts` | `api\src\ai\memoryExtractor.ts` |
| `memory.ts` | `api\src\domain\memory.ts` |
| `memoryProfile.ts` | `api\src\domain\memoryProfile.ts` |
| `memoryRouting.ts` | `api\src\domain\memoryRouting.ts` |
| `inProcessRetriever.ts` | `api\src\adapters\memory\inProcessRetriever.ts` |
| `memoryStore.test.ts` | `api\src\adapters\cosmos\memoryStore.test.ts` |
| `memoryExtractionService.test.ts` | `api\src\application\memoryExtractionService.test.ts` |
| `memoryContextService.test.ts` | `api\src\application\memoryContextService.test.ts` |
| `Settings.tsx` | `src\features\settings\Settings.tsx` |

## 1. Judgment

Watai has typed records, account partitions, asynchronous extraction, model selection, embeddings, retrieval, editable memories and partial disclosure. Its central weakness is **the contract connecting them**: saved, remembered, hidden, outdated, used and deleted do not consistently match the interface.

| Category | Rating | Judgment and evidence |
| --- | ---: | --- |
| **C07 — Memory quality** | **4/10** | Functional, with material gaps. Real extraction/vector retrieval and useful negative tests earn credit. Newest-only candidate windows, non-atomic reconciliation, weak identity/time semantics, misleading derived profiles, and absent end-to-end quality evidence prevent a credible personal-beta score. M01/M02 establish evaluation dimensions; M03/M04 expose concrete consolidation/temporal alternatives; M06–M09/M12 bound the architecture tradeoffs. |
| **C08 — Memory control/governance** | **2/10** | Prototype-level guarantees despite substantial UI. Pause suppresses reads contrary to copy; settings-read failure may allow reads; deletion retains payload and does not block relearning; provenance/sensitive handling is incomplete; bulk JSON can act on the wrong inventory. M05/M07/M10/M11 provide concrete persistence/control comparisons, and M04/M08/M12 explain derived-data obligations. |

**Rubric:** 0 absent; 2 prototype; 4 functional but material gaps; 6 credible personal beta; 8 robust production-proven; 10 exemplary with sustained evidence. These are engineering judgments, **not measured benchmark scores**. Numerous passing plumbing tests do not establish semantic quality or privacy reliability.

No P0 is alleged. P1 means fix before relying on the feature’s correctness/control promise; P2 is a material quality or operability defect; P3 is bounded documentation/usability debt. Confidence concerns the finding, not the probability every user encounters it.

### Why it may feel disappointing

These are **experience hypotheses**, not user-study results:

- “I told it, but it forgot”: an unembedded manual/edit record can become unreachable; older records fall outside candidate windows; a profile is gated by embeddings; read timeouts quietly become empty.
- “It remembers the wrong things”: confidence is model self-assessment, subject attribution is mostly prompting, and a single related memory opens the whole profile.
- “I corrected it, but it is still wrong”: old route/source metadata can outlive text edits, outdated restoration retains an expired validity field, and reconciliation only sees recent records.
- “Memory feels like database administration”: users choose fact/work-style/procedure, see salience decimals and raw JSON, but cannot reliably see why an item was inferred, which evidence supports it, or exactly where deletion stops.


## 2. The actual lifecycle, not the planned one

| Stage | Implemented behavior and baseline evidence |
| --- | --- |
| **Write** | Manual saves directly create active records with confidence 1, `sensitive:false`, and no embedding. Automatic writes start after an assistant completes; normal scheduling deliberately does not fire the command lane. `api\src\application\memoryService.ts:63–86`; `api\src\application\memoryExtractionService.ts:99–131`; `api\src\application\runWorker.ts:1258–1259`. |
| **Extract** | Account settings and temporary/deleted-thread eligibility are checked before enqueue and processing. Up to 40 prior messages are supplied, each truncated to 4,096 characters, alongside the newest 20 active memories. The extractor requests JSON with a 1,200-output-token/45-second limit; malformed operations may become `ignore`. `memoryExtractionService.ts:161–186,235–245`; `api\src\ai\memoryExtractor.ts:102–125,133–174`. |
| **Consolidate** | Add/merge/invalidate/suppress are applied sequentially. Adds use self-reported confidence/salience thresholds; exact normalized text/kind/entities hash is the duplicate mechanism. There is no independent consolidation worker or committed operation log. `memoryExtractionService.ts:258–368`. |
| **Retrieve** | Embeddings require `MEMORY_EMBED_MODEL`; profile requires `MEMORY_PROFILE`. Read considers only the newest 200 active records, excludes the `project_context` kind, embeds the latest user text, takes three cosine candidates, then applies composite scoring/budget. `api\src\composition.ts:160–168`; `api\src\application\memoryContextService.ts:98–158`. |
| **Inject** | A separate kind-grouped prose profile may be added, capped at 2,400 characters. It is **not** the Settings structured tree. Any candidate clearing cosine 0.2 opens that profile; absent/failed query embeddings default it on. Vector floor is 0.25. The worker races memory against a default **3,000 ms**, not the 250 ms printed in the context block. `memoryContextService.ts:36–47,123–131,186–209`; `api\src\application\runWorker.ts:120,908–945,1032–1056`. |
| **Disclose** | Worker persists refs for selected vector memories only. Profile-only material has no corresponding per-item refs. The response card labels these “memories used,” though inclusion does not prove the model used them. Extraction notices report counts, not a durable inspectable decision. `runWorker.ts:1032–1044`; `api\src\application\memoryExtractionService.ts:200–228`; `src\features\chat\Message.tsx:329–350`. |
| **Correct/delete** | Text patch clears embeddings but preserves route/source/summary metadata. Outdated sets `invalidAt`; restore does not clear it. Delete sets status/deletedAt and retains payload/vector/quotes. Source-thread deletion is not connected to memory cleanup in the inspected services. `memoryService.ts:89–118`; `api\src\application\threadService.ts:77–82`. |

`api\src\ai\semanticRouter.ts:9–15,46–69` routes response/image/code/file/web capabilities, **not memory intent**. The live tool list has no memory read/write command (`runWorker.ts:355–430`). Therefore conversational “remember/forget” depends on later extraction; the retained `enqueueCommand` method and its lower thresholds are not evidence of a normal synchronous explicit-command experience.

**Configuration boundary:** `infra\main.dev.bicepparam:31–39` explicitly configures routine/deep models, `text-embedding-3-small`, and the profile flag. Missing-embedding/profile scenarios in this report describe supported configuration or failure modes, **not evidence that the configured development deployment omits them**. Neither template defaults nor parameter values prove the current live deployment state; no production configuration was queried.

Documentation is materially stale. `documentation\memory-system\pipeline-flow.md:34–62,85–101,124–129` calls itself “as built” but describes two lanes, five messages, lexical retrieval and regex gates. `11-decoupled-memory-architecture.md:45–55,128–135` mixes an always-on structured profile, deep reconciliation and a 250 ms target with partially implemented work. The actual read profile is a different function, gated; the deep tier has no wired reconciliation/rebuild workflow. Preserve historical rationale, but publish one versioned implemented-contract page.

## 3. Findings

### MEM-01 — Permissions do not form a reliable read/write contract

**P1 · high confidence · observed/reproduced permission defects; temporary worker check is defense-in-depth.**

`src\features\settings\Settings.tsx:781–786` promises pause keeps existing memory available. `memoryContextService.ts:99–103` instead returns empty when paused. If settings cannot be loaded, its catch returns `undefined` and skips permission enforcement. Extraction checks temporary threads; retrieval accepts a thread ID but never checks its temporary status. The worker’s early read (`runWorker.ts:899–945`) likewise supplies no temporary policy.

**Impact:** pausing learning makes the assistant forget; unavailable policy can permit an unauthorized read. Importantly, current server admission rejects `temporary:true`, creates only normal threads, and requires an existing owned thread for runs (`api\src\application\threadService.ts:20–35`; `api\src\application\runService.ts:30–36`). The missing worker temporary check is therefore defense-in-depth for historical/future/manual records, **not demonstrated reachable temporary-memory leakage through the supported API**. FE-04 separately concerns the UI creating normal threads despite its temporary-default setting.

**Cross-device opt-out consequence of FE-13:** defaults enable reading/learning (`src\lib\types.ts:336–337`); backfill patches cloud settings from local state without account-settings hydration (`src\data\sync\syncRepository.ts:351–367,387–403,428–429`). Server merging replaces the provided memory object (`api\src\domain\settings.ts:100–109`). Fresh/stale-browser backfill can therefore overwrite cloud opt-out with enabled defaults. This is source-grounded; no real cross-device session was executed. FE-13 owns the general settings-authority finding.

**Recommendation/tradeoff:** independent `readSaved` and `learnChats` policy, authoritative thread mode, fail closed on unknown policy, and a policy epoch checked before extraction commit. Keep generation available without personalization rather than interpreting storage failure as consent. Recheck epoch also prevents a queued/in-flight job writing after learning is disabled.

**Acceptance:** full permission truth table; paused learning still reads when permitted; policy error reads/writes zero memories; temporary request denied in server tests; disable-during-extraction prevents commit; fresh/stale-device sync never re-enables memory without explicit user action. M10/M11 support explicit mode semantics, not a universal vendor-mandated mode.

### MEM-02 — “Permanently deleted” is not implemented, and forgetting can reverse itself

**P1 · high confidence · observed retention; relearning is an inferred execution consequence.**

Delete retains text, embedding, metadata and source quotes (`memoryService.ts:112–118`); Settings promises permanent deletion (`Settings.tsx:1182–1187`). Automatic consolidation only loads active memories (`memoryExtractionService.ts:175`), so deleted/suppressed assertions are absent from duplicate/forget decisions. Older conversation content remains available to extraction. No exclusion tombstone, source-revision barrier, or erasure job exists in the inspected memory path.

**Impact:** a deleted fact can remain stored and later return under a new ID. Old answer snapshots can retain disclosed text. Source-thread cleanup deletes files/assets/messages, not memory records/jobs (`api\src\composition.ts:227–235`); removing a chat therefore does not erase its saved memories.

**Recommendation/tradeoff:** define “stop using,” “remove saved memory,” and “erase eligible copies” separately. Block serving immediately; persist a minimal protected exclusion marker; asynchronously remove payload/vector/derived copies under a documented policy. Explicitly describe surviving original chats, old replies, backups and retention. Do not keep sensitive text inside the tombstone.

**Acceptance:** replay, duplicate queue delivery, import and rebuild cannot resurrect exclusions without explicit reauthorization. Erasure status identifies completed/retained locations. BE-10 reports unenforced retention settings: selecting a duration does not establish memory erasure. Actual backup retention remains unverified. M10 motivates honest distinctions.

### MEM-03 — Extraction is asynchronous but not reliably durable/idempotent

**P1 · high confidence · observed control flow; crash scenarios inferred.**

Scheduling is fire-and-forget and catches errors (`runWorker.ts:1258–1259`; `memoryExtractionService.ts:125–131`). Enqueue writes a queued job before queue submission, but a failed queue submission leaves a job later treated as already enqueued (`:141–158`). `processJob` reruns even completed jobs and has no lease/compare-and-swap (`:161–166`). Cosmos dedupe is a query followed by unconditional upsert, not uniqueness (`api\src\adapters\cosmos\memoryJobStore.ts:24–42`).

**Impact:** a reply can complete but never produce its promised memory, or retries/concurrent invocations can repeat model calls and writes. “One job per exchange” is an intent, not a durable execution guarantee.

**Recommendation/tradeoff:** durable source event/outbox or change-feed delivery; deterministic job identity; leased processing; terminal-state short circuit; idempotent operations and recoverable dispatch. Cosmos transactions cannot span arbitrary containers/partitions: co-locate an outbox with the source write or use a change-feed design, then transact per-user memory operations separately.

**Acceptance:** kill/restart at each boundary; failed enqueue repaired without user action; concurrent duplicate consumers yield one committed effect; retry metrics and dead-letter repair are visible. Model choice cannot compensate for delivery loss.

### MEM-04 — Consolidation loses correctness at exactly the moments that matter

**P1 · high confidence · observed code; duplicate/stale-vector cases reproduced.**

The extractor sees newest-20 rather than related memories. `applyOperations` never updates its candidate array, so identical adds within one output create distinct records. Replacement invalidates old records **before** validating/persisting the new one (`memoryExtractionService.ts:280–311`). Merge changes text but does not recompute `sourceHash`; failed re-embedding leaves the old vector attached to new text. Confidence/salience only increase (`:335–356`). Per-operation exceptions are reduced to rejection counts.

**Impact:** contradictions survive outside the window, replacements can remove valid information without saving the correction, and semantically stale vectors misroute later queries.

**Recommendation/tradeoff:** retrieve relevant consolidation candidates plus same-subject/predicate matches; validate the complete operation before mutation; apply revision-checked atomic replacements; recompute hashes and mark embeddings stale on every semantic edit. Keep per-operation rejection reasons. Restrict expensive reconciliation to ambiguity; M03’s semantic lookup is directly applicable without copying its service.

**Acceptance:** atomic failure injection, concurrent corrections, duplicate operations in one batch, changed text/entity hashes, and embedding failures. Confidence must be allowed to decrease when contradictory evidence arrives.

### MEM-05 — Provenance exists syntactically, but not as verified evidence or sensitivity policy

**P1 · high confidence · observed gaps; erroneous attribution frequency unmeasured.**

Source IDs only need to exist in the window; quotes are the first 500 characters, not verified supporting spans (`memoryExtractionService.ts:248–255`). Missing source IDs can be silently replaced by the latest user ID (`memoryExtractor.ts:65–69,173–174`). Authorship is a prompt instruction. The prompt both encourages named family/age capture and forbids private third-party details (`:138–149`) without resolving the boundary.

All create/import/automatic paths set `sensitive:false`; there is no sensitivity classification/confirmation lifecycle (`memoryService.ts:79,169`; `memoryExtractionService.ts:301`). The profile excludes records flagged sensitive, but vector retrieval does not (`api\src\adapters\memory\inProcessRetriever.ts:35–38`). Secret-pattern validation is useful, not a policy for health, children, relationships, location or inferred traits.

**Recommendation/tradeoff:** require server-verified source spans and speaker/subject attribution; record explicit versus inferred origin, extraction model/prompt version, sensitivity class, and confirmation state. Never upgrade a guessed source into verified provenance. Conservative review adds friction but reduces surprising personal assertions.

**Acceptance:** authored biographies, quoted text, assistant speculation, multiple children, health/financial details and corrections; blocked classes never enter serving views. New assertions show supporting evidence or explicitly say evidence is unavailable.

### MEM-06 — Retrieval has avoidable blind spots, including newly saved and pinned memories

**P2 · high confidence · observed and reproduced.**

Newest-200 scanning drops older knowledge regardless of query (`memoryContextService.ts:107–114`). The retriever truncates to three **before** composite ranking and pin/floor logic (`inProcessRetriever.ts:29–41`; `memoryContextService.ts:138–158`), so a fourth pinned/high-value item never competes. Model identity is not checked when comparing vectors. Manual creates lack embeddings; edits clear them. Healing scans newest 50 and handles three records only after eligible extraction (`memoryExtractionService.ts:373–387`).

**Impact:** a successfully saved item may be invisible until another extraction heals it; with learning disabled it may remain invisible. Same-dimensional vectors from different models may be compared meaninglessly. A user’s pin has weaker semantics than the UI suggests.

**Recommendation/tradeoff:** immediate indexing state/job for manual edits, versioned embedding identity/dimensions/content hash, independent backfill, lexical/entity fallback, and broad candidate retrieval before reranking. Keep in-process exact search for genuinely small sets; paginate or indexed-search the whole eligible set, not its newest slice.

The retained reproduction uses a fourth, near-relevant high-importance candidate
that wins the current composite ranking when an injected retriever returns four
candidates. Pinning alone does not guarantee selection; the original orthogonal-
pin observation was insufficient to prove that stronger claim. See
[the refined control](evidence/memory-validation.md).

**Acceptance:** 201+ records, pinned item below cosine top three, old-model vectors, no embedding service, manual save with learning off, multilingual names and indirect references. M01/M03/M05 motivate hybrid/relevant candidate selection, not a mandatory vector database.

### MEM-07 — Profile injection is broad, partially invisible, and outside the stated budget

**P2 · high confidence · observed; relevance harms unmeasured.**

One candidate above 0.2 opens the entire salience-ranked profile; embedding failure opens it too (`memoryContextService.ts:125–131`). Sensitive/expired records can participate in opening the gate even if profile rendering later excludes them. Profile facts can duplicate vector facts; profile tokens are added after the vector budget (`:186–191`). A 2,400-character profile adds approximately 600 estimated tokens to the nominal 400-token channel.

Only vector records produce response refs (`runWorker.ts:1032–1044`). Profile-only personalization therefore lacks equivalent disclosure. The context declares 250 ms while the worker permits 3,000 ms; timeout racing does not cancel the underlying embedding work (`runWorker.ts:120,908–945`; `api\src\ai\azureEmbedder.ts:15–35`).

**Recommendation/tradeoff:** compose one versioned context bundle with per-item eligibility, combined token budgeting, deduplication, selection reasons and refs for every channel. Return capability/timeout diagnostics without exposing private text in telemetry. Define pins as explicit preference, not unconditional factual relevance.

**Acceptance:** combined-budget boundaries, zero unexplained profile sources, off-topic query corpus, abort propagation and provider-failure fallback. M07 provides explicit attachment semantics; M09 and M12 argue for testing retention separately from serving volume.

### MEM-08 — Identity, time and route fields overpromise the model actually implemented

**P2 · high confidence · observed; name/restore failures reproduced.**

`memoryRouting.ts:5–35,101–129` declares layers, profile paths and expiry, but those do not establish actual storage scopes or expiry enforcement. The Settings profile handles only some paths. User details/spouse initialize empty and never receive general routed values; pets/children depend substantially on English/ASCII regexes; “One Piece” has special handling (`memoryProfile.ts:83–161,204–245,267–320`).

The record has timestamps but no stable assertion-level subject identity, event-time precision or observed-age basis. Recent buckets use update time, not event time (`:248–255`). The Settings builder checks active status, unlike the serving renderer’s validity check. Restore leaves `invalidAt` behind (`memoryService.ts:97–107`; `memory.ts:311–316`), producing an apparently restored but unavailable memory.

**Recommendation/tradeoff:** stable entity IDs plus aliases/relationships; assertion validity distinct from ingestion; ages as “reported age at date,” not timeless current age; explicit scope enforcement. Treat route hints as hints until supported, and provide an uncategorized fallback.

**Acceptance:** non-Latin names, same-name relatives, renamed pets, historical/future facts, birthday boundaries, every declared route, and restore semantics. M01/M04’s temporal lessons are useful without implementing a full temporal graph.

### MEM-09 — The management view is incomplete and can falsely reassure

**P2 · high confidence · observed code; experiential effect hypothesized.**

Settings defaults to a structured view that omits ordinary name/location/instruction facts unless caught by recent buckets or bespoke branches (`Settings.tsx:832–858,1212–1253`). It still shows Work branches despite project-context rejection. “Evidence” displays text/type/salience/actions, not source quotations or attribution (`:1134–1175`). Edit targets the first source record, while deleting a tree item may delete every supporting record (`:1270–1298`).

Only 100 items are requested; `src\data\sync\syncRepository.ts:172–191` discards the API cursor and silently falls back to local state after cloud read failure. The user cannot distinguish complete remote inventory from partial/stale local data. Turning Memory off clears subordinate flags; turning it on preserves their now-false values (`Settings.tsx:758–762`), so “Memory enabled” can mean no learning and no usage.

**Recommendation/tradeoff:** primary inventory = searchable saved assertions with explicit/inferred, source, scope and last-change state. Make structured grouping secondary and lossless. Show offline/stale/partial state, pagination and effective capabilities. Move raw JSON and model salience to diagnostics.

**Acceptance:** every active assertion discoverable, >100 items manageable, cloud-failure state visible, toggle round-trip predictable, and multi-source edit/delete previews accurate.

### MEM-10 — Raw JSON can mutate the wrong status inventory

**P1 · high confidence · observed state/control flow; UI interaction not executed.**

The JSON buffer refreshes only when `view` changes (`Settings.tsx:947–953`). Changing Active to Hidden/Outdated while staying in JSON reloads `items`, not `jsonText`. Save compares stale JSON IDs with the newly loaded inventory and deletes items missing from that buffer (`:998–1024`). Old IDs absent from current inventory are treated as new records. Confirmation provides a deletion count, not a reliable cross-status diff.

**Impact:** editing a stale Active document while Hidden is selected can duplicate active records and delete hidden ones. The same mismatch can follow live memory updates. A power-user interface should not silently reinterpret its editing base.

**Recommendation/tradeoff:** immutable editing snapshot/status/revision, dirty-state handling, server-side preview and revision-checked batch commit. Status changes require discarding or reconciling edits. Alternatively remove this destructive editor until a safe batch protocol exists.

**Acceptance:** switch status while dirty/clean, receive realtime updates, remove records concurrently, retry partial failures: no mutation targets an inventory other than the user-reviewed snapshot. This is an implementation finding; external architecture papers do not validate bulk-edit correctness.

### MEM-11 — API capabilities and persistence semantics are incomplete

**P2 · high confidence · observed; export/import incompatibility reproduced.**

`api\src\http\memoryController.ts:70–74` returns `202 {status:'queued'}` for rebuild without creating any job or even associating one with an identity. Export emits full records and summary metadata; import expects a different strict item/envelope schema (`memoryService.ts:140–185`; `memory.ts:170–188`). The export cannot directly round-trip through import. Import neither deduplicates nor preserves full status/history semantics.

Cosmos pagination encodes an ID but filters only `updatedAt < cursor`, dropping tied-timestamp records across page boundaries (`api\src\adapters\cosmos\memoryStore.ts:6–16,54–67`). Its in-memory test adapter handles ties, so tests can conceal the discrepancy. Profile/export completeness is affected.

**Recommendation/tradeoff:** return unavailable for unimplemented rebuild; publish real asynchronous job/status contracts when implemented. Version portable exports separately from internal records, validate a round-trip fixture, and use a stable compound cursor or Cosmos continuation mechanism.

**Acceptance:** rebuild acknowledgement corresponds to a retrievable job; interrupted import safely resumes; same-timestamp pages lose no records; portable export→preview→commit preserves supported semantics. Do not expose an ambitious API before its lifecycle exists.

### MEM-12 — Evaluation does not measure the behavior shipped

**P2 · high confidence · observed test/harness mismatch.**

The committed corpus has **31 cases: 22 capture, six retrieval, three profile**. `api\scripts\memory-eval.ts:119–183` evaluates extractor output without the application acceptance thresholds, and retrieves five items without the actual composite/profile/budget path. Exceptions count as successful rejection in reject cases, conflating safe refusal with outage (`:138–150`). Its dollar ceiling uses fixed per-case increments, not model usage, and failed cases do not accrue those increments (`:287–303`).

The historical 23-prompt probe tests stages independently and often substitutes raw messages when extraction abstains (`documentation\memory-system\pipeline-probe-report.md:7–14,25–31,74–76`). It does not establish end-to-end remembered facts. Its project-context expectations conflict with current exclusion policy. The latency report contains small context-scaling samples, not current memory-serving p95 evidence.

**Recommendation/tradeoff:** keep cheap unit tests, but add chronological service-level replay and answer-level evaluation, separated by ability and policy. Classify refusal, transport failure, malformed output, policy rejection and correct abstention separately. Cost/latency accounting must use actual usage and include retries.

**Acceptance:** versioned holdout datasets, repeated runs, uncertainty intervals, model/config manifests, and all negative policy gates. M01/M02 define useful abilities; none supplies a ready-made Watai quality score.

## 4. Architecture choices: evaluate, do not fashionable-rewrite

| Viable architecture | What to build | Benefits | Costs/risks and decision |
| --- | --- | --- | --- |
| **A. Cheap explicit-memory baseline** | User-authored saved assertions; a tiny confirmed preference block; keyword/entity plus optional exact vector retrieval; no automatic promotion. | Lowest surprise and model cost; transparent correction/deletion; excellent control baseline. | Users must curate; misses casual facts and multi-hop recall. **Build as control/fallback first**, and measure whether automation beats it. M07 supports explicit block semantics; M01 supports strong retrieval baselines. |
| **B. Staged evidence + profile hybrid** | Durable event ingestion → proposed evidence-linked assertions → deterministic policy/identity checks → selective promotion; small confirmed profile plus query-specific evidence. Versioned updates and exclusion lineage. | Preserves existing Cosmos/queue/ports; directly addresses current failures; allows review and gradual automation. | More states and migration complexity; relevant reconciliation adds some calls. **Recommended destination**, borrowing M01/M03/M04/M12’s lessons rather than their benchmark claims. |
| **C. Temporal graph / agentic memory** | Episode/subject/relation graph or linked evolving notes, hybrid traversal, explicit temporal assertions and tightly bounded agent memory tools. | Potentially valuable for multi-entity changes, relationship queries and long-running project histories. | Additional infrastructure, schema/model dependence, inference calls, debugging and cascade deletion. Graphiti requires surrounding product/operations work (M05); A-Mem/Letta add autonomy/state (M07/M08). **Experimental only** until B loses on a meaningful relationship-heavy holdout. |

Full-history prompting is another useful **evaluation control**, not the default architecture. M01 shows evidence granularity matters; M09 warns context placement can matter; M12 warns lossy rewriting can destroy useful detail. Preserve evidence economically, then retrieve selectively. These propositions are compatible.

**Do not build yet:** universal knowledge graph, unbounded self-reflection, autonomous profile rewriting, emotion/personality inference, hardcoded pet/fandom taxonomies, or “remember everything” ingestion. Do not remove thread isolation to rescue project recall; introduce explicit project permission/scope only when the product chooses that capability.

## 5. Concrete recommended contracts

These are **proposals**, not existing schemas.

```text
MemoryPolicy {
  userId, revision, epoch,
  readSaved: boolean,
  learnChats: "off" | "review" | "automatic",
  sensitiveClassesAllowed: [], defaultScope: "user"
}
Evidence {
  id, userId, threadId, messageId, sourceRevision,
  speaker, subjectCandidates[], spanStart, spanEnd, contentDigest,
  sourceObservedAt, retentionClass, excludedAt?
}
Assertion {
  id, userId, revision, subjectId, predicate, value, qualifiers,
  scope: {type: "user" | "project" | "thread", id?},
  origin: "manual" | "explicit_request" | "inferred" | "imported",
  state: "proposed" | "accepted" | "conflicted" | "outdated" | "excluded",
  sensitivity, confirmation, evidenceIds[],
  validFrom?, validTo?, observedAt, supersedes[],
  embedding: {model, dimensions, contentDigest, state},
  extractorVersion?, modelConfidence?
}
MemoryOperation {
  idempotencyKey, sourceRevision, policyEpoch, expectedRevision,
  op, targetId, result, rejectionCode?, committedAt?
}
```

Retain source spans only under an explicit retention policy; a digest does not magically anonymize sensitive content. “Confidence” should not be displayed as calibrated probability without calibration evidence. Do not turn repeated speculative model statements into independent corroboration.

Recommended API semantics:

- `POST /memory` returns the saved assertion, revision and indexing state; explicit persistence cannot depend on future chat extraction.
- `PATCH /memory/:id` requires `If-Match`; semantic changes update provenance/version and invalidate derived representations atomically. Distinguish correcting a value from restoring a historical version.
- `DELETE /memory/:id` immediately excludes usage and returns an erasure-operation identifier/status, with clearly documented retention scope. Repeating it is idempotent.
- Batch edit/import uses `preview` with a snapshot digest and exact diff, then revision-checked `commit`; never infer deletion from an unrelated paginated inventory.
- Context assembly produces `{policyEpoch, assertionId, revision, channel, evidenceRefs, selectionReason}` for every injected item. User copy says **“Provided as context,”** not unproven causal “used.”
- Expose learning status/rejections/capability availability safely: saved but indexing, learning paused, provider unavailable, awaiting confirmation, excluded. A bare success toast is insufficient.

## 6. Action plan, migration and rollback

| Order | Deliverable / dependencies | Exit evidence |
| --- | --- | --- |
| **1 — Contract repairs** | MEM-01/02/10/11: policy truth table; honest delete/rebuild responses; disable unsafe JSON mutation; reliable cursor; source-of-truth UI. Coordinate settings sync, temporary-run behavior and deletion ownership with backend/frontend. | Deterministic negative tests; no false permanent-delete or queued-work claim; status-switch edit test. |
| **2 — Durable write foundation** | MEM-03/04/05: replayable source events, leases/idempotency, operation validation/transactions, source attribution, explicit/inferred and sensitivity state. | Crash/retry/concurrency matrix; no duplicate effect, orphan replacement or unreviewed sensitive promotion. |
| **3 — Retrieval and disclosure** | MEM-06/07/08/09: independent indexing, whole-set/hybrid candidates, versioned vectors, shared context budget, complete refs, lossless inventory. | Holdout retrieval/answer tests; >200 items; manual edits visible; context budget and source-coverage gates. |
| **4 — Prove B against A** | MEM-12: chronological replay, controlled model runs with synthetic/public data, qualitative memory-control study. | Automation improves meaningful recall without worsening control gates; acceptable latency/cost measured. |
| **5 — Optional graph experiment** | Only if relation-heavy failures remain after B and graph operations/erasure are funded. | Pre-registered evaluation improvement large enough to justify total operational cost; rollback exercised. |

**Cross-scope dependency reported by the backend audit:** caller-supplied thread IDs can collide across owners while messages/runs use a thread-only partition (`api\src\application\threadService.ts:20–42`; see the backend report for the complete finding). If that collision occurs, memory's thread-only conversation load (`memoryExtractionService.ts:235–245`) can inherit mixed-owner evidence; a `/userId` memory partition does not repair incorrect input attribution. Resolve the upstream namespace boundary and test source ownership before claiming account isolation. This is a dependency on the backend finding, not a second independently verified exploit.

The backend audit also reports that a finishing run can restore a stale thread after deletion (`runWorker.ts:702,1264–1274`). Memory exclusion and delete-during-extraction acceptance must therefore cover the run/thread lifecycle, not only memory records. No live exploit or production erasure test was performed in either handoff.

**Frontend handoff:** FE-04 reports that “Default to temporary chats” is not consumed by normal chat creation (`src\features\settings\Settings.tsx:1600–1609`; see frontend audit for call-chain evidence). Memory's rejection of an actually temporary thread cannot protect one incorrectly created as normal. FE-01's local account-isolation finding affects trust in memory's silent cloud-to-local inventory fallback (`src\data\sync\syncRepository.ts:172–191`). The device erase action is explicitly local and does not call cloud memory deletion (`Settings.tsx:1640–1665`; `src\data\sync\syncRepository.ts:335–339`); it is not an account erasure mechanism. These are dependencies, not duplicate MEM findings; control tests must span UI, repository and server.

**Migration:** add versioned fields compatibly; inventory legacy statuses and orphan refs without silently promoting everything. Mark unverified legacy origin/sensitivity as unknown; initially serve only policy-approved assertions. Rebuild embeddings in a shadow namespace with content/model hashes. Never replay deleted/suppressed source material merely to populate the new schema. Introduce outbox/job changes before backfills. Dual-read comparisons must not expose extra memory to the answering model.

**Rollout/rollback:** feature-flag candidate selection, profile, promotion and embedding version independently. Shadow on synthetic replay first; then limited consenting beta. Record revisions/checkpoints and inverse corrections, not uncontrolled copies of private data. Rollback changes the read implementation, **not** the latest user deletion/consent epoch. Exclusion markers survive every rollback; old indexes are disabled until filtered against current policy. Define purge completion across source, derived profile/index, old answer snapshots and backups with the broader data lifecycle owner.

## 7. Evaluation and verification

Keep evaluation repository-run, versioned and provider-portable; **do not adopt hosted OpenAI Evals API** for this proposal.

Proposed first release set: **120 chronological capture/update cases**, **60 policy/control adversarial cases**, and **100 retrieval/answer cases**, with disjoint subjects/templates across development and holdout sets. These are proposed dataset sizes, not existing coverage. Include authored third-party content, indirect references, contradictory dates, same-name entities, multilingual names, multiple facts per source, temporary chats, opt-out during jobs, deletion/replay, import, and 50/200/1,000-record scale slices.

These were the subsystem's exploratory sizing suggestions. The synthesized
[acceptance specification](08-acceptance-and-evaluation.md) supersedes them
with one coordinated smoke/development/held-out plan; do not add both sets
together or treat either size as a statistical guarantee.

Measure assertion precision/recall, attribution correctness, contradiction resolution, temporal answer accuracy, relevant recall@k, context precision, unsupported personalization, correct abstention, source coverage, duplicate rate, manual-save availability, correction convergence, indexing delay, p50/p95/p99 latency, input/output/embedding tokens, and cost including retries. Separate capture errors from retrieval errors and answer-reading errors. Human-adjudicate disagreements; record model, prompt, dataset and configuration revisions; report uncertainty rather than one impressive percentage.

Hard gates: no cross-account/scope leakage, no forbidden temporary reads/writes, no excluded-memory resurrection, no sensitive-class violation, and no unexplained injected assertion in the deterministic acceptance set. A zero observed count is **not statistical proof of zero real-world risk**. Tune relevance and token/latency targets on measured utility; do not inherit arbitrary 0.2/0.25 thresholds or assert 250 ms performance from a constant.

### Verification performed in this audit

Exact memory commands, probe source and observed outputs are retained in [memory validation evidence](evidence/memory-validation.md).

The separate [baseline validation report](evidence/validation.md) records full suites/builds and mixed initial browser results with passing targeted reruns; those are not a semantic-memory benchmark.

- **13 Vitest files, 87/87 passed** (23.90 s); see linked evidence for the exact command.
- A **zero-network synthetic probe**, bundling existing modules in memory with esbuild and stub stores/embeddings, reproduced eleven defects: pause suppressing reads; unknown policy permitting profile; broken restore; retained deleted payload; missing routed name; lost pin; incompatible vectors; invisible manual save; export/import rejection; duplicate adds; stale merge embedding. The [portable audit-only rerunner](evidence/memory-probe.cjs) reproduced all eleven and ran from a different working directory. No application/test files were changed.
- Static detector: `node "<installed-impeccable>\scripts\detect.mjs" --json src\features\settings\Settings.tsx` returned `[]`. This does not validate control semantics or visual usability.
- Fixture inventory counted 31 cases without loading `.env`. The live `memory-eval`, smoke, inspection and provider-probe scripts were **not run**; no measured provider quality/cost claim is made.

Existing tests are useful but narrower than their names sometimes suggest: `memoryExtractionService.test.ts:111–129` injects the desired LLM output, so it proves scheduling/storage, not real extraction of that utterance. `memoryContextService.test.ts:11–21` supplies a synonym-aware stub, not semantic model validation. Cosmos pagination testing explicitly avoids compound ordering (`memoryStore.test.ts:5–21`) without a tied-timestamp completeness check.

**Bottom line:** retain the server-owned asynchronous foundation; replace the implied memory promise with an enforceable, inspectable assertion-and-evidence contract. Reliability and user control should precede more ambitious memory intelligence.
