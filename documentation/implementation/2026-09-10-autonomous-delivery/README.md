# Watai autonomous implementation and delivery plan

**Status: DESIGN plus a local rehearsal controller; not authorization to deploy.**
Research/access date: **2026-09-10**. Audit document baseline:
`9b4314ddd537401667d68642c3eeee85e7fabca7`; audited application:
`f7dc195300c4039aae5b9a7a8fb1691327864ea1`.

The goal is an unattended engineering system that makes Watai safer and more
useful in small, independently evidenced releases, with memory trust first.
It must **stop safely rather than invent authority, relax a test, or ask for a
human decision**. Continuous progress is a goal; unconditional autonomous success
is not a credible guarantee.

## Decisions

Use a small deterministic TypeScript controller, a durable execution ledger,
isolated Copilot SDK/CLI workers, and separately authorized GitHub Actions
validation/promotion jobs. Agents propose changes and counterexamples; they do
not decide whether their own work passes. Start with one product builder and one
active release, not an open-ended agent swarm. Keep React/Vite, Functions/Cosmos,
and existing repository/service seams. Do not introduce a product graph database.

The **workflow state graph**, **slice dependency DAG**, and **evidence/provenance
DAG** are different graphs with different invariants. Workflow retry cycles are
bounded; backlog dependencies and evidence ancestry must be acyclic.

First deliver truthful controls, owner isolation, revisioned settings, safe
accepted work, and then accurate **Saved-only memory**. Automatic learning and
hybrid retrieval stay disabled until their own evidence passes. The full goal
is closure of all **52 findings (12 MEM, 17 BE, 13 FE, 10 OPS)**, not a better
numeric maturity score or a passing subset relabeled complete.

## Reading and execution order

| Artifact | Authority and purpose |
| --- | --- |
| [01-harness-design.md](01-harness-design.md) | Controller, roles, tools, context, durable execution, threat boundaries |
| [02-definition-of-done.md](02-definition-of-done.md) | Hard gates, fixed evaluation authority, statistical rules, autonomous UX limits |
| [03-bootstrap-and-release.md](03-bootstrap-and-release.md) | Preflight, initial baseline, release topology, no-human exceptions, recovery |
| [04-implementation-backlog.md](04-implementation-backlog.md) | Milestones, small slices, ordering and finding closure interpretation |
| [05-research-and-decisions.md](05-research-and-decisions.md) | Fetched primary sources, dated claims, alternatives and caveats |
| [06-design-validation-and-review.md](06-design-validation-and-review.md) | Local mechanical evidence, adversarial findings and design revisions |
| [07-harness-implementation-review.md](07-harness-implementation-review.md) | Executable-controller critique, implemented safeguards and remaining blockers |
| [08-execution-readiness.md](08-execution-readiness.md) | Current DoD readiness, bootstrap ceremony and execution-ready criteria |
| [09-value-effort-priorities.md](09-value-effort-priorities.md) | Safety-constrained value/effort ordering for ready slices |
| [contracts/backlog.json](contracts/backlog.json) | Canonical 56-slice execution backlog; each finding has explicit closure slices |
| [contracts/policy.json](contracts/policy.json) | Proposed gate/authority/budget policy, disabled by default |
| [contracts/workflow.json](contracts/workflow.json) | Typed transition table and bounded exception paths |
| [contracts/examples.json](contracts/examples.json) | Synthetic evidence packet and failure/recovery traces, never valid for release |
| [contracts/plan.schema.json](contracts/plan.schema.json) | Closed JSON contracts for the machine-readable artifacts |
| [validate-plan.mjs](validate-plan.mjs) | Local, network-free plan/traceability validator and negative controls |

The checked-in JSON inputs remain **specifications/examples**, not trusted
authority. The harness now includes guarded commands for signed workflow events,
task-bound worker probing, durable local agent execution and paid live-model
evaluation. Every operational command requires external pinned authority and its
specific credentials/signers; none grants itself permission, enables Actions,
creates infrastructure, promotes a release or proves production safety. Existing
audit observations remain open until independent evidence is admitted.

Run from the repository root:

```powershell
node documentation\implementation\2026-09-10-autonomous-delivery\validate-plan.mjs
npm run validate:harness
npm run harness:status -- implementation
npm run harness:model-eval-plan
npm run harness:controller-apply
npm run harness:probe-worker
npm run harness:evaluate-live -- <evaluation-id>
npm run harness:task-spec
npm run harness:execute
```

It checks JSON contracts, exact audit ID coverage, DAG structure, mandatory fields,
gate references, role separation, bounded workflow paths, synthetic evidence
binding, and rejection of deliberately malformed plans. It cannot establish that
future implementations actually satisfy prose acceptance criteria.

## Contract hierarchy and change control

The future preauthorized trust-root manifest pins policy, controller, evaluator,
dataset, and workflow SHAs outside builder write authority. That manifest and the
hard rules in this plan outrank all agent output. The JSON backlog is canonical
for slice membership/dependencies; the DoD defines gate semantics. Disagreement
between artifacts is **BLOCKED_SAFE**, never interpreted in whichever way passes.
No `passes: true` written by a builder can close work.

The old audit's manual studies, manual signoffs and paid-run approvals are
replaced with machine-grounded contracts and preauthorized limits. This does not
magically prove human usability, subjective trust, multilingual correctness,
physical-device equivalence, or complete WCAG conformance. Unsupported claims
remain explicitly machine-tracked and must not appear in release copy.

## What "stable is always available" means

After bootstrap, at least one immutable, addressable last-known-good (LKG)
frontend/API/config compatibility set is retained and eligible to serve. Candidate
branches and unvalidated artifacts never receive public traffic or production
queue work. Every routing change has a fenced, independently authorized rollback.
Provider/cloud outages can still interrupt availability; operational SLOs quantify
this, rather than promising impossible 100% uptime.

The current Pages `master/docs` deployment and manually deployed Functions app
are **observed, not proven validated**. Bootstrap records their provenance gaps
and risk envelope before a first contract-passing LKG is established. Initial
containment may reduce capability; the full goal cannot count a permanently
disabled advertised capability as repaired. S01 contains unsupported temporary chat immediately;
S49 must deliver real server-enforced temporary behavior for full closure.

## Authorization boundary

This document specifies future machine capabilities. It does not grant them.
Normal and exceptional paths use only already authorized machine identities,
scopes, quotas and infrastructure. Missing credentials, unautomatable login,
unsupported region/device capability, exhausted spend or absent safe routing
produce durable `BLOCKED_SAFE`/`UNSUPPORTED` records while retaining the old
product. No manual approval queue, CAPTCHA solver, password scraping, surprise
subscription, permission self-grant, remote push or deployment is part of this
planning task.

## Local security candidates (2026-09-11)

- S23 recall now owns a 500 ms asynchronous deadline, propagates caller/deadline aborts
	and rejects late results with empty context plus an optional degradation reason. Both
	worker recall paths use the same default and continue generation without stale memory.
	All 556 focused memory tests, 447 worker tests and API/frontend typechecks pass. Timers
	cannot preempt synchronous JavaScript/tokenization, and settings/history work outside
	recall is not bounded by this change. Diagnostics are context-only, not yet persisted
	or shown with replies; no measured production latency SLO is claimed.
- S23 memory context now counts the final serialized profile/vector block with both
	`cl100k_base` and `o200k_base`, using the larger count. Whole-record profile fitting
	is bounded to 16 attempts; the fixed character cap remains a size bound, not a token
	estimate. All 550 focused memory tests and API typecheck pass, including multilingual
	200/800-token cases, special-token-looking literal text and complete manifest entries.
	This qualifies these encoding families only, not arbitrary model aliases or latency.
	`gpt-tokenizer` 4.0.0 was installed from the approved Microsoft feed. Effective npm
	configuration omits resolved URLs; its recorded SHA-1 matches pinned feed metadata.
	Four package requests were observed across setup/recovery. The first provenance validator
	failed on its unsupported SHA-512 assumption; separate verification and encoder round
	trips passed. No independent installed-byte hash or unrelated-lockfile-diff claim is made.
- Archive API responses now enforce the 72 MiB ceiling from declared length and streamed
	bytes before decoding/joining JSON text. Cancellation rejects and releases the reader;
	split multibyte UTF-8 and normal error envelopes remain supported. All 163 sync tests
	and frontend typecheck pass. Other API response paths are unchanged; this bounds payload
	bytes, not total browser RSS or JSON parsing CPU.
