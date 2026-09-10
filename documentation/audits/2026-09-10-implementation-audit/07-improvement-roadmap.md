# Improvement roadmap

**Status: proposal, not approved implementation.** No production resource,
application behavior or dependency was changed by this audit. This roadmap
links the [scorecard](01-scorecard.md), subsystem findings and
[acceptance specification](08-acceptance-and-evaluation.md).

## Decision rules

Prioritize in this order:

1. Prevent violations of isolation, consent, deletion and accepted-work guarantees.
2. Restore understandable user controls and reproducible delivery.
3. Demonstrate memory usefulness against a simpler baseline.
4. Improve experience and efficiency using measured bottlenecks.
5. Consider new architecture only when the cheaper design fails a documented gate.

Do not interpret a numerical score as permission to postpone a P1 trust issue.
Do not batch the memory redesign, runtime upgrade, dependency majors and
provider changes into one release.

## Phases and exit gates

| Phase | Deliverable | Exit gate |
| --- | --- | --- |
| 0: Establish a safe baseline | Reproductions for trust-critical findings, supported runtime/config contract, initial deterministic release gate | Critical known failures have tests/containment; artifact and environment identity are explicit |
| 1: Make memory understandable | Separate use/learning controls, correction/forget semantics, honest recall status, small approved-profile mode | User can predict the next reply's behavior; stale jobs cannot override consent/correction |
| 2: Earn better memory | Versioned evidence and projections, robust bounded retrieval, deterministic lifecycle, paired evaluation | Candidate beats current and simple baselines without safety/negative-slice regression |
| 3: Harden the whole product | Durable job recovery, account-scoped client state, asset lifecycle, accessibility, release/recovery operations | Critical end-to-end journeys and staged interruption/restore exercises pass |
| 4: Optimize selectively | Stage-based performance/cost tuning and optional graph/agentic-memory experiment | Improvement is measured; complexity and ongoing costs have an owner |

Trust repairs in phase 3 must be pulled into phase 0 when the detailed finding
shows data exposure, destructive loss or irrecoverable accepted work. Phase
names are work groupings, not permission to postpone high-priority failures.

## Delivery conventions

Each work package can produce several small PRs: contract/tests first, backend,
client, migration, then release evidence. One owner remains accountable across
those PRs. Role names below do not imply a large team.

Estimates are **rough engineer-day ranges**, excluding access/approval waits,
provider billing, and unresolved research. They are planning hypotheses, not
commitments. Re-estimate after the first reproduction and schema decisions.
Parallel work only helps when contracts are stable; two agents editing the same
state machine is not useful parallelism.

## Engineering and operating work packages

### W01 - Supported runtime and configuration contract

- **Findings/categories:** OPS-01, OPS-02, OPS-09; C12, C04, C09.
- **Owner / estimate:** platform maintainer; 2-4 days.
- **Changes:** pin a supported Node baseline across local/CI/Functions; inventory
  all environment inputs and resource dependencies; distinguish required and
  optional capabilities; reconcile SignalR and managed settings; use references
  for secrets. Separate dependency-major upgrades.
- **Dependencies:** none; can run alongside memory reproductions.
- **Acceptance:** clean install/build on target runtime, isolated provision
  plus no-op redeploy, capability health and a complete synthetic run.
- **Rollout/rollback:** staging then production; save previous compatible
  artifact/configuration. Do not use a blind full-settings replacement or
  restore secret values from repository files.
- **Research:** O01-O03, O07, O14.

### W02 - Reproducible release gate and browser stability

- **Findings/categories:** OPS-03, OPS-10; C11, C12.
- **Owner / estimate:** maintainer with frontend support; 3-5 days.
- **Changes:** locked installs, unit/type/build gates, exact artifact promotion
  and build SHA; correct ambiguous action locators and fixture readiness;
  controlled browser worker count; initial production-build smoke test.
- **Dependencies:** W01 runtime choice; can prepare the workflow earlier.
- **Acceptance:** all required gates block promotion; complete browser matrix
  passes three clean configured runs; injected failures still fail; exact
  release artifacts are traceable and restorable.
- **Rollout/rollback:** establish CI-only validation before deployment
  automation. Prefer narrowly scoped OIDC, reviewed environments and explicit
  compatibility with older cached clients.
- **Research:** O04, O10, O11.

### W03 - Content-safe observability and unit economics

