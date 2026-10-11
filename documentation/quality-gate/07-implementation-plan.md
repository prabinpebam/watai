# Implementation and Qualification Plan

Status: LOCAL PREPARATION IN PROGRESS; NO QUALIFYING LOOP STARTED. Version: 0.4. Date: 2026-09-12.
The active task is complete preparation and harness implementation. No step below resumes unrelated DoD delivery,
creates test accounts, starts live model calls or changes production automatically.

## The Operating Loop

Milestones organize delivery; this loop governs each actual finding. Repeat the loop
until required expectations are qualified or an explicit blocker remains. Do not stop
at successful automation, a repaired detector, a passing local test or a final screenshot.

| Step | Required artifact or decision | Exit rule |
| --- | --- | --- |
| 1. Define | Complete task/variant, qualitative expectation, exact capture design, deterministic heuristic algorithms and semantic-review procedure | No execution, capture or evaluation detail remains unresolved; anomaly categories remain open. |
| 2. Lock and preflight | Reviewed flow/capture/heuristic/skill/profile identities, calibrated recorder and semantic agent, exact target/state, authority and budgets | Missing design, unsafe state, stale binding or unvalidated semantic runtime blocks the loop before browser launch. |
| 3. Execute and record | Normal user actions plus uninterrupted declared observations through waits, errors and reconciliation | Preserve the attempt even on timeout/crash; no repair, reload or fixture substitution inside the attempt. |
| 4. Evaluate | Deterministic heuristics plus mandatory independent open-ended LLM review of the timeline and assets, with whole-experience synthesis | Both paths required; observed failures survive missing evidence elsewhere; unknown cannot turn into a pass. |
| 5. Diagnose | Finding linked to failing step/events, expected versus actual, likely cause and cheapest discriminating check | Distinguish product, driver, capture, oracle, environment and test-state defects; an unproven cause stays a hypothesis. |
| 6. Repair | Smallest change in the owning layer with a failing regression where feasible | Fix the demonstrated cause; no weaker oracle, hidden delay, baseline overwrite or discarded failure. |
| 7. Rerun and contrast | New attempt of the original real flow plus impacted/contrast cases | Original gap is closed without removing valid behavior or introducing a nearby regression. |
| 8. Admit or continue | Closure record and required full candidate/production gate evidence | Only independently admitted complete evidence permits promotion; otherwise take the next bounded diagnostic action. |

No live execution is granted by this table. Each expensive run still follows the
existing authorization and Cost Challenger procedure. Reuse one issue/run ledger and
existing evidence infrastructure; do not build a second workflow service for this loop.

## Failure Ownership and Closure

Each finding has an ID, claim/phase, severity, expected and observed result, evidence
references, candidate/config/capture versions, owner, reproduction conditions and status.
Record the earliest supported divergence and competing explanations before editing.
One screenshot or upstream success flag rarely establishes the root cause.

- Product defect: fix the real owning code path, retain a lower-layer regression and
   rerun the real task flow. Mocks may speed diagnosis but cannot close deployed evidence.
- Capture/driver defect: repair and calibrate the observer or action plan, then run a
   new attempt. Do not erase product failures already established by reliable channels.
- Oracle defect: resolve the expectation with the authorized expectation owner, version
   the rubric and re-evaluate compatible raw evidence. The builder cannot lower the bar
   merely because its product failed; independent regression cases must still discriminate.
- Environment/test-state defect: preserve identities and partial effects, restore only
   authorized test-owned preconditions, and start a new attempt. A real outage affecting
   the user's flow remains a user-impact failure even if application source did not cause it.
- Ambiguous outcome: stop automatic replay of the side effect. Reconcile actual state
   through permitted reads; missing receipts are not proof that nothing happened.

A finding is closed only with the repair identity, matched real-flow evidence, relevant
counterexamples and independent acceptance. A code change or successful re-recording
alone is not closure. The overall gate may remain blocked after a particular bug is fixed.

## Evidence Invalidation and Rerun Scope

| Change | Reusable evidence | Required new work |
| --- | --- | --- |
| Detector implementation only; expectation/capture unchanged | Original intact raw package | Re-evaluate it and the independent detector calibration bank; retain both verdict versions. |
| Missing capture field, wrong phase/resolution, changed observation policy | Earlier evidence only for claims it actually supports | New reviewed per-flow plan and new real attempt; never invent omitted history. |
| Product code, provider model/prompt, runtime, auth, data schema or config affecting the flow | Unaffected historical diagnosis, with no transfer of candidate-pass identity | New exact-candidate affected-flow evidence and all required release gates. |
| Test data, consent, history, caches or session state | Only cases whose declared preconditions still match | Reestablish legitimate preconditions and execute the relevant state profile. |
| Expected visual reference or semantic rubric | Compatible captured content for explicitly permitted reevaluation | Authorized expectation change, independent controls and new eligibility review; no self-approval. |