- The archive browser canary passed synthetic workflow/structural checks on desktop
	1280x850 (51 frames) and mobile 390x844 (63 frames), with no external requests or page
	errors, at 2026-09-11T22:05:37Z. It exercised real Modal/saveFile, JSON downloads,
	pagination, escaped preview and hit testing, and exposed/fixed async-modal return focus.
	Screenshots show overlapping fallback icon names because external fonts are deliberately
	blocked: font-dependent paint is NOT qualified. Animation frames are retained; settled
	hit testing waits for the real finite entrance animation. Authenticated transport,
	physical mobile saving and full visual qualification remain open. Browser/server closed.
- Manage memory now exposes active-archive export and preview-only inspection. Export
	prepares metadata for a separate explicit Download; file preview rejects inputs above
	72 MiB before reading, uses server validation and shows 20 records per page with no
	restore/activation action. One 15-second deadline and account/operation guards prevent
	late or superseded results. All 69 focused settings tests and frontend typecheck pass,
	including escaped content, exact JSON metadata, pagination and cancellation. Browser
	paint/mobile file-saving and authenticated transport remain unqualified at this point.
- Raw memory evidence now labels active records as Expired, Not yet valid or Validity
	unknown when their temporal fields make them ineligible. Existing status labels and
	edit access are preserved; records are not moved or rewritten. All 60 focused settings
	tests and frontend typecheck pass. Labels use the device clock when rendered; live
	clock-boundary refresh and authenticated browser qualification remain separate work.
- S21 same-name child reports with different explicit relationships no longer merge their
	source IDs or ages. Ambiguous standalone name-age evidence updates neither entry;
	relationship-specific evidence, compatible duplicates and unambiguous generic upgrades
	remain supported. All 543 focused memory tests and API typecheck pass. Separate reported
	entries do not establish separate real-world identities; raw records are unchanged.
- The broader 11-file memory gate passes 539 tests after the manual admission/edit changes,
  with API typecheck passing. Cosmos admission fixtures now include the exclusion query;
  negative tests assert the intended partial/conflict receipt failure and verify the batch
  was reached, rather than succeeding on an unrelated missing mock operation.
- Active memory edits now check the resulting ID/hash/source lineage against exclusions
	even when the patch omits `status`. Forgotten text and stale ID-excluded records cannot
	bypass the restore checks through ordinary edits. All 314 focused memory tests and API
	typecheck pass. This does not add atomic exclusion/write coordination or reauthorization.
- Manual saves now reject content/hash or source-lineage matches to existing exclusions
	before record/index admission, instead of returning Saved for content that serving must
	reject. Unrelated saves remain available. All 312 focused memory tests and API typecheck
	pass. Explicit reauthorization is not implemented; existing deletion evidence is preserved.
- S40 memory inventory/profile reads now share one 15-second deadline per complete read,
  including local settings, every page and response waits. Abort reaches the real API
  transport; clear-device rejects pending reads and late continuations start no further
  page work. Both views offer manual Retry memory, retaining filter and draft without
  duplicate retry dispatch. All 156 sync tests, 56 settings tests and frontend typecheck
  pass. Already-started token/IndexedDB operations may remain uncancellable; no partial
  inventory or automatic retry is returned, and browser-paint qualification remains open.
- Abandoned startup attempts now stop after auth/access/credential awaits before starting
	more requests or changing cached configuration. Eight focused startup tests and frontend
	typecheck pass, preserving live definitive results, retry and optimistic cached-ready
	behavior. The 15-second bootstrap budget is unchanged; underlying auth promises are not
	forcibly cancelled. Validation uses a fixed windowless task and mocked authentication.
- Memory view/filter results are now keyed to the request that settled them, so old Active
	rows never commit under a newly selected Hidden filter before effects run. A Profiler
	regression observes every committed render through a delayed filter read. All 52 focused
	settings tests and frontend typecheck pass. Browser frame/paint and chat chronology are
	separate qualification surfaces; no chat ordering code changed here.
- S15 Evidence now loads only the requested raw status and remains usable when structured
	profile loading fails. Structured uses active inventory and retries its profile separately;
	raw filter selection survives view changes. Realtime and delayed mutation refreshes use
	the current view. All 51 focused settings tests and frontend typecheck pass, retaining
	account, stale-load, deletion and draft guards. No browser-paint qualification is claimed.
- S16 pending memory patches now have an immediate per-record claim with disabled/loading
	controls. Duplicate same-record writes are blocked, failure releases the claim and keeps
	the draft, and other records remain editable. All 49 focused settings tests and frontend
	typecheck pass. This does not add cross-tab idempotency or cancel already-dispatched writes.
- Bounded index pages now parse entries independently so a malformed record does not
	suppress valid neighbors. Invalid entries remain untouched and logs contain only an
	aggregate count. All 308 focused memory tests and API typecheck pass. Parsing stays
	within the requested limit; durable quarantine and all-invalid head-page starvation
	remain unresolved, and the consumer remains disabled.
- Confirmed deletion of any contributing source now invalidates stale combined profile
	text immediately, even if deletion of a second source fails. Remaining raw evidence
	stays accessible. All 47 focused settings tests and frontend typecheck pass. This is
	local rendered-state protection, not cross-device erasure or browser-paint qualification.
- S16 memory edit drafts retain their starting revision through background refresh,
  remain open after failed saves, and are not closed by completion of an older modified
  or reopened draft. Instant actions still use the current listed revision. All 46 focused
  settings tests and frontend typecheck pass. Conflict retry does not silently rebase;
  durable cross-session drafts and duplicate-write prevention remain separate work.
- The personalization master switch now explicitly enables Saved-only reads, matching
	new-account server behavior. It does not restore automatic learning from prior/default
	nested flags; learning remains a separate choice. All 41 focused settings tests and
	frontend typecheck pass. This is rendered component evidence, not authenticated browser
	or device-paint qualification, and local save completion still is not server acknowledgement.
- Structured profile responses now require explicit approval, while unapproved imports
	remain available in raw inventory for inspection and revision-safe approval. Profile
	evidence counts use the same current, owner-bound eligibility as projection. All 532
	focused memory tests and API typecheck pass, including import/approval transition and
	expired-only empty profiles. No stored records or learning policy were changed.
- V2 active archives require valid ISO timestamps for record, source-reference and
	summary provenance, and reject reversed validity intervals without repairing them.
	Legacy v1 parsing and stored records are unchanged. All 306 focused memory tests and
	API typecheck pass, including malformed provenance and source-identity controls.
- Profile/export exclusion checks now run over the completed collected inventory in
	batches of 100, so deletion during a later page cannot evade an earlier page's check.
	Query count remains ten for 1,000 records. All 300 focused memory tests and API typecheck
	pass. Deletion concurrent with the final checks is still not an atomic snapshot.
- S17 v2 active-archive inspection is available locally through
	`POST /api/memory/export?version=2`. Its strict envelope contains `version: 2`,
	`scope: "active-records"`, `exportedAt`, full `memories` and `summary`. Submit the
	same envelope plus `mode: "preview"` to `POST /api/memory/import`; the response's
	`archive` preserves the metadata without writing or activating records. V2 commit,
	foreign owners, duplicate IDs, inactive records, unsupported versions and excluded
	sources reject the whole request. Default v1 behavior is unchanged.
	All 298 focused memory tests and API typecheck pass, including 1,000-record JSON
	round-trip and zero-write controls. The v2 record cap is 1,000 and the existing HTTP
	request ceiling remains 72 MiB; both limits apply independently. Inactive records,
	exclusion ledgers, restoration/activation and a transfer UI are not included, so this
	does not complete S17. This source change postdates the full API unit fingerprint below.
- Shared API regression gate: 1,588 unit tests across 92 files passed in 4.84 seconds
	at local 2026-09-12 02:00:56. Before/after hashes matched for 260 API source/config
	files: `97d5e2328b4b48c78bf8afe8688af9409432c5b97a2cc0131c7050cb7073ccc3`.
	The quiet API gate now has a 120-second process ceiling, owned-tree hidden termination
	and first-failure stopping. Timeout cleanup is statically reviewed, not runtime-proven.
	Integration tests, runtime secrets/dependencies and authenticated production behavior
	are outside this evidence. Do not repeat this full gate without relevant source changes.
