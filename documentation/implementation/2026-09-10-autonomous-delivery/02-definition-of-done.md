# Machine-enforced Definition of Done

**Targets, not achieved results.** Policies fail closed. A skipped, missing,
cancelled, inconclusive, unsupported, stale or incorrectly bound required result
is not a pass. No numerical score, two-agent agreement, test-count increase,
deadline or throughput target can override a hard gate.

## 1. Four distinct completion levels

| Level | Necessary evidence |
| --- | --- |
| Candidate-valid | Exact artifact passes immutable applicable gates on independent infrastructure; no public traffic |
| Released slice | Candidate-valid, correct release/config/data bindings, staged route and rollback evidence, observation gate passes |
| Finding closed | **Every** closure slice named for that finding is released, acceptance evidence covers all conditions, no active containment-only label |
| Program done | All 52 findings closed; full gates pass together on one compatible release; 28-day operational window and memory evaluation complete; unsupported claims remain explicitly excluded |

A read-only containment/disabled feature may make a release safe but does not
prove the original capability works. S01 removes the unsupported temporary-chat
promise as containment; FE-04 closes only after S49 delivers a real server-run
temporary contract across every entry point and retention boundary.
Raw JSON can remain removed if equivalent safe explicit management is delivered.
No requirement is marked implemented merely because an automated surrogate exists.

## 2. Fixed authority and evidence binding

The trusted evaluator pack is separate from candidate code and pinned **before**
the attempt. Trusted launcher/toolchain, test inventory, assertion identities,
fixtures, models, prompts, rubrics, gate applicability and thresholds are signed
by independent identities. Builders may add tests but cannot change the required
pack, runner, `package.json` scripts used by the verifier, coverage exclusions,
fixtures, golden outputs, workflow definitions or status-check producer.

Candidate tests execute as untrusted subprocesses. The trusted supervisor checks
external service state, captures exit status and report bytes itself, verifies
expected test IDs/counts, and signs only after process/container termination and
artifact digest verification. A process writing `junit.xml` or exit 0 is not
sufficient. Protected-path diffs go to policy/evaluator evolution, never a normal
product PR. No privileged `pull_request_target` checkout/execution of candidate.

Generated evaluators must accept known-good reference outcomes as well as reject
known-bad mutants. Otherwise a gate that rejects every correct implementation
could appear "safe." Test-author and evaluator have distinct principals and
workspaces even when they share a model provider; shared provider does not imply
independent error probabilities.

Each evidence packet binds:

| Subject | Binding |
| --- | --- |
| Source | repository ID, exact Git commit SHA, clean tree digest, merge/base SHA and diff digest |
| Build | frontend and API SHA-256, dependency lockfile hashes, SBOM, compiler/toolchain image digest, build config digest, trusted build workflow commit |
| Environment | immutable IaC revision/parameters digest, deployed runtime version, config/feature flag revision, secret **version IDs only**, region, data schema and migration head |
| Evaluation | evaluator commit/digest, test inventory hash/count, dataset/generator/seed manifest, bank ID/digest/purpose/precommit ID, exposure reservation/ordinal/ledger sequence, prompt/rubric hashes, model/deployment/resolved version, negative-control IDs |
| Outcome | check IDs and counts, failures/timeouts/skips, raw artifact hashes, timing/cost denominators, signed producer identity and run ID |
| Release | prior LKG manifest, compatibility matrix, release epoch/permit nonce/expiry, stage endpoint/queue generation, routing receipt and observation window |

Evidence DAG edges `builtFrom`, `testedArtifact`, `evaluatedWith`,
`deployedWith`, `supersedes` and `derivedFrom` must point to existing immutable
subjects. No cycle, missing artifact or unknown model version represented as a
known pin. Unknown provider version is reported and restricts reproducibility;
quality revalidation on observed version drift is mandatory. Store raw evaluation
results as portable JSONL plus aggregate JSON. A signature establishes origin,
not semantic correctness.

The release verifier verifies signatures against pinned workload identities,
issuer/audience/repository/workflow/source claims, digests and freshness; check
names alone are spoofable. Build/test attestations never come from builder
principals. A permit expires in 15 minutes, is single-use, and binds the current
LKG/release epoch and all subjects. Any source/config/policy change requires
new matching evidence, not a recycled green check.

## 3. Hard release gates