Focused reruns provide feedback, not a substitute for the full frozen release denominator
and DoD repetitions. Do not repeat a full matrix to diagnose basic startup. Conversely,
do not claim a fresh full pass by combining incompatible candidate runs or excluding
known intermittent failures. Persistent-state variants are not independent clean-room
repetitions; label both and preserve their state lineage.

## First Useful Proof and Stop on Meta-Work

The next deliverables are complete per-flow preparation and tested semantic orchestration.
Every required detail is resolved before that flow's loop starts. Missing selectors or
capabilities are explicit blockers, not decisions delegated to the execution agent.
Separately authorized discovery/calibration is preparation work and never qualifies the
real product. No live discovery or calibration is authorized in the current local stage.

Q2 cannot precede the applicable Q3 recorder and reviewer calibration. Historical partial
diagnostics remain historical; calling a new attempt "diagnostic" does not bypass the
latest prerequisite instruction. Do not ask an untested recorder or reviewer to certify
its own completeness.

Measure time to a trustworthy reproduced user failure, time to verified closure,
missed-critical-mutant rate, unresolved coverage gaps, flaky attempts, evidence bytes and
provider spend per qualified flow. Raw test count and volume of documentation are not
delivery metrics. No critical invariant may be traded away for a cheaper or faster score.

## Sequence and Exit Criteria

| Milestone | Work | Evidence required to exit | Explicit stop condition |
| --- | --- | --- | --- |
| Q0: Contract | Review this specification, catalog, missing expectations and capture limits | Linked requirement/flow/detector/capability map; unresolved decisions named | No claim of complete live inventory or implemented gate |
| Q1: Safe access | Confirm real deployment identities and legitimate test-user bootstrap | Protected A/B identities, allowed domains/config, test-data ownership, reviewed budgets | Missing authority/secret/verification requires explicit bootstrap, not bypass |
| Q2: Prepared incident flow | Only after complete task/capture/heuristic/semantic preparation and applicable Q3 validation, run the exact real incident flow | Locked complete pack, reconstructable timeline, assets, both eval results and gap report | Any missing prerequisite blocks launch, not merely release |
| Q3: Recorder and reviewer qualification | Before Q2, validate temporal/paint coverage, privacy, overload, heuristic negatives and held-out open-ended LLM review | Independently accepted calibration evidence and measured resource/capacity profile | Missed critical mutant, inadequate semantic review, capture loss or observer interference blocks admission |
| Q4: Full flow preparation | Reconcile all actions with the 60-ID seed; explicitly design every task/variant, capture, heuristic and semantic binding | Frozen inventory with complete reviewed preparation per flow | Missing designs or unvalidated runtime remain NOT_READY; no generic template can cover them |
| Q5: Candidate gate | Run required real-service suite on immutable private candidate | Independent sufficient evidence across frozen support matrix and DoD gates | Any critical/unresolved material finding, skipped case or identity mismatch blocks promotion |
| Q6: Production gate | Authorized promotion, real authenticated public verification and recovery exercise | Exact serving identities, visible/semantic task results, retained recovery package | Critical live failure triggers guarded code-only recovery |
| Q7: Operational use | Reuse evidence and gate every release; monitor drift | Reproducible reports, bounded run costs, no direct-publish bypass | Incident freezes normal promotion and directs work to repair |

Milestone numbers identify work packages, not permission to violate dependencies. Q0
creates the map; Q3 validates the required recorder/reviewer; each Q2/Q4 flow first meets
the complete prerequisite gate. A seed catalog is not completed preparation or coverage.

## First Vertical Implementation

Implement the smallest fully prepared path for the reported incident. An unknown action
has no default runtime canary: resolve it during separately authorized preparation and
freeze the exact task, variants, capture and both eval paths before execution.

Before implementing or running this qualifying case, author its capture design: regions,
fields and resolution per phase; mutation/frame/paint channels; declared resolution
transitions; abstractions and dependencies; privacy, budgets and insufficiency rules.
Resolve and review its selectors against the actual app. Discovery to resolve unknowns
is separately labelled; it cannot improvise the capture plan for a qualifying run.

First recorder iteration needs document identity, action log, message-node identities,
ordered mutation records, rAF order/geometry/visibility/scroll samples, safe network
correlation, screenshots, capture-health output and append-only attempt storage. Use
normal browser APIs and current semantic selectors. No generic framework or debug-state
API is prerequisite to proving this first flow.

The first output must show either the real failure or precisely why observation is
insufficient. A blank timeline plus exit zero is a failure of the harness. Save the
original incident evidence before product edits, then fix one evidence-backed cause and
rerun the same real scenario under a separate execution decision.