- S21 exact-age projection is now scoped to the intended child's name in direct,
  routed and merge paths. Another named person's exact age is not assigned to that child;
  ambiguous pronoun-only evidence after multiple named identities is omitted. All 510
  focused memory tests and API typecheck pass. This bounded grammar does not establish
  general entity resolution or same-name disambiguation; source records stay unchanged.
- S21 structured numeric age extraction now accepts a bounded exact-current assertion
	grammar instead of finding an unqualified number anywhere in evidence. Approximate,
	negated, historical and range statements keep child identity but omit exact age; empty
	routed age strings no longer become zero. All 507 focused memory tests and API
	typecheck pass, with existing exact/quoted controls preserved. Original text/quotes
	remain unchanged. Unsupported wording may omit age; general language understanding,
	cross-subject attribution and birthday inference are not qualified.
- S21 structured current profiles now reuse the reply-time validity predicate and
	enforce the requested owner. Expired, future-valid and invalid-date assertions are
	not projected as current facts; future update timestamps do not enter recent-history
	buckets, and invalid clocks are not silently replaced with wall time. All 500 focused
	memory tests and API typecheck pass. Raw records and timestamps remain unchanged;
	age/subject semantic qualification and profile evidence-count semantics remain open.
- New-account settings GET now uses the same memory-off/Saved-only initialization as
	first persistence, so unrelated saves do not flip the advertised controls. Existing
	account snapshots and the ordinary worker settings reader are unchanged. All 495
	focused memory tests and API typecheck pass, including the HTTP GET/save/explicit-enable
	sequence. Frontend paint and authenticated new-account onboarding are not qualified.
- S22 index claim responses must match the listed owner/job/memory/model/full revision
	and text hash, plus the requested execution token and running state, before any
	permission/credential reads or publication. All 494 focused memory tests and API
	typecheck pass; mismatches are counted as deferred without acknowledging the returned
	foreign execution. No rollout flag or existing job data was changed.
- S12 new-account settings persistence now starts with memory off and Saved-only nested
	preferences, then applies only the supplied patch. Appearance/voice/data or partial
	nested edits cannot implicitly enable memory; explicit master enable starts Saved-only,
	and explicitly supplied automatic-learning settings remain supported. Existing records
	and UI defaults are unchanged. All 486 focused memory tests and API typecheck pass,
	including HTTP sibling preservation after explicit opt-in and new-account effective-off
	behavior. Historical consent provenance and full onboarding qualification remain open.
- S18 current-execution checks now bind immutable thread, source kind, message IDs,
  full source revision, dedupe key, run ID and creation time as well as the operational
  token/attempt. Eight in-flight source-change regressions now prevent stale extraction
  writes and settlement. All 285 focused memory tests and API typecheck pass; this is
  not an atomic source/job/memory transaction or provider-side effect revocation.
- S13 profile/export inventory checks exclusion receipts once per page (at most 100
	records), matching owner-qualified IDs, hashes and source lineage. Stale forgotten
	rows now reject the collection instead of returning forgotten text or derived profile
	fields. All 274 focused memory tests and API typecheck pass; the 1,000-record mocked
	export uses ten parameterized exclusion queries with no memory text in parameters.
	This is not atomic collection/deletion, live Cosmos query qualification, or complete
	legacy-summary erasure. Existing exclusions and tombstones are unchanged.
- Summary reads and exports also check declared source IDs against exclusions, in at
	most five batches for the existing 500-source schema limit. Linked forgotten sources
	reject without mutating stored summaries. All 277 focused memory tests and API
	typecheck pass. Missing source provenance is not invented: unlinked legacy/manual
	summaries retain their existing behavior and are not independently erasure-qualified.
- S22 claimed index processing now shares at most one existing 120-second lease budget
	per pass, capped by each job's remaining lease. Cancellation reaches embedding and
	blocks later reads/publication after stalled credential, eligibility or embedding work.
	Expiry leaves the job for lease recovery and stops further claims; successful work
	removes timer/listener state. All 455 focused memory tests and API typecheck pass.
	Listing/claim waits and already-issued storage writes remain outside this guarantee.
- New S22 job admission canonicalizes due time to UTC with milliseconds without
	changing the saved assertion's timestamp, revision or job identity. Equivalent
	second-only and offset timestamps are immediately due at the same instant. All
	458 focused memory tests and API typecheck pass. Historical job normalization is
	not performed by this change and remains a separate migration concern.
- S22 index adapters now select by earliest `availableAt` before applying the existing
	batch limit. Tests cover insertion-order disagreement, requeue due times, exact-now
	eligibility and future exclusion. Cosmos retains one bounded `fetchNext`, with no
	continuation drain. All 264 focused memory tests and API typecheck pass. The consumer
	remains disabled; this is not live RU, complete pagination or starvation qualification.
- S18 dispatch recovery now isolates lookup and obsolete-acknowledgement failures per
	job. Wrong-owner/job results are not queued or acknowledged; later pending jobs and
	stale-worker recovery continue. All 262 focused memory tests and API typecheck pass.
	Global inventory-query failure and durable fairness across repeated failed pages
	remain separate concerns; provider-outcome-unknown work is still not retried.
- S12 recall and extraction now use a processing-only settings reader that requires
	persisted master/nested enablement and explicit boolean permissions. Missing records,
	legacy missing nested settings and unavailable reads cannot authorize processing.
	UI/default settings and persisted records are unchanged. All 444 focused memory
	tests and API typecheck pass, including real saved-only recall after permission.
	Persisted flags alone do not establish consent provenance: earlier unrelated settings
	writes may have persisted defaults. Existing containment and rollout gates remain.
- S15 client inventory collection now captures filters before asynchronous work and
	rejects clear-invalidated results, duplicate IDs and wrong-status records instead
	of publishing a mixed collection. Cursor tracking includes the requested initial
	cursor and continues through empty pages. All 146 sync/local tests and frontend
	typecheck pass, including 1,000 equal-timestamp records and fresh post-clear reads.
	This detects observed inconsistency, not a server snapshot or already-rendered UI
	clearing guarantee; identical duplicate IDs intentionally require a fresh retry.
- S18 extraction admission now binds new dedupe keys to owner, thread, source kind,
  message IDs and the full source revision. Command/turn regressions reproduced
  cross-thread job reuse; existing/admitted new-key records are now source-checked.
  Exact-source legacy jobs replay unchanged; mismatched legacy records are preserved
	without reuse. In-memory admission is atomic across its check and insert. Enqueue
	rejects misbound/deleted thread/message sources, and misbound worker claims stop
	before processing or settlement. All 433 focused memory tests and API typecheck
	pass. Drain old producers before promotion:
  mixed-version producers can still race across old/new keys. This is not complete
  source-write/enqueue atomicity or live Cosmos qualification.
- Resumed delivery after the chronology incident by explicit user direction.
	The current-user Limited ten-minute watchdog is enabled, with a successful actual
	scheduled canary and 35 passing guard tests. It remains log-only: missing external
	authority, execution bindings and cloud/durable telemetry block worker dispatch.
	A running timer is not a working unattended coding driver.
- S19 local candidate: inferred add/merge operations require explicit `normal`
	sensitivity before embedding/storage. Missing, `unknown` and `sensitive` proposals
	reject; normalization never invents a classification. Already-sensitive memories
	are excluded from automatic extraction context, merges and embedding backfill.
	A model's `normal` label is not independent semantic proof; legacy unknown-state
	migration and source attribution qualification remain open.
- S19/S20 local candidate: every mutation target must match a supplied current
	snapshot, including supersession. Eight reproduced stale/unprovided-target races
	now reject instead of overwriting or hiding newer memories. All 119 tests in the
	touched extraction/schema/normalizer slice and API typecheck pass. No deployment
	or independent all-finding closure is claimed.
- The real-UI chronology canary is now versioned under `tests/e2e/chronology` and
	available with `npm run test:chronology`: desktop 54 and mobile 52 observations
	passed; the 53-observation negative control detected the old inversion. These
	are deterministic local checks, not authenticated workflow qualification.
	Candidate promotion is held until the affected authenticated workflow and exact
	candidate chronology evidence pass; public health/shell smoke alone is insufficient.
- S20 local atomic publication: replacement embedding failure preserves the prior
	text/hash/revision/vector. Creating a replacement and invalidating up to 16 exact
	predecessor snapshots now uses one owner-partition Cosmos batch (Create plus
	ETag-bound Replaces), with matching all-or-nothing in-memory behavior. Invalid
	owner/snapshot/bounds, duplicate candidates and incomplete receipts fail closed;
	unconfirmed publication fails the job without success notices or compensation.
	Six related files passed 200 tests before the final unconfirmed-outcome case;
	latest store/service validation passed 148 tests and API typecheck passed.
	Real-Cosmos qualification, cross-record exclusion serialization and independent
	semantic evidence remain open, so this is not a production-ready S20 closure.