| Gate | Non-negotiable contract |
| --- | --- |
| G00 Authority/preflight | Every required machine capability, credential refresh, quota and environment conformance probe passes; no pending human interaction |
| G01 Integrity | All above bindings/signatures match; protected paths unchanged; required negative controls detected; no undeclared dependency or tool |
| G02 Deterministic regression | 100% required tests/assertions pass, zero required skip/xfail/quarantine; full release browser inventory executes; no runtime/type/build errors |
| G03 Isolation | Zero cross-owner reads/writes/grants/local disclosure in colliding-ID, switch-account and canonical-reference suite; positive same-owner controls pass |
| G04 Memory/privacy lifecycle | Zero unauthorized reads/writes, stale corrections, forgotten-item resurrection or false deletion/rebuild acknowledgements; current consent/exclusion wins |
| G05 Durable work | One logical accepted operation, no stale terminal regression, no ambiguous provider replay, bounded recovery; cancel/delete fences hold |
| G06 Memory utility | Shipped-pipeline paired metrics and uncertainty meet section 5 for a memory-algorithm/prompt/model change; deterministic controls alone do not qualify |
| G07 Honest/accessible interaction | Critical automated task matrix, names/focus/contrast/reflow/status and truthful capability claims pass; unsupported device/assistive claims not advertised |
| G08 Cost/privacy | Reservations/time/token/tool caps enforced concurrently; zero canary secrets/content in default logs; complete retry-inclusive usage |
| G09 Release/recovery | Exact immutable artifacts, LKG compatibility, isolated staging, fenced queues, reversible migration, independent rollback exercise all pass |
| G10 Operational observation | Stage-specific probe windows/counts pass; no critical invariant incident; no stale/missing monitoring treated as success |
| G11 Full program | All closure dependencies released, all finding evidence present, no containment-only closures, final compatible full-suite run and 28-day window |
| G12 Policy evolution | Independent old-root verification and mandatory negative controls; no self-approval, retroactive pass or floor weakening |

`G00/G01/G02/G08/G09` apply to every releasable candidate. Other gates are selected
by the immutable path/contract impact map, then unioned with slice gates. A builder
cannot claim "docs only" for a workflow/test/policy edit. Trust-critical gates G03-G05 are an unconditional additional
`productMandatoryGates` union for every product release, including R0, regardless
of changed paths. Disabled paths still have fixed rejection/no-side-effect tests;
they are not waived. The immutable policy enforces this union, not the builder's
slice labels. Model-inference-free UI/correctness changes do not incur full paid G06;
they still run fixed memory smoke controls and preserve model/prompt bytes.

Run existing `npm test`, `npm run build`, API `npm test`, `npm run typecheck`,
`npm run build`, and the checked-in Playwright inventory under pinned versions
in future trusted CI. The baseline's API build currently targets Node 20; H05
must fix supported-runtime coherence before any supported-runtime claim.
No `npx --yes` live eval scripts are authorized by this plan; a separately pinned
offline/paid runner is E01/S24 work. Targeted checks accelerate builder feedback;
release gates cannot substitute the audit's selected serial browser rerun for the
whole matrix. Full browser stability requires three consecutive **complete**
clean executions with no retry-hidden failures at H04.

## 4. Adversarial denominators and operational contracts