- **Findings/categories:** OPS-04, OPS-06, OPS-07; C05, C06, C12, C13.
- **Owner / estimate:** backend/operations; 3-6 days.
- **Changes:** correlated run stages and reason codes; queue age and terminal
  outcomes; memory degradation and notification status; token/tool usage,
  Cosmos RU and fixed-capacity allocation; per-user reservations and explicit
  spend/concurrency policy.
- **Dependencies:** stable run identifiers and effective policy contract; cost
  enforcement must coordinate with the durable execution work package.
- **Acceptance:** synthetic faults are visible without content/secrets in logs;
  costs include failed/retried attempts; concurrent requests cannot overspend
  the same reservation; budget overshoot limits are documented.
- **Rollout/rollback:** telemetry first with content exclusion tests; staged
  accounting before enforcement; explicit user-visible rejection when a budget
  is exhausted, never a fabricated successful response.
- **Research:** O06-O09, O16, O17.

### W04 - Recovery, retention and documentation truth

- **Findings/categories:** OPS-05, OPS-08; C08, C10, C12.
- **Owner / estimate:** platform/data maintainer; 3-6 days.
- **Changes:** document and configure coherent recovery/retention across Cosmos,
  blobs, wrapping keys and provider assets; preserve consent and deletion
  ledger during restore; one current architecture/environment contract; label
  proposals and historical benchmarks.
- **Dependencies:** deletion/versioning contracts from memory and assets.
- **Acceptance:** timed isolated restore with a subsequently forgotten fact;
  restored facts remain ineligible; wrapping keys and media resolve; retention
  and residual backup copies are accurately disclosed.
- **Rollout/rollback:** dry-run policy review before retention changes; never
  reduce retention irreversibly as part of an unrelated deployment; restore
  into an isolated account before directing traffic.
- **Research:** O03, O11-O13.

## Core correctness and memory work packages

### W05 - Owner-qualified data and canonical storage references

- **Findings/categories:** BE-01/02; FE-01 dependency; C05, C09, C10.
- **Owner / estimate:** backend/data maintainer; 4-7 days.
- **Changes:** owner-qualified internal thread/child keys or a globally
  registered internal-ID indirection; owner-bearing store interfaces; canonical
  asset reservations/Library IDs resolved before every SAS grant. Add defensive
  source-ownership validation before memory extraction.
- **Dependencies:** none for containment/regressions; coordinate migration
  format with W08 and W10.
- **Acceptance:** two synthetic owners can use identical public thread/message
  IDs without cross-read/write/delete/admission interference; foreign raw paths
  never reach grant creation; legitimate same-owner reuse remains supported.
- **Rollout/rollback:** block ambiguous requests first; inventory/quarantine
  legacy ownership ambiguity, never infer ownership from whichever user opens
  it first. Keep old readers inaccessible to foreign namespaces during migration.
- **Research:** B03, B10, B13, B15.

### W06 - Identity, endpoint and provider-resource authorization

- **Findings/categories:** BE-07/08/09/16; C06, C09, C10.
- **Owner / estimate:** backend/identity maintainer; 4-7 days.
- **Changes:** bind invitations/admin rights to immutable identity; define API
  scope/token policy with the actual CIAM registration; approved HTTPS endpoint
  identities and origin-change key semantics; owner/content/version-scoped
  provider resources and deletion membership; explicit null/clear credentials
  and bounded KEK refresh.
- **Dependencies:** W01 configuration contract and W05 owner identifiers.
- **Acceptance:** wrong principal/scope, unapproved endpoint, unrelated file
  deletion and same-name custom-skill collisions are rejected in synthetic
  tests; valid current flows work; clearing integrations survives reload;
  simulated key rotation/failure recovers correctly.
- **Rollout/rollback:** migrate invitations by verified redemption, not email
  guessing; keep old wrapping-key versions available while referenced; preserve
  revocations if code is rolled back.
- **Research:** B05, B07-B11, B14.

### W07 - Durable run/image execution and stream contracts

- **Findings/categories:** BE-03/04/05/06/14/15; C04-C06.
- **Owner / estimate:** backend maintainer; 6-10 days.
- **Changes:** atomic idempotent admission, recoverable outbox/change-feed
  dispatch, lease/fencing and attempt ledger; cancel-request versus acknowledged
  cancellation; deletion-preserving finalization; stream connect/idle/total
  deadlines and terminal validation; reliable synchronization revisions and
  logical history order; deadline-bounded notification.
- **Dependencies:** W05 owner namespace; define ports before W10 reuses the job
  patterns. W03 supplies stage telemetry/accounting.