- Manual saves and imports now use create-only persistence: an ID collision cannot
	overwrite a prior saved memory. Manual creation returns conflict and import skips
	the colliding item. Both failures were reproduced before repair.
- S22 local vector consistency: optional `embeddingTextHash` binds exact embedded
	text. Retrieval and profile relevance require current owner/model/text/dimension
	identity and finite nonzero vectors; pinned memories cannot bypass this. Add,
	merge and guarded healing stamp fresh embeddings, while manual text edits clear
	the vector and stamp. Legacy unstamped vectors stay stored but ineligible until
	fresh embedding; no digest is manufactured for them. Unusable replacement vectors
	cannot invalidate their predecessors. Latest six-file vector/worker regression:
	260 tests passed, API typecheck passed. Independent indexing, migration, real
	provider semantics and authenticated release workflow qualification remain open.
- Chronology visibility qualification additionally detects hiding and restoring a
	prompt before completion. Latest normal desktop/mobile runs observed 56/55 states;
	inversion and hidden-prompt negative controls both detected the injected defects.
	The test respects the existing zero-progress `msg-in` entrance animation rather
	than changing product CSS to satisfy an incorrect visibility assertion.
- Background-only execution is now mandatory in repository instructions and persistent
	user guidance. Versioned quiet tasks never reveal/focus terminals or Problems;
	native checks use hidden process creation and captured output. The watchdog uses
	a fixed windowless `wscript` launcher. Its actual scheduled canary observed zero
	automation-owned window-show/foreground events, unchanged foreground focus, exit
	zero and no dispatch. All 37 watchdog tests and the quiet harness build passed.
- A cancelled chat run's delayed preparation/snapshot cleanup could remove a new
	run's reply. Two continuous-state regressions reproduced it. Ownership checks now
	prevent that cleanup from affecting the replacement; 25 chat tests, frontend types
	and the real-UI chronology canary passed. No sorting, timestamps, layout or product
	animation changed. This additional guard remains local, not production-promoted.
- S13 local deletion repair now verifies actual owner-bound exclusion receipts rather
	than assuming a deleted status proves exclusion. Known legacy tombstones are repaired
	and minimized transactionally; unknown provenance cannot receive a false success.
	Source exclusions and original timestamps are monotonic. Conflicting known hashes
	are preserved in immutable standard exclusion records readable by older code, with
	exact receipt snapshots/ETags and atomic archive publication or verified reuse.
	No deletion ledger is rolled back. Real-Cosmos qualification remains required.
- S15 local profile/export collection rejects repeated/cyclic cursors, foreign or
	inactive rows and contradictory revisions. Identical overlapping records are
	deduplicated; failures do not return partial inventory as complete. This detects
	observed inconsistencies, not a database-wide snapshot. Latest focused memory
	validation: 204 tests passed, API typecheck passed, all through quiet tasks.
- Broader local API regression at 13:50 UTC: 91 files / 1,135 tests passed with
	integration tests excluded. This baseline predates the subsequent focused repairs
	below and is not represented as final production qualification.
- S02 memory adapter point reads, conditional updates, pages and summaries now verify
	embedded owner/record identity. Incorrectly scoped pages fail rather than returning
	a partial inventory. Latest focused memory validation passed 214 tests and types.
- S44 artifact, skill and stream-retry diagnostics no longer emit filenames, blob
	paths, provider/container IDs or raw provider errors. Fixed events and safe counts
	remain; successful artifact contents and normal recovery are unchanged.
- S08/S09 run transitions and queued-start acknowledgements now accept an expected
	execution identity. Workers supply their immutable captured identity for claims,
	heartbeats, usage, cancellation and finalization; stale recovery additionally binds
	the observed heartbeat. Provider preparation/retries, tools and publication paths
	recheck run/thread liveness. Replaced or terminal executions cannot be completed by
	old callbacks, and an owned heartbeat is always released on worker exit.
- Run admission and terminal batches require exact complete operation receipts.
	Active-slot deletion is ETag-bound, and a conflicting run/slot transaction never
	falls through to a standalone terminal write. Dispatch acknowledgement requires the
	full pending identity and ETag; one record's read/ack failure no longer starves later
	dispatches. Cancellation tests retain interrupted output without provider replay.
- S10 premature stream EOF now records an incomplete-stream error, preserving partial
	text rather than falsely reporting success. Terminal events close the iterator;
	later events cannot change the response. Learning/completion notifications wait for
	a confirmed terminal run write, but separate message/thread/run persistence is not
	claimed atomic. Ownership checks stay inside actual snapshot writes so throttled
	token updates do not incur extra thread reads.
- S31 artifact download now enforces the existing 25 MiB ceiling while reading chunks,
	rejects oversized declared bodies before reading, and cancels/releases failed readers.
	Missing or understated lengths cannot bypass the actual-byte bound. The worker keeps
	oversized-file non-retry behavior; exact-limit and empty responses remain supported.
	Latest focused container/run/worker/admission/dispatch validation: 193 tests and API
	types passed. These local results do not qualify live provider behavior, in-flight
	erasure, real Cosmos execution, cross-store atomicity or authenticated release workflows.
- Binary artifact reads now keep their timeout/abort protection after headers without
	advertising SSE. Shared response wrappers release their source readers on EOF,
	cancellation and failure; request serialization failures leave no timeout handle,
	and already-cancelled requests do not invoke the transport. Focused HTTP/Responses/
	container/worker checks and API types passed; this is not a live provider claim.
- Artifact capture requires explicit assistant source provenance. Inactive or wrongly
	owned Library records block upload/publication; late observed deletion blocks new
	message/thread references. New artifact records use `createIfAbsent`, never upsert,
	so a concurrent tombstone wins. The typed Library port and Cosmos implementation
	retain existing update semantics for other callers. Latest nine-file focused
	validation passed 269 tests and API types.
- Image Studio now reuses create-only Library publication and checks owner/identity/
	active state before upload and readiness. Existing trashed/purged records, create
	conflicts and observed late purge cannot report ready or overwrite tombstones.
	All 26 image-worker tests and API types passed. Already-uploaded orphan cleanup and
	atomic cross-store readiness/deletion ordering remain open; production is unchanged.
- Chat-generated images now use the same create-only Library publication. Known
	inactive or wrongly owned items block uploads; cancellation/deletion observed after
	upload blocks later Library/message/thread references. Publication conflicts retain
	tombstones and surface the existing tool-error state. Successful image/tool-card
	updates still share the original snapshot. Latest nine-file focused validation:
	277 tests and API types passed. No format, rendering, timestamp or production changes.
- Library adapter reads now validate requested owner/identity before DTO grants;
	contaminated, contradictory or unrequested batch results fail wholly. Reservations
	are create-only. Completion uses an owner-bound ETag read and conditional replacement,
	so HEAD-time deletion or edits cannot be revived/overwritten. Active retries must
	match the original byte count and hash. The nine-file local check passed 308 tests.
	HEAD verification now aborts after 15 seconds, refuses redirects and emits a fixed
	retryable error instead of transport details; no failure activates the reservation.
	Metadata hashes are not independent content proof, and outstanding write grants
	still require an immutable-blob protocol. No live storage qualification is claimed.
- S43 partial Library improvement pushes existing non-text filters into parameterized
	owner-partition SQL while preserving local defensive checks, text matching, sorting,
	counts and cursor behavior. Invalid cursors reject before querying Cosmos. The latest
	two-file Library check passed 52 tests and API typecheck. Unfiltered scans, locale-aware
	name ordering, full bounded server pagination and live query/index qualification remain
	open. The five-minute first-delivery target was missed; pagination expansion stopped.
	These are local candidates only; production remains v0.2.2 and authenticated candidate
	workflow plus chronology qualification still blocks promotion.
- Storage-summary cache publication and failure cleanup are now bound to the exact
	pending read. A completion invalidation or newer read prevents an older aggregate
	from restoring obsolete cached counts. All 56 Library tests and API typecheck pass,
	including late-success and late-failure races. An already-started caller may still
	receive its original snapshot; multi-instance invalidation and cache-size bounds
	remain open. The separate ten-minute repair met its first-delivery target.