For deterministic invariants, execute all frozen cases (minimum 40 smoke cases,
plus each slice's boundary cases), 100 fault schedules per changed transactional
boundary and 1,000 seeded randomized schedules per owner/consent/worker subsystem
before its first release. Seeds and attempted schedules are recorded. A bounded
model/property test covers all states/events up to eight operations with two
owners and two workers. This is bounded exploration, not a formal proof over
unbounded concurrency. Every named critical mutant must fail.

Normal accepted-run reconciliation target: queued work is visible immediately
after durable acknowledgement; start or explicit degraded state within 120 seconds
in the controlled staging workload; terminal/reconcilable error within configured
run deadline +120 seconds. Never change `complete` to satisfy a timeout.
Product defaults proposed for calibration: 15-second connection, 30-second idle,
180-second total response budget; image/long-tool capabilities declare separate
budgets before admission. Cancellation prevents **new** effects immediately after
the current fence is observed; an already transmitted provider request cannot be
unsent and must retain its uncertain billing/retention status.

Forgetting: serving exclusion is atomic with delete acknowledgement. Online
projections/payload purge target <=24 hours; provider/backup deletion uses explicit
provider-supported deadlines and separate pending/unsupported receipts. Restore
must reapply the latest revocation/exclusion ledger before serving, even if a
backup predates deletion. A provider with no deletion API cannot be labeled erased.
If a capability promises deletion the infrastructure cannot support, disable that
capability for new data and block its full finding closure.

## 5. Memory quality: earn learning, not just retrieval scores

E01 freezes the audited code as arm C and the ordinary history/model/tool budget
before mutation. Arms A=no cross-session memory; B=approved Saved-only;
C=audited behavior isolated with synthetic data; D=hybrid. Unsafe baseline C
never handles live data. D never replaces A/B controls. No graph arm is required.

Keep 80 development episodes separate from 240 initial held-out episodes,
30 in each audit slice: explicit preference; implicit supported fact; temporal
update; relation/subject; negative/irrelevant; correction/deletion; injection/
sensitive; long-history/degraded. Split by complete synthetic persona/timeline
and scenario template, not utterance. Three runs per arm/episode (2,880 answers);
all three enter the attempt denominators, never best-of-three selection.
Repeated seeds are not independent users. Expand the fixed negative/sensitive
holdout to **at least 600 independent timelines**, with one predeclared primary
trial per timeline for the rare-error estimate; other repeats are robustness data.

Freeze generator code and sealed seed set under evaluator authority. Labels derive
from a deterministic event ledger with exact source spans, permitted/forbidden
claims, validity intervals, subjects and consent epochs. Generative paraphrasing
can increase phrasing diversity only if the semantic constraints are retained
and validated; otherwise exclude the generated case **before** candidate results
are observed and record it in dataset construction evidence. No tuning on holdout.
Return bounded aggregate failure categories, not hidden answers, to builders.
Aggregate scores can still leak labels under adaptive querying (AR05). Separate
development, validation and **never-seen final** banks. Validation banks permit
at most three exposures in total across all candidates and workers, then become
retired/declassified development material. Final promotion uses a separately
precommitted bank with exactly one lifetime exposure, after source/method freeze;
no final-bank feedback is available for candidate selection.

An evaluator-owned monotonic ledger, keyed by bank content digest (not a renameable
display ID), atomically burns an exposure reservation **before** private data is
opened or any score can be emitted. Concurrent runs, failures, aborts and retries
consume reservations; there is no refund after an unused-looking failed dispatch.
The ledger assigns bank ID/digest/purpose/precommit ID, exposure ordinal, reservation
ID, run/source binding and global sequence. G01/G06 compare receipts to that
independent ledger; candidate JSON cannot reset a counter. A fourth validation
exposure, reused final bank, cloned bank digest, forged counter or changed precommit
blocks evaluation/promotion. Only preauthorized, already precommitted fresh banks
may be selected; the builder cannot generate unlimited new banks to chase luck.

| Metric | Proposed strict promotion threshold and denominator |
| --- | --- |
| Safety/policy/mutation | 0 violations across every attempted transition, replay and restore; no averaging with utility |
| Answer success | >=90% overall and >=80% in each of the eight slices; timeout/error is failure; strict rubric required/forbidden claims |
| Difficult-memory gain | D improves paired temporal + relation answer success by >=5 percentage points vs C and B; clustered 95% lower confidence bound of gain >0 |
| Regression vs controls | For each non-target slice, paired lower 95% bound of D minus B and C >=-2 percentage points; A comparisons reported, not hidden |
| Unsupported personalization | One-sided 95% exact upper bound <1% across >=600 independent negative/sensitive timelines, AND zero hard-policy violations |
| Evidence precision/recall | >=95% supported selected items / selected items; >=90% required evidence items recovered / required items; report empty-required separately |
| Temporal/abstention | >=90% each on predeclared answerability/time slices; subject confusion counts as incorrect |
| Correction/forget | 100% next-eligible-turn correction and exclusion across all attempted changes, including failed/degraded runs |
| Context budget | 0 overflows of the **combined** 800-token memory budget (profile + retrieval + formatting); 500ms lookup deadline, explicit degraded result |
| Added memory latency | Paired p95 context-assembly increment <=500ms vs A; p95 end-to-end increment <=1s vs B, measured separately from provider variance |
| Cost/useful answer | Total attributable model/tool/retry/judge/embedding cost / successful answers <=1.25x B; whole-run reservation holds |

Numbers are proposed operating policy, not empirical findings or universal
standards. If uncertainty is too wide, the outcome is `INCONCLUSIVE`, not pass.
Use paired bootstrap by persona/timeline (10,000 resamples, frozen seed) for
utility/latency/cost; multiplicity uses Holm adjustment across per-slice
non-regression tests. Report numerator, denominator, interval method, clustered
unit and confidence level. Zero events in 600 independent timelines gives
`1 - 0.05^(1/600)`, about 0.50%, as a one-sided 95% upper bound; 30 cases cannot
substantiate the rare-error claim. Synthetic distribution bounds do not estimate
the real world's prevalence.

Quality ceiling handling is explicit: if B is already near-perfect, D must still
earn its extra complexity; no statistically useful gain => keep B, mark advanced
promotion blocked/not justified. S24 can close MEM-12 by implementing truthful
evaluation, but S47/full hybrid-goal remains unachieved, not renamed success.
Never lower the 5-point target after observing D. A separately preauthorized
policy evolution can change future scope but cannot retroactively pass D.

### Judge calibration without a hidden human dependency

Use deterministic state/claim graders first. For phrasing that requires semantic
judgment, two independent model families grade blinded arm IDs/order using a
frozen rubric and a separate 200-case calibration set containing exactly correct,
subtly incorrect, abstaining, injected and malformed answers derived from known
synthetic truth. Require >=95% accuracy, >=95% sensitivity to incorrect answers,
and zero missed hard-safety examples for each judge; report class confusion
matrices. No judge grades its own generated answers or defines the gold labels.
Disagreement on a required semantic result is failure/inconclusive, not a third
same-family majority vote. Judge drift fails calibration and blocks paid promotion.

This substitutes **machine-checkable task truth**, not measured human preference.
The audit's blinded human preference study and user recruitment are not in the
unattended control path and are not claimed completed. Rubric quality limits and
judge correlation remain recorded residual uncertainties.

## 6. Automated UX/device evidence with honest limits

Critical task set: identify effective memory mode; save/correct/forget and inspect
next reply context; preserve draft on failure; account switch offline; cancel run;
open/download/delete Library item; configure tested capability; keyboard-only
navigation/rename/delete/model selection. 100% of scripted tasks must succeed
without hidden setup bypasses. Screenshots alone are insufficient.

Matrix: Chromium/Firefox/WebKit at 320x568, 390x844, 768x1024, 1440x900;
both themes; keyboard-only focus order/return; 200% text and 400% browser zoom
where supported; portrait/landscape; reduced motion; online/offline/slow network;
delayed/denied audio permission with synthetic tracks. Record actual browser/OS,
automation interface, device/emulation classification and unsupported matrix cells.
Contrast >=4.5:1 ordinary informative text, >=3:1 large text and applicable
non-text indicators; never treat decorative/disabled exceptions as all text.
Target size >=24 CSS px or explicit standard exception, with a 44px coarse-pointer
design target. Zero critical automated accessibility violations in critical flows.

Desktop accessibility-tree/announcement assertions and machine-driven physical
device/assistive APIs run only if a preauthorized unattended runner exists and
can make reproducible assertions without login/consent prompts. Otherwise record
`UNSUPPORTED` for physical iPhone microphone/keyboard behavior, NVDA speech output
or VoiceOver semantic judgments; preserve audio alternative, keyboard/DOM checks,
and remove conformance claims. Emulated WebKit is not an iPhone. Full WCAG
conformance and subjective usability are not claimed by this autonomous DoD.
A mandatory claim with no adequate automated oracle is recorded as
`UNVERIFIABLE_REQUIRED` and blocks that claim's promotion. It cannot be
silently dropped by calling a simulated persona a human reviewer. Independently
safe unrelated slices may continue. A finding's code defect can close with
adequate bounded evidence while an
explicitly unprovable broader certification remains excluded, not passed.

## 7. Progress SLOs versus final reliability gates

After the first LKG, target at least one visible released slice per three **active
engineering days** (24 worker-active hours) over a rolling 14-day window; median
ready-to-candidate time <=8 active hours; WIP <=2 product candidates, one builder,
one promotion. Count shipped visible slices / active days; publish blocked time,
failed attempts, cost per shipped slice and all reverts. These are **progress
SLOs**, never release gates or incentives to split meaningless changes.

Final operational goal: over 28 consecutive days, successful authenticated
synthetic critical journeys / all scheduled journeys >=99.5%, excluding only
predeclared disabled capabilities, not provider errors or missing probes.
Minimum one probe/minute/region from two independent probe locations
(80,640 attempted observations over 28 days); correlated observations are not
independent reliability trials. Report time-bucket error rates and provider/
application/monitoring classifications, not a misleading binomial uptime CI.
Production traffic success denominators include failed/timeout attempts; sparse
traffic is reported as insufficient, not padded with synthetic users.

No critical isolation/consent/deletion incident; restore RPO <=24 hours for
ordinary application content and **no acknowledged revocation loss** (separate
durable ledger required), RTO <=60 minutes in two isolated rehearsal runs.
Rollback routing recovery target <=5 minutes in stage exercises; this is not a
cloud SLA. If the gate fails, retain the previous LKG, repair within budgets, and
restart the applicable observation window without erasing the failure record.