- **Acceptance:** concurrent/retried submission and process interruption at
  every boundary converge; no stale finalization resurrects a thread; truncated/
  failed/hung streams never become successful completion; reconnect converges.
- **Rollout/rollback:** deploy compatibility reads first, then new admissions;
  drain or fence old attempts before changing writers. Rollback must not replay
  ambiguous paid side effects without an explicit reconciliation decision.
- **Research:** B01-B06; provider background Responses is a measured alternative,
  not a shortcut around application-side tool durability.

### W08 - Account-scoped client state and transactional synchronization

- **Findings/categories:** FE-01/02/03/13; BE-14 and MEM-01 dependencies; C01, C03,
  C08, C09.
- **Owner / estimate:** frontend/data maintainer; 6-10 days.
- **Changes:** per-account cache/draft namespace; per-operation IndexedDB outbox
  with atomic entity-plus-operation writes, acknowledgement by ID and cross-tab
  drain ownership; settings hydration/revisions; synchronous submission guard
  and draft clearing only after durable acceptance.
- **Dependencies:** W05 owner key and W07 replay/idempotency contract; agree
  account-policy precedence with W09 before migration.
- **Acceptance:** A/B switching, offline enqueue during drain, overlapping tabs,
  storage failure and double send preserve ownership/work; new-device defaults
  cannot overwrite existing privacy policy.
- **Rollout/rollback:** quarantine unowned legacy local state; migrate only under
  verified identity; keep unsent drafts recoverable without dispatching them
  under a different account. Do not solve migration by indiscriminately deleting
  all local work.
- **Research:** F05-F08, B03/B04.

### W09 - Memory trust contract and safe management

- **Findings/categories:** MEM-01/02/09/10/11; FE-04/13; BE-10; C01, C07-C10.
- **Owner / estimate:** memory maintainer with frontend support; 4-7 days.
- **Changes:** separate memory use/learning/effective status; fail closed on
  unknown policy; policy epoch; explicit forget/exclusion semantics; disable
  unsafe JSON replacement and false rebuild acknowledgements until supported;
  correct cursor/inventory completeness, toggle round-trips and deletion copy.
  Disable unsupported temporary/retention promises as an immediate containment.
- **Dependencies:** W05 boundaries; coordinate W08 settings and W13 deletion
  authority. Small honest-copy/disabled-control repairs can land first.
- **Acceptance:** policy truth table, pause/read behavior, stale-device opt-out,
  status-switch editing, >100-row inventory and export round-trip; no fictional
  success or silent partial inventory.
- **Rollout/rollback:** preserve stricter consent and exclusion markers across
  every version. New accounts start in the proposed explicit baseline only
  after the product choice is approved.
- **Research:** M01, M07, M10, M11; [redesign](06-memory-redesign.md).

### W10 - Durable memory evidence, reconciliation and deletion lineage

- **Findings/categories:** MEM-02/03/04/05/08; C07, C08.
- **Owner / estimate:** memory/backend maintainer; 6-10 days.
- **Changes:** source event/operation ledger, owner-verified evidence spans,
  explicit/inferred and sensitivity states, stable subject/time semantics;
  relevant reconciliation candidates; validate-then-commit atomic replacements;
  in-batch deduplication and revision checks; replay exclusion and erasure jobs.
- **Dependencies:** W05/W07 execution patterns and W09 policy/deletion contract;
  explicit Cosmos atomic boundary must be settled before schema migration.
- **Acceptance:** duplicate jobs/operations, interrupted replacement, concurrent
  correction, failed embedding, uncertain speaker and quoted untrusted content
  produce correct visible outcomes; removed facts do not reappear on replay.
- **Rollout/rollback:** dry-run legacy classification, compatible fields and
  shadow projections; no blanket promotion of legacy data; rollback never
  restores deleted payload or old policy epochs.
- **Research:** M01-M05, M08, M12; B03/B06.

### W11 - Reliable memory serving, indexing and disclosure

- **Findings/categories:** MEM-06/07/08/09/11; C07, C08, C13.
- **Owner / estimate:** memory/frontend maintainer; 5-8 days.
- **Changes:** independent manual-edit indexing/backfill; model/content-versioned
  vectors; whole-eligible-set lexical/entity/vector candidates before final
  ranking; small approved profile, total context budget, cancellation;
  complete per-item context manifest; lossless Saved/Suggestions/Activity UI.
- **Dependencies:** W09 policy and W10 assertion/evidence versions. A basic
  explicit-only UI can precede advanced retrieval.