- Message attachment ingestion now creates Library items without overwriting concurrent
	tombstones, rejects unavailable/mismatched retained records before message persistence,
	and validates owner/id before reuse. All 23 message-service tests and API typecheck
	pass; logical ordering and server cursor timestamps remain unchanged. This is not
	atomic Library/message/thread publication or proof of in-flight erasure.
	The first headless chronology attempt timed out before observations at network-idle.
	One revised attempt used actual composer/fixture readiness under the same 15-second
	deadline: desktop 56 and mobile 55 observations passed; 55-observation inversion and
	61-observation hidden-prompt controls detected their injected violations. No chronology
	assertion was weakened. Both attempts are retained; authenticated end-to-end API
	qualification is still required before promotion.
- Message append rechecks thread liveness before persistence and replaces only its
	metadata fields through at most three fresh owner-bound conditional updates. Concurrent
	title/files/pinned/count changes survive, tombstones are not revived, and the operational
	cursor does not move backward. Learning follows only a confirmed thread update. All
	62 tests across message/run services and their HTTP controllers plus API typecheck pass.
	Message logical/server timestamps and rendering are untouched. Cross-store atomicity,
	duplicate-append accounting and recovery of durable-message/failed-summary gaps remain
	unresolved; no production or full DoD closure is claimed.
- Library summary caches now retain at most 256 entries, including pending reads;
	evicted reads cannot restore themselves, and same-owner replacement does not evict
	another owner unnecessarily. Pending upload verification checks the existing owner-path
	policy before signing or transport. All 63 Library tests and API typecheck pass.
	This bounds cache entry count, not request concurrency, inventory scans or blob content.
- S05/S09 local outboxes durably mark thread creation attempts before cloud dispatch.
	Deletion retains server cleanup for attempted or legacy-unknown creations, while
	explicitly never-dispatched creations preserve local-only deletion. A confirmed
	not-found delete is acknowledged; network, access and validation failures remain
	pending or inspectable. Both queue paths pass delayed-create/delete tests, repository
	reopen and dispatch-removal controls: 75 sync tests and frontend typecheck pass.
	The IndexedDB fixture now uses the real outbox operationId key. Mocked transactions
	do not prove browser crash durability, and an outcome-unknown remote creation still
	needs server-side deletion fencing. No authenticated production qualification is claimed.
- Coalesced thread/settings edits now replace the queued operation immutably with a
	fresh identity, so an older acknowledgement or permanent failure cannot consume the
	successor. Settings revision conflicts remain inspectable rather than automatically
	rebasing consent. Delayed settings success/conflict writeback re-reads current local
	choices and applies the existing stricter-privacy merge; every-write tests preserve
	newer restrictions/device choices, while explicit current enable remains supported.
	All 81 sync tests and frontend typecheck pass. Fresh-read/write atomicity and actual
	cross-tab crash behavior remain unqualified; hydration and chat ordering are unchanged.
- Transactional thread deletion now identifies message operations by their owning
	threadId instead of an unrelated message id. Local blob replacement invalidates only
	the owner's old object URL; pending reads are coalesced and publish only while their
	cache entry remains current. Clear/replacement invalidates pending publication, and
	stale failure cleanup cannot remove a newer URL. All 88 sync/local tests and frontend
	typecheck pass. These callback tests do not qualify browser paint or atomicity of
	every in-flight storage write; no persisted data is deleted as test compensation.
- Initial settings hydration now distinguishes untouched local defaults from newer
	local values or queued operation identities, including same-value explicit opt-outs.
	Only initially captured settings operations are removed; later edits remain queued.
	Every-write privacy/device controls and the untouched server-authority control pass:
	91 sync/local tests and frontend typecheck. Snapshot checks do not establish atomic
	cross-tab read/write serialization, and retained revision conflicts are not rebased.
- Cosmos message point/list reads now validate owner, thread and physical/logical identity
	before projection, preserving valid same-owner legacy rows and scoped preference.
	Bulk deletion requests only identity fields, validates every row before any delete,
	and treats only confirmed 404 as idempotent success. Other failures propagate rather
	than reporting complete cleanup. All 100 affected message/run/controller/adapter tests
	and API typecheck pass. No ordering, timestamp or streaming-upsert behavior changed;
	live Cosmos and complete erasure-ledger qualification remain open.
- Initial message acceptance now uses a dedicated create-only store operation; streaming
	snapshots retain their existing upsert path. Concurrent same-ID submissions return
	the owned stored winner without replacing its chronology or repeating count/learning
	followups. Conflicts with missing/misbound winners fail without blind retries, and
	retained tombstones cannot be recreated through this path. All 107 affected tests and
	API typecheck pass. Library preparation side effects, legacy insertion migration and
	durable-message/failed-summary recovery still require cross-store reconciliation.
	- Transactional local appends now count same-ID snapshots once and reject missing,
	  deleted or cross-thread targets before writes. Real two-page Chromium/IndexedDB
	  testing then exposed partial commits after synchronous outbox cloning errors, which
	  mocked transactions missed. Message, create, update, settings, queue mutation and
	  deletion helpers now explicitly abort and settle failed transactions. The nine-stage
	  isolated persistence canary passed at 2026-09-11T17:23:06Z, alongside 95 sync/local tests
	  and frontend typecheck. It uses fresh synthetic storage and no external traffic.
	  Crash/power-loss durability, other browsers and authenticated workflow qualification
	  remain open; timestamped failure and success evidence is retained locally.
- Synced memory profiles no longer silently fall back to an empty local profile after
	account/network failures; local-only mode remains available (98 sync tests and types).
	MemoryManager now publishes complete load snapshots only for the current request,
	ignoring stale success/error/loading completion across filters, realtime and unmount.
	Confirmed deletions invalidate older loads and partial batch progress remains visible.
	Confirmation copy describes exclusion, not guaranteed source/backup erasure. All 13
	Settings tests and frontend typecheck pass. These jsdom state tests do not qualify
	browser paint, future stale-server reads or complete deletion linearizability.
- Thread point/versioned reads now check requested owner and id; contaminated lists
	fail wholly and unavailable conditional tokens fail before a write. All 120 focused
	message/run/controller/adapter tests and API typecheck pass. Query order and existing
	composite indexes are unchanged; real Cosmos qualification remains required.
- S22 independent indexing candidate: when an embedding model is configured, manual
	saves and revisioned active approvals atomically persist a text-free index intent
	alongside the memory. Imports remain unapproved and unindexed until explicit approval.
	A separate timer handles at most three jobs per pass with two-minute CAS leases,
	three-attempt recovery, and atomic memory/job completion. It checks explicit persisted
	saved-reference permission independently of chat learning, plus containment, owner,
	revision, text hash, model, credentials and deletion exclusions around embedding.
	Save and chat paths perform no new embedding calls or inventory scans.
	`MEMORY_INDEX_ENABLED` defaults to false in the template and consumer; it has not been
	enabled or deployed. All 248 focused tests, API typecheck and API bundle build pass.
	Settings adapter reads also reject misbound records and require ETags for replacement.
	Live Cosmos/permission qualification, atomic consent revocation, historical/model-change
	backfill, job retention, whole-inventory recall and independent release evidence remain
	open. Saved-only profile behavior is unchanged. The Bicep change has editor diagnostics
	checked but no deployment or ARM compilation evidence in this local block.
- Independent index passes now contain per-job claim/settlement failures so one failed
	record does not starve following work (250 focused tests and API types). MemoryManager
	workflows capture a mounted account-scope token and stop later requests, state updates
	and notifications after switch/unmount. Realtime loads remain independently sequenced
	and StrictMode receives a fresh lifetime. All 20 Settings tests and frontend typecheck
	pass. Already-dispatched requests are not revoked and authenticated workflow/paint
	qualification remains outstanding.
- Account settings loading now retains one account scope across hydration and local
	reads, rejecting scope changes instead of mixing owners. The settings hook ignores
	superseded loads, old-owner/unmounted completions and older appearance saves; a load
	cannot overwrite a newer local save. All 31 Settings tests, 100 sync/local tests and
	frontend typecheck pass. Optimistic save state and already-dispatched request behavior
	are unchanged; these results do not establish cancellation or cross-store atomicity.