## Incremental Work Packages

1. Implement versioned evidence types/validators and lossless replay offline. Verify
   unknown/empty distinctions, node lifetime/sequence reconstruction and privacy rules.
2. Author/review and lock one case's capture design before implementing its hidden
   real-deployment driver and passive observation. No mocks, fake credentials, local
   component routes, fabricated response content or runtime-invented capture policy.
3. Implement complete known deterministic heuristic checks and evidence-linked reports.
   These may diagnose obvious defects locally, but never replace mandatory semantic review.
4. Implement paint/operability/DS checks and the skill-configured open-ended LLM harness,
   including original timeline/asset navigation, coverage and cross-phase synthesis.
5. Calibrate recorder, heuristics and semantic reviewer before admitting the applicable flow.
6. Expand shared observers and drivers only as the next catalogued flow requires them.
7. Integrate evidence admission into the existing release authority boundary; add no
   parallel self-approval mechanism or unauthenticated `passed: true` shortcut.

Each package has a small edit, focused discriminating validation, explicit outcome and
stop condition. Record failures and changed approaches rather than repeatedly increasing
timeouts. Existing lower-layer tests protect repairs but never replace Q5/Q6 evidence.

## Validation Matrix for the Recorder

| Property | Cheap initial check | Required real-product follow-up |
| --- | --- | --- |
| Sequence fidelity | Insert/remove/reorder/reinsert and remount calibration | Real submit, server handoff, reconnect and reload |
| Paint/interaction | Ancestor clip/opacity/occlusion/font/image mutants | Production assets and actual overlays/media actions |
| Capture completeness | Sequence drop, overflow, disconnect, disk failure, crash | Real document/frame navigation and lifecycle |
| Semantic sufficiency | Review a package without running the app; expose missing content | Inspect real answer/document/image/download against rubric |
| Privacy | Canary secrets excluded from structured and media artifacts | Real authentication screens and protected account sessions |
| Perturbation | Bounded callback and payload measurements at multiple DOM sizes | Paired real-product recorder-on/off measurement with uncertainty |
| Portability | Cross-engine API capability matrix and explicit unsupported states | Required browsers and separately scoped genuine devices |

Failure injection belongs in calibration or lower-layer tests. The real-product suite
must not substitute injected outcomes for the actual task under evaluation.

## Work Budgets

Every expensive phase needs Cost Challenger review and a machine-readable work decision
through the verified hidden runner. Specify stage wall time, provider/model requests,
tokens/credits, currency, test-data mutations, cleanup and recovery reserve before running.
This document specifies no standing live-call or cloud-mutation allowance.

Use existing evidence when source/runtime/config/contract have not changed. Re-evaluate
retained raw evidence for new detectors where sufficient. Run one readiness canary before
an expensive browser matrix. Benchmark capture overhead once per materially changed
recorder/environment profile, not as a repeated ritual on every unchanged case.

At five minutes without first useful capture evidence, reassess the startup/capture
approach; do not start more test infrastructure. At two failed attempts at a stage or
30 minutes of sustained work, challenge the approach and select a concrete changed action
or verified blocker. Process/setup must remain subordinate to exposing real product risk.

## Open Decisions

| Decision | Required before | Current state |
| --- | --- | --- |
| Exact failing production action and deployment identity | Q2 interpretation | Unknown; discover without guessing a cause |
| CIAM verification/MFA bootstrap and account administrator | Q1 | Not provisioned/authorized by this document |
| Provider funding and per-flow cost ceilings | Any real generated output | Not set |
| Private real environment/auth redirect/config equivalence | Q5 | Needs verification |
| Supported browser/device/theme/zoom case matrix | Frozen denominator | Proposed families only |
| Authoritative DS references and baseline approver | Visual clean verdict | Sources identified; baseline not approved |
| Capture timing/volume/overhead support limits | Q3/Q5 | Proposed targets, not measurements |
| Semantic rubric bank, reviewer authority and uncertainty policy | Semantic release verdict | Contract specified; implementation absent |
| Protected evidence storage, access and retention | Q1/Q2 | Needs explicit local/remote policy |
| External promotion enforcement and emergency recovery authority | Q6 | Existing DoD trust model applies; enforcement not proven |

## Planning-Task Completion

This documentation task is complete when all indexed documents are linked, requirement
IDs and verdicts agree, source discussions are preserved, and claims remain correctly
labelled as design. It is NOT completion of Q1-Q7, a production repair, a complete flow
inventory, a runtime implementation, independent qualification or permission to deploy.

Next deliverable: one reviewed per-flow capture design, then an authorized real incident
evidence package and reconciled coverage-gap report, followed by the smallest demonstrated
repair. No additional general planning layer is a prerequisite.