- **Acceptance:** manual save works with learning off; 201+/1,000-record and
  old-vector cases; temporal/subject correctness; no unexplained profile
  injection; bounded context includes every channel; degraded mode is visible.
- **Rollout/rollback:** independently flag profile, retrieval and auto-promotion;
  roll back to approved-profile mode without discarding corrections or exclusions.
- **Research:** M01-M09, M12; O09/O17.

### W12 - Model, memory and tool evaluation as a release decision

- **Findings/categories:** MEM-12; BE-06/12/15; C06-C08, C11, C13.
- **Owner / estimate:** AI/memory maintainer plus reviewer; 4-7 days initially.
- **Changes:** implement the portable case/result contract and realistic service-
  level replay; smoke/development/held-out data; no-memory/profile/current/hybrid
  arms; calibrated human/judge comparisons, slice metrics, uncertainty, actual
  retry-inclusive usage; tool-task and terminal-state evaluations.
- **Dependencies:** freeze baseline before W10/W11; candidate comparison follows
  working implementations. W03 provides usage and stage instrumentation.
- **Acceptance:** correct refusal, outage, malformed output and success are
  distinct; negative/safety failures cannot hide in aggregate quality; holdout
  is not tuned on; all claims include dataset/model/code versions and cost.
- **Rollout/rollback:** begin with deterministic and low-cost synthetic smoke
  cases; obtain a spend ceiling before paid runs; freeze failed candidate rather
  than silently changing the rubric to pass it.
- **Research:** M01/M02/M09/M12, O05/O15; centralized
  [evaluation specification](08-acceptance-and-evaluation.md).

## Product completion and optimization work packages

### W13 - One asset/provider lifecycle and retention authority

- **Findings/categories:** BE-09/10/11/13/17; FE-10; C06, C09, C10.
- **Owner / estimate:** backend/data maintainer; 5-9 days.
- **Changes:** stable object versus surface-reference model; owner-qualified
  provider registry, resumable ingestion/readiness/compensation; byte-bounded
  input/archives; actual-content verification and immutable activation;
  upload expiry, trash/purge ledger and retention; SAS validity/canonical IDs.
  Preserve supported attachment/artifact/web-image fields across client append,
  server projection and fresh-device round-trips rather than dropping them.
- **Dependencies:** W05/W06 owner/resource identity and W07 job/fence pattern;
  coordinate W04 restore and W09 memory/source erasure semantics.
- **Acceptance:** parallel/slow/failed uploads converge; studio deletion does
  not leave active broken Library entries; deleted-in-flight images do not
  revive; actual MIME/hash and signing-key expiry cases pass; newly enriched
  attachments remain a successful control while legacy references are repaired.
- **Rollout/rollback:** shadow inventory and explicit reference counts before
  deleting bytes; preserve cleanup identifiers, not immortal unclassified
  objects. Retention changes require separately reviewed impact.
- **Research:** B05, B12-B15, O12/O13.

### W14 - Reliable interaction states and honest capability controls

- **Findings/categories:** FE-03/04/05/08/09/10/12; BE-12/15; C01-C03, C06.
- **Owner / estimate:** frontend maintainer; 4-7 days.
- **Changes:** safe voice capture/mute/unmount controller, explicit transcribing/
  failure states; accurate onboarding tests and settings persistence; request-
  keyed collections and exact search destinations; retry/chunk error handling;
  truthful install/offline/export/clear-device boundaries; enforce offered tool
  capabilities rather than trusting model selection.
- **Dependencies:** W07/W08 acceptance/replay and W09 temporary policy; W13
  canonical asset/lifecycle DTOs.
- **Acceptance:** delayed permissions and route exit release capture; old
  requests cannot replace new-filter results; no false empty-on-error state;
  export contents match copy; claimed capability tests run or say Not tested.
- **Rollout/rollback:** share small state/operation helpers rather than replacing
  all stores; preserve drafts and failed audio; use flags for newly supported
  temporary/offline behavior.
- **Research:** F03, F05-F08, F10/F11; B05/B08.

### W15 - Shared accessibility contracts and device experience

- **Findings/categories:** FE-06/07/12; C01, C02.
- **Owner / estimate:** frontend maintainer plus accessibility reviewer; 4-7 days.
- **Changes:** shared modal naming/focus/inert/background/return semantics,
  navigation labels and composite keyboard models; readable light/dark tokens;
  target areas, status announcements, motion/orientation and audio alternatives.
- **Dependencies:** can begin immediately; W14 stabilizes states to announce.
- **Acceptance:** keyboard-only critical journeys; screen-reader checks with
  explicit environment; contrast computations plus rendered review; 320px/
  zoom/keyboard-open states; physical iPhone capture and layout session.