- Confirmed memory exclusions remain effective across fresh stale reads for the mounted
	manager, while actual deleted-state tombstones remain inspectable. Client and server
	effective policy now require both master and nested enablement: either explicit off
	disables memory references and learning without rewriting stored preferences. A partial
	compatibility opt-out performs no context inventory read or query embedding. All 319
	focused API tests, 36 Settings tests and both typechecks pass. Complete-inventory recall
	and persistent cross-session deletion evidence are separate remaining gates.
- Recall now clamps caller budgets to the existing 800-token character estimate and
	rejects invalid/nonpositive budgets before I/O. Optional cancellation propagates from
	the run worker's existing recall timeout through context assembly to Azure embedding
	fetch; observed aborts stop subsequent memory work and run cleanup closes the signal.
	All 420 focused worker/adapter/context checks and API typecheck pass. Existing 3000ms
	recall and 10000ms embedding deadlines remain unchanged. The 500ms DoD latency target,
	tokenizer-accurate budgeting, explicit degraded metadata and cancellation of in-flight
	Cosmos operations remain unqualified. No live provider request or deployment occurred.
- S23 partial old-pin repair: an incomplete recent-200 candidate page triggers one
	owner/eligibility-filtered pinned query capped at 16. Exhausted pages retain one read;
	no pagination loop or ranking change was added. Conflicting duplicate snapshots fail
	closed, and cancellation, final freshness/exclusion checks and the context budget
	remain enforced. 50/200/201/1000-record fixtures and 339 focused API checks plus
	typecheck pass. At most 216 returned candidates are considered. More than 16 pins,
	older unpinned semantic recall and actual database resource/latency qualification remain
	open; this is not whole-inventory S23 closure.
- Revision-only memory patches now reject before approval or mutation. Actual manual
	text corrections invalidate old routing, summary, entity/topic and embedding metadata,
	while source quotes, temporal validity and supersession remain intact. Same-text and
	flag-only edits preserve derived metadata. Approved manual profile parsing uses current
	text rather than historical quotes; inferred-record parsing is unchanged. All 352
	focused API checks and typecheck pass. This does not migrate previously corrected
	records or prove general semantic extraction accuracy.
- The settings API now accepts the partial nested memory patches emitted by the client
	and merges supplied fields without losing siblings. Unknown nested keys still reject,
	stale revisions cannot write, legacy enablement is preserved, and nested edits cannot
	turn a master opt-out back on. All 367 focused API checks and typecheck pass. Actual
	authenticated settings-flow qualification remains a release gate.
	- Memory preference controls now await local persistence, prevent overlapping saves,
	  and offer explicit retry with a fixed error after failure. Retry applies only the
	  intended memory patch to current settings; late old-owner/unmounted failures are
	  ignored. Premature enabled/disabled toasts were removed because local outbox persistence
	  is not server-policy acknowledgement. All 40 Settings tests and frontend typecheck
	  pass. Browser paint and authenticated server consent propagation remain unqualified.
- Explicit invalidated-memory restoration now starts a new validity interval while
	retaining up to 16 prior timestamp/revision intervals. Invalid or future intervals,
	superseded assertions, full history, stale revisions and ID/hash/source exclusions
	reject without mutation. Active-but-expired records are not silently reactivated;
	deletion still minimizes the record. All 396 focused API checks and both typechecks
	pass. Legacy records without history remain readable; older strict readers must be
	upgraded before this new optional field can be promoted. No migration or deployment
	occurred, and atomic exclusion changes across the final write remain unqualified.
- Model-facing memory exclusion checks now include known memory identity as well as
	hash and source lineage. Changed legacy content cannot bypass an existing ID receipt
	in recall, indexing or extraction eligibility. The optional ID predicate uses the same
	owner-partition query; three-argument hash/source callers remain compatible. All 400
	focused API checks and typecheck pass. Concurrent exclusion after the final check and
	live Cosmos qualification remain outstanding.
	- Independent index completion now changes only embedding/model/text-hash fields,
	  preserving assertion time and content revision. Old assertions no longer move into
	  Today solely because indexing finished, and content edits retain their expected
	  revision. Full-snapshot and ETag fences remain; attempts to change text, revision or
	  time through index publication reject. All 404 focused API checks and typecheck pass.
	  Legacy extraction-triggered repair remains a separate path to qualify.
- Legacy extraction-triggered embedding repair now also preserves assertion revision
	and time, retaining its existing eligibility and conditional-write checks. Independent
	indexing rechecks persisted saved-use permission after its final eligibility reads,
	preventing the tested pre-dispatch revocation from sending saved text. All 405 focused
	API checks and typecheck pass. This does not revoke an already-dispatched provider
	request or make policy checks and external dispatch atomic.
- Uncached synced Library assets now require a matching active/trashed Library result.
	Missing, non-readable or mismatched records cannot fall back to a legacy grant or an
	embedded direct URL. Non-Library direct URLs and explicit local-cache behavior remain
	supported. All 109 sync/local tests and frontend typecheck pass. Offline cached-byte
	revocation and complete asset erasure remain separate requirements.
- Identical concurrent asset resolutions now share one pending grant/download/cache
	write within their current clear epoch. Distinct copied identities stay separate,
	failed or empty results can retry, and old cleanup cannot affect fresh post-clear
	work. All 114 sync/local tests and frontend typecheck pass. Persistent cache key
	migration, pending-work cardinality and fetch deadline/byte limits remain separate
	requirements; no browser or live-storage qualification is claimed.
	- Shared asset resolutions now have one 15-second deadline spanning cache, Library,
	  grant, download and body waits. Optional signals reach the real API client and fetch;
	  clear-device aborts pending resolutions, late continuations stop before further work,
	  and successful resolution removes its timer/listener. All 125 sync/local tests and
	  frontend typecheck pass. Already-started IndexedDB operations remain uncancellable;
	  response byte limits and pending-work cardinality are not qualified by this change.
- Legacy asset cache downloads now enforce the existing 25 MiB per-file ceiling from
	both declared length and actual streamed bytes before constructing a Blob. Rejected
	and stalled bodies are cancelled and acquired readers released; there is no unbounded
	buffering fallback. All 133 sync/local tests and frontend typecheck pass, including
	exact-limit success, missing/understated headers and reader failures. This does not
	bound Library direct URLs, browser/network buffers, or concurrent resolution count.

- S25 admin authorization now requires a configured immutable OID. A matching email,
	preferred username, or email-array alias cannot grant administrative access. The
	constructor retains its email argument for caller compatibility, but it grants no
	authority. Six new negative controls reproduced the old behavior; the repaired
	access/controller/JWT/identity checks pass (4 files, 26 tests), and API typecheck
	passes. This is not deployed and does not close S25: legacy email invitations,
	verified redemption, and actual CIAM integration remain open.
	Subsequent candidate work binds first verified invitation redemption to issuer/OID
	with a mandatory ETag and records its timestamp. Later access uses that immutable
	tuple even if email changes. Redemption requires the direct email claim plus boolean
	`email_verified=true`; aliases or missing issuer/OID cannot redeem. Concurrent owners
	cannot overwrite a binding, repeated invite creation cannot reset it, and stale
	redemption cannot recreate a deleted invite. Thirty-nine focused tests and API
	typecheck pass. Actual CIAM emission/trust of the verification claim is unqualified;
	missing claims fail closed, and no live invitation migration or deployment occurred.
	The shared identity helper also rejects non-string OID/subject values instead of
	coercing objects, arrays or numbers into partition keys. Fifty related identity,
	authorization and HTTP-boundary tests pass.
- S26 candidate binds credential updates to the normalized endpoint: changing it
	requires an explicit replacement key and does not silently inherit the old provider's
	knowledge-base ID. Stored legacy endpoints are validated before key decryption.
	The shared credentialed fetch requires HTTPS, an approved Azure endpoint family,
	no user-info/nonstandard port, a same-resource destination, and disabled redirects.
	Direct OpenAI/custom endpoints now fail closed; a separately authorized compatible
	provider mode is not implemented. Private DNS resolution/rebinding protection and
	the complete provider egress inventory remain open. These changes are not deployed.
	A subsequent direct-fetch audit found chat/embedding paths outside `aiFetch`; both
	now use its extracted `validatedAiUrl` guard. Direct chat/embedding and fixed-host
	Tavily fetches reject redirects. Eight regressions failed before this follow-up;
	45 focused tests and API typecheck pass afterward.
- S28 candidate preserves explicit blank/null optional integration clears, while omitted
	fields retain the latest value. Settings tracks edits and exposes a saved web-key
	removal control; four component tests and frontend typecheck pass. Credential writes
	now require owner-bound ETags (or create for an absent record), reread after conflicts
	at most three times, and refuse to recreate a concurrently removed record. The stale
	model-save/clear race failed before repair and passes afterward; 43 focused service,
	controller and Cosmos adapter tests plus API typecheck pass. The Key Vault current-key
	cache now expires after five minutes, evicts rejected lookups, and permits one refresh
	for stale-key wrap failures; exact historical-version unwrap remains unchanged.
	Fourteen mocked wrapper tests and 66 related crypto/credential tests pass. A local-only
	browser canary verified real Settings hit-testing, clicks and null-clear payloads at
	desktop/mobile sizes with zero external requests; its fixture blocked the external
	icon font, so final glyph rendering is not qualified. Actual concurrent cloud and
	authenticated production UI validation remain open. No S25/S26/S28 code is deployed.
- S27 candidate requires membership in the owned thread before provider-file deletion.
	Skill uploads reuse only locally observed successful receipts bound to owner, endpoint,
	credential context and content; same-name provider listings are no longer trusted.
	Receipt/inflight caches are bounded to 256 entries, receipts expire after ten minutes,
	failed bootstrap upload exposes no mounted skills, and the worker supplies the run owner.
	Client thread writes can no longer assign vector-store IDs; server-owned read metadata
	and upload paths remain intact. Ownership/worker tests pass (74), thread write tests
	pass (41), client mapping tests pass (44), and both typechecks pass. Existing legacy
	provider IDs still need a durable ownership registry, quarantine/migration, and verified
	deletion receipts; cross-restart provisioning may re-upload instead of trusting names.
	New thread-file/vector references also carry a server-recorded canonical provider
	origin. Uploads do not reuse unknown or foreign store bindings, CAS checks include
	origin changes, and cleanup only sends matching references to that provider. Both
	code-interpreter document mounts and thread file-search stores require matching
	provenance; an invalid thread binding cannot silently enable account-KB fallback.
	Ninety-four worker/file-service tests and API typecheck pass; the later no-decryption
	legacy cleanup refinement passed 35 file-service tests. Legacy references remain
	unverified, explicit account-KB ownership is still separate, and no provider erasure
	or complete registry migration is claimed.
	- S31 candidate rejects encoded thread uploads above 25 MB before `Buffer.from` decoding,
	  bounds data-URL prefixes and rejects malformed base64. Real below/exact/above-cap
	  tests pass. Skill ZIPs use fflate's pre-extraction filter to abort on declared entry/
	  aggregate limits, excessive entry count (including hidden/duplicate entries), unsafe
	  paths and stored-entry size mismatches. Fifteen archive tests and 61 affected ingestion/
	  catalog/provisioning tests plus API typecheck pass. Upstream HTTP body buffering,
	  dishonest DEFLATE length/CPU limits, and actual MIME/hash activation remain unproved;
	  this is not complete archive-bomb protection or S31 closure.
	The function HTTP boundary now caps actual streamed input at 72 MiB before standard
	JSON/multipart parsing, preserving the 50 MiB ZIP base64 contract and tighter service
	caps. Oversized declared lengths reject before reader acquisition; actual overflow
	cancels the stream even with absent/lying headers. Fifteen boundary tests, 43 affected
	HTTP tests and API typecheck pass. Azure pre-invocation buffering remains unverified.
- S32 candidate caches actual returned delegation-key expiry and clamps SAS start/end
	to its usable validity interval at signer precision. Invalid TTLs reject before key
	acquisition; expired/future/malformed keys do not poison the cache. Eighteen synthetic
	signer tests, 27 asset tests and API typecheck pass; no live SAS or legacy-asset
	migration qualification is claimed.
- S30/S09 follow-up rechecks thread liveness after provider indexing and before original
	blob persistence; final file linking uses at most three fresh-state CAS attempts and
	records Library only after a successful link. Changed provider bindings and tombstones
	reject activation without repeating provider uploads. Shared thread CAS is now
	replace-only with required ETags, so physical deletion cannot become an upsert create.
	Ordinary thread creation uses create-if-absent, returning the stored winner/tombstone;
	edits and soft deletion reapply only intended fields to fresh state with bounded CAS.
	Ninety-six affected thread/message/lock tests and API typecheck pass. Provider/blob
	orphan reconciliation, post-link Library failures and cross-store atomicity remain
	open; no claim of a complete resumable ingestion or deletion ledger is made.
	File removal also detaches registered references with bounded CAS before credential
	lookup or provider cleanup, clears the last store binding atomically, and never writes
	the old thread snapshot afterward. Fifty related tests and API typecheck pass; cleanup
	erasure receipts are still not implemented.
- S44 candidate makes explicit internal errors generic as well as unknown errors.
	Controller and outer HTTP boundaries emit only a fixed event/category and optional
	validated numeric dependency status; no raw error text, stack, URL or request content
	is logged by this diagnostic. Logging failure cannot replace the safe response and
	controller-handled errors are not logged twice. Twenty-nine focused error-boundary
	tests pass. Live telemetry ingestion and complete usage accounting remain open.
	Agent Responses completion events now preserve validated token observations on the run
	through conditional transitions. The optional field is explicitly scoped to agent
	Responses only, capped at 32 observations with truncation marked, and records unknown
	rather than fabricated zero usage when counts or response identity are absent/invalid.
	Identical provider IDs deduplicate; conflicting reports become sticky, uncountable
	unknowns. Already-recorded observations survive later errors/cancellation; cancellation
	wins over new writes, and two lost persistence attempts produce only an unconfirmed
	diagnostic. Ninety-seven focused tests and API typecheck pass. Router, title, image,
	speech, embedding calls, pricing and aggregate spending enforcement remain excluded.
- S19 candidate no longer synthesizes source IDs for unreferenced model operations.
	Non-ignore operations require explicit owned, same-thread, user-authored message
	references; any invalid member rejects the operation and duplicates do not multiply
	evidence. The pre-extraction source snapshot is stable and commit checks compare full
	content, identity, owner, thread, speaker and chronology, including edits beyond the
	500-character stored quote prefix. Fifty extraction/privacy tests and API typecheck
	pass. This is syntactic provenance and freshness evidence, not semantic entailment,
	sensitivity attestation, frozen E01 evaluation, or atomic cross-store commit proof.
	Follow-up merge and backfill commits recheck policy, exclusion and the current target
	after embedding; retries are eligibility-gated and writes are revision-conditional.
	New replacements recheck source/policy/exclusion after embedding and are saved before
	conditional supersession. Approved targets cannot be automatically invalidated.
	Deleted records reject conditional writes even with legacy unchanged revisions, and
	new tombstones advance revisions. Sixty focused store/service/extraction tests passed.
	A later merge consistency repair saves the new content hash and clears an old-text
	vector when re-embedding fails; all 47 extraction tests and API typecheck pass.
	Partial supersession can leave both records active; creation, policy and exclusions
	are not one atomic transaction. No candidate deployment or complete S19-S22 closure
	is claimed.
	Automatic suppression now uses policy/exclusion-gated revision writes. Queued command
	and turn jobs reject changed target revisions before extraction. A confirmed-record
	map deduplicates equivalent adds within one batch, including after an initial failed
	write; 56 extraction tests and API typecheck pass. Cross-job uniqueness is not proved.
- S22/S13/S15 read-side candidates reject incompatible dimensions, invalid vectors and
	unknown/different embedding models before semantic ranking, including pinned records.
	The profile relevance gate requires a matching model and no longer opens when a
	configured query embedding fails. Profiles admit only whole records within their
	character budget, so truncated multiline fragments cannot evade the context manifest.
	Before returning context, selected records are checked against immutable read snapshots
	and current exclusions, followed by the existing final policy check. A mismatch or
	unavailable read drops the whole memory block. Validation performs at most one get
	and one exclusion check per unique selected ID, none for empty context. Forty-four
	retrieval/profile/context tests and API typecheck pass. This adds selected-record I/O;
	latency qualification, independent indexing, projection hashes and the race between
	final validation and downstream dispatch remain open. No candidate is deployed.
	Later profile work tracks exact renderer-selected IDs instead of substring matches,
	uses the actual serialized context for character-based token estimates and admission,
	and shares the schema's 16-record cap with profile rendering and final checks. Forty-six
	context/profile tests and types pass. This is not a model-tokenizer measurement.
	Extraction job errors and read/write embedding diagnostics now omit provider-controlled
	payloads. Future deletions retain minimal schema-valid tombstones without original
	text, quotes, summaries, labels or vectors. Exclusion publication requires the current
	revision and a conditional Cosmos batch Replace alongside the exclusion Upsert;
	three fresh-read service attempts cover concurrent corrections, and failed commits
	cannot acknowledge deletion. One hundred thirty affected tests and types pass.
	Existing payload-bearing tombstones are not migrated and live Cosmos qualification,
	source conversation/provider/backup erasure and downstream dispatch fencing remain open.
	A subsequent exclusion fix removes generic unidentified lineage keys such as manual:::;
	unrelated saved memories remain eligible, while exact-content and identified-source
	exclusions still apply. Hashless legacy records get an exact-content hash before payload
	minimization. New inferred assertions use deterministic create-only identities, with
	verified conditional merging after conflicts; concurrent jobs and lost-receipt replay
	do not create duplicate new identities. Sixty-five extraction tests and API types pass.
	Legacy random IDs are not migrated and exclusion checking is not atomic with creation.