- **Rollout/rollback:** central primitives before per-screen tweaks; preserve
  browser-native pinch zoom and existing viewport behavior. Do not claim WCAG
  conformance from automated role assertions alone.
- **Research:** F01-F04, F10/F11.

### W16 - Measure and bound growth, latency and spending

- **Findings/categories:** FE-11; BE-12/13/15; OPS-06/07; MEM-06/07; C03-C06, C13.
- **Owner / estimate:** performance/backend/frontend maintainer; 3-6 days.
- **Changes:** synthetic history/image/workload profiling; bounded indexed
  search/pagination, asset URL lifetimes and preview downloads; budgeted model
  history/tool calls; measured warm-capacity and retrieval tuning.
- **Dependencies:** W03 instrumentation and W12 quality guard; optimize the
  corrected flows, not known broken semantics.
- **Acceptance:** report cold/warm and device/load slices, successes/failures,
  p50/tails and actual usage; optimization improves a defined bottleneck without
  reduced quality/accessibility/erasure correctness. Concurrency limits are not
  represented as financial caps.
- **Rollout/rollback:** one measured lever per experiment; reversible budgets/
  flags; do not raise spend or drop memory evidence silently.
- **Research:** F09, O06-O09/O13/O16/O17.

### W17 - Optional temporal graph or agentic-memory experiment

- **Findings/categories:** residual MEM-06/08/12 only after the hybrid; C07.
- **Owner / estimate:** AI maintainer; 3-5 days for a bounded spike, not adoption.
- **Changes:** add one graph/linked-note arm behind the existing retrieval port;
  use synthetic relation-heavy cases, track write/read cost, provenance and
  deletion/rollback complexity.
- **Dependencies:** W10-W12 demonstrate a real unresolved relation/temporal
  problem and a useful simple baseline; all trust gates already pass.
- **Acceptance:** pre-agreed useful improvement on that slice without safety,
  latency or operational regressions. Reject adoption if gains do not justify
  maintenance burden.
- **Rollout/rollback:** no production graph migration during the spike; remove
  the experimental arm without changing user data contracts.
- **Research:** M04-M08/M12. Vendor claims are hypotheses, not projected gains.

## Capacity, ordering and first increment

W01-W16 total approximately **66-116 engineer-days** if executed as listed.
That is about 13-23 full-time engineer-weeks before scheduling/access overhead,
not a calendar promise. Some work overlaps; schema ambiguity, production data
migration and native-device findings can expand it. Do not commit the whole
program before the first increment is measured.

For the **first 2-4 weeks of focused work**, select a bounded trust-repair
increment: reproduce and contain ownership/reference problems; correct/disable
misleading privacy and JSON controls; preserve memory opt-out across devices;
make cancellation/deletion safe at the highest-risk boundaries; move to a
supported runtime and establish release evidence. A smaller trusted-user
deployment is a temporary exposure reduction, not a completed multi-user fix.

Then reassess the scope with the owner. The memory-focused milestone is W09
plus a small explicit Saved-only experience, followed by W10-W12. It can deliver
value before every visual/performance enhancement is finished.

Parallel lanes after shared contracts:

| Lane | Sequence | Cross-lane checkpoints |
| --- | --- | --- |
| Platform | W01 -> W02; W03; W04 | Runtime/config ready; run IDs and deletion policy stable |
| Core/backend | W05 -> W06/W07 -> W13 | Owner IDs, idempotency and canonical asset DTOs |
| Client | W08 -> W14; W15 | Account policy hydration and server acceptance/replay |
| Memory | W09 -> W10 -> W11 -> W12 | Ownership, durable source events, exclusion ledger |
| Optimization | W16, then optional W17 | Stable correctness and usefulness baselines |

W12's baseline/dataset work starts early even though its candidate promotion
decision comes later. W03/W07 enforce tool budgets jointly; the cost meter
must not be implemented separately from the executor's admission rules.

## Shared definition of done

A work package is not done because code was merged or a test count increased.
It must retain the release evidence packet described in
[acceptance and evaluation](08-acceptance-and-evaluation.md#4-release-evidence-packet):
findings, contracts, tests, integration evidence, user-visible changes, migration,
operations, rollback and the decision owner.

The final roadmap should be executed incrementally. No recommendation here
authorizes a paid model experiment, collection of real user conversations,
production penetration test, destructive migration, or automatic cloud deployment.