- S36 follow-up fences delayed recorder finalization and pre-send settings waits after
	mute, exit, unmount or a new capture. Effect setup is StrictMode-safe; finalizing
	recorders remain cancellable, cancelled stop promises settle, and synchronous stop
	errors release tracks. VoiceMode subscribes to interruption events and ignores events
	from old recorders. Seventeen component tests and six shared recorder tests pass,
	with frontend typecheck clean. Native-device and browser qualification remain open.
- S10 long-lived-tab follow-up: the reported 2026-09-11 BFCache WebSocket disconnect
	recovered automatically in 9.582 seconds. This is not evidence of a lasting outage.
	Local RealtimeClient changes prevent duplicate connections during reconnect and reject
	late negotiation/start completions and events after stop. Fixed SignalR diagnostics
	replace raw token-bearing library messages; native browser transport errors may still
	include connection URLs. Twelve network-free realtime tests and frontend types pass.
	Existing resume sync and automatic reconnect remain; no token was replayed and no
	production deployment occurred for this follow-up.
- S37 completion no longer resets existing account preferences to defaults. Returning
	to edit model configuration clears prior probe results, and pending probes/saves block
	conflicting wizard actions. Five onboarding tests and frontend types pass; optional
	models remain untested until explicitly used. Shared microphone monitoring now releases
	tracks on setup failure and cleans up idempotently; nine audio tests and types pass.
	The bounded integrated-browser audio canary timed out during navigation before media
	assertions ran. Its owned server was stopped; browser/native qualification is unclaimed.
- S29 image candidates recheck job status and execution identity after credentials,
	generation, upload and Library lookup; remix source readiness and blob identity are
	rechecked after download. Deleted or superseded jobs do not start or publish the tested
	late side effects. Image removal now excludes the serving record before best-effort blob
	cleanup, and realtime notification failure cannot abort generation. Twenty-seven image
	service/worker tests and API types pass. Already-uploaded orphan cleanup, cross-store
	publication atomicity, complete reference ledgers and physical erasure remain open.
- The profile relevance witness must now belong to the combined emitted-record manifest,
	so a deleted or budget-omitted candidate cannot open unrelated profile context outside
	final validation. Forty-three context tests and API types pass with no additional I/O.

### Combined local checkpoint

Recent local follow-ups validate at most 20 existing-memory candidates before extractor
disclosure, excluding changed/deleted/unverifiable records (83 extraction tests and API
types). Sync upload preparation and media resolution now share the clear-device
generation, preventing new transfers, URL returns and cache writes after clearing at
tested await boundaries (60 sync tests and frontend types). Transfers already sent and
cross-tab races remain outside these instance-local guards.

Onboarding operation generations prevent a chat probe starting after unmount (six
tests). Library pagination rejects old responses even after returning to the same
filter. Library upload batches carry abort signals through preparation, reservation,
PUT retries and completion; unmount or batch replacement cancels subsequent files and
stale progress (15 view/upload tests, frontend types). Already-created reservations
and dispatched completion requests require server reconciliation and are not undone.

Later local follow-ups fence memory-job completion/error receipts to the claimed
owner/status/release/token/attempt/timestamp and recheck execution before extraction,
embedding retries and mutation. The existing dispatcher conditionally marks jobs
untouched for more than 30 minutes as outcome-unconfirmed, without provider retry or
invented zero-effect counts. Incomplete admission results and unfenced transport
acknowledgements are rejected. Ninety-two job/extraction/dispatch tests pass; subsequent
pre-provider consent/source/owner checks pass the 77-test extraction suite and API
typecheck. This still does not make policy/job/memory writes one atomic transaction.

Library decode completions now belong to the current load attempt (four tests), and
detail-load failure has a same-item Retry action (eight tests). Prepared download
bytes and requests clear at device/owner boundaries; late save/share/fallback actions
are generation-fenced and helper-owned blob URLs revoke once on clearing or expiry.
Twenty download/owner/Library tests and frontend types pass. Already saved files and
native shares already opened cannot be retracted; ordinary fetch cancellation and
automatic signed-URL renewal remain outside this change.

Clear-device follow-up now advances an in-instance sync generation before clearing.
Old queue reads cannot migrate or dispatch cleared operations, and late settings
success/conflict responses cannot restore settings or bookkeeping. Old thread/message
pulls and settings hydration are discarded before local merges/cursor writes; fresh
post-clear sync remains allowed. Fifty-five SyncRepository tests and frontend types
pass. Cross-tab persistent fencing, concurrent user CRUD/backfill and uploads already
underway remain separate work; previously dispatched server effects are not undone.

Realtime now resumes a previously requested, fully disconnected connection on
online/page-show/visible events; it does not duplicate an active reconnect or restart
after stop. Nineteen fake-transport tests and frontend types pass. No production
token was used and native browser BFCache behavior was not requalified.
Image stale recovery also checks the selected execution's update timestamp, so a
new heartbeat or replacement execution wins. Conditional-store/dispatcher checks
pass (21 tests); image heartbeat failures are contained with fixed diagnostics
(19 worker tests). API types pass. These are still local candidates.

The 2026-09-11 10:44 UTC consolidated unit checkpoint ran once after the shared
memory/image/realtime/frontend changes. Root: 89 files, 573 tests passed. API:
91 files, 992 tests passed and one run-worker fixture failed because its synthetic
vector omitted the now-required embedding model identity. That fixture now records
its actual stub model; the affected 59-test run-worker suite passes. The full API
suite was not rerun after the fixture-only correction. Existing current typechecks
remain passing. This is local unit evidence, not integration, browser, deployment
or independent release qualification.

After these shared-source changes, one combined regression pass completed:

- Root unit suites: 89 files, 549 tests passed.
- API unit suites: 86 files, 719 tests passed; cloud integrations remain excluded.
- API esbuild and frontend/API typechecks passed.
- No root production build, deployment, provider call, or repeated full browser matrix
	was performed for this checkpoint. Earlier release bindings do not cover this dirty
	candidate tree and must not be reused for promotion.
	The later direct-fetch follow-up is covered by its focused tests, not by claiming
	the earlier complete-unit checkpoint ran on the later source.
- A subsequent API-only regression pass after invitation, ingestion, SAS, HTTP,
	thread-concurrency and usage changes passed 90 files / 842 tests, followed by an API
	build. The unchanged frontend suite was not rerun. Later direct-chat streaming reuse
	and shared SSE reader cleanup passed 64 focused tests and API typecheck: stalled reads
	settle, CRLF framing works, and DONE/early consumer exit cancel and unlock the body.
	Those later edits are not represented as covered by the preceding complete API run.
- H05 stage migration and removal of obsolete production-account grants are recorded
	in `evidence/h05-stage-whatif.json`. Health and RBAC readback do not prove effective
	runtime denial after token propagation or the complete advertised capability gate.
- The installed local continuation task observes every ten minutes with a twenty-minute
	stale threshold. It remains log-only because signed execution authority and attested
	cloud-outcome state are missing. A tested guarded foreground adapter is not proof
	of unattended editor-session continuation. See the harness README for controls.
- 2026-10-11: these local candidates were integrated onto master and released as 0.2.4
	(API on Node 20, frontend on Pages); see `documentation/releases/2026-10-11-v0.2.4.md`.
	This is a Continuous Production Milestone, not a DoD receipt: no finding is closed,
	H01 remains BLOCKED_SAFE and the Node 24 production runtime is still a separate milestone.
