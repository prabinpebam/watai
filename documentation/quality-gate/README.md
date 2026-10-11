# Real-Deployed Experience Quality Gate

Status: PARTIAL LOCAL IMPLEMENTATION; NO FLOW READY OR QUALIFIED.
Version: 0.5. Recorded: 2026-09-12.

Active scope: the [five-flow trial](flows/five-flow-pilot.md), not preparation of the full
60-flow catalog. AUTH-01 and CHAT-01/02/03/04 are selected; the other55 flows are deferred.
The selected prerequisites remain mandatory. No live five-flow trial has started.

The goal is to judge the real deployed app against user expectations at every relevant
step, using trustworthy DOM, paint, semantic, persistence and service evidence. A
successful callback, HTTP response or Playwright script is not a successful user outcome.

This set captures the production-quality discussion, the three reviewed EDD guides,
the strict no-focus requirement and the requested DOM-capture plan. The reported deployed
failure is not diagnosed here. No live browser suite, test account, provider call,
implementation restart or deployment is performed by creating these documents.

Implementation checkpoint: the first [deployed diagnostic runner](../../tests/e2e/deployed/README.md)
exists with partial [AUTH-01/CHAT-01 diagnostic designs](flows/AUTH-01-CHAT-01.md).
The [public baseline](baselines/2026-09-12-public-baseline.md) has been captured and the
initial recorder timing defect repaired. Authenticated execution and full release
qualification remain blocked; this does not make the complete specification implemented.
The latest mandatory preparation gate now blocks even public execution until complete
flow/capture/heuristic designs and a validated skill-configured semantic harness are bound
together. Historical diagnostics do not satisfy this gate and are not retroactively qualified.

The first explicit [AUTH public-child preparation pack](../../tests/e2e/deployed/preparation/AUTH-01.json)
is now source-bound, with implemented original-evidence heuristic checks and named remaining
gaps. It is `BOUND_DRAFT_NOT_READY`, not an admitted flow. All 60 parent flows remain
`NOT_READY`; none has completed independent capture, heuristic and semantic qualification.
The [CHAT child pack](../../tests/e2e/deployed/preparation/CHAT-01.json) is also authored
and bound. Local recorder calibration has passed; durable review recording, isolated
window sessions and pre-dispatch budget checks are implemented offline. The
[synthetic semantic calibration material](../../tests/e2e/deployed/preparation/semantic-calibration.json)
is prepared but unreviewed and unexecuted by a model. The three additional pilot packs
are now authored with distinct local heuristic checks. Selected driver/capture/semantic
readiness and independent authority remain incomplete; unselected packs are deferred.

## Reading Map

| Document | Purpose |
| --- | --- |
| [01-intent-and-decisions.md](01-intent-and-decisions.md) | User requirements, reviewed EDD sources, adaptations, decisions and unresolved delivery gaps. |
| [02-dom-capture-architecture.md](02-dom-capture-architecture.md) | What to observe, capture triggers, efficient scheduling, paint/operability, proposed budgets and recorder calibration. |
| [03-evidence-contract.md](03-evidence-contract.md) | Snapshot/event identity, unknown states, lossless reconstruction, timing uncertainty, artifacts, privacy and evidence health. |
| [04-task-flow-coverage.md](04-task-flow-coverage.md) | 60 unverified seed flows, required variants, coverage states and a detailed chat flow card. |
| [05-evaluation-and-design-system.md](05-evaluation-and-design-system.md) | Traceable detectors, temporal/semantic rubrics, real DS paint checks and clean-verdict rules. |
| [06-real-environments-and-release-gate.md](06-real-environments-and-release-gate.md) | Legitimate accounts, real services, hidden browser execution, data/spend boundaries and promotion/recovery enforcement. |
| [07-implementation-plan.md](07-implementation-plan.md) | Staged implementation, first incident capture, qualification milestones, cost controls and open decisions. |
| [08-approach-review.md](08-approach-review.md) | Prioritized critique, adopted improvements, remaining proof obligations and the operational repair loop. |

Start with the capture architecture and evidence contract for the DOM plan. Read the
intent and decisions before implementing any exception or adapting a source example.

## Non-Negotiable Requirements

- Real deployed frontend, authentication, backend, storage, realtime and providers.
  Mocks/fixtures remain lower-layer tests, never the deployed-product proof.
- Every observed intermediate chat state must preserve prompt-before-own-response,
  visibility and meaningful sequence. Final-state correction does not excuse a defect.
- Capture must preserve what happened, including unexpected changes, before judgment.
  Required blind spots, dropped evidence or uncalibrated observer impact prevent a pass.
- Heuristics are complete predefined deterministic evals. Semantic review is mandatory
  open-ended LLM review of the timeline and accompanying evidence for unanticipated issues.
- Every flow requires fully authored, validated preparation before evaluation starts;
  a generic template or the existence of a semantic skill cannot make a flow ready.
- Correct pixels, operable controls, actual production assets and meaningful outputs,
  not token names, DOM existence, server completion or screenshot appearance alone.
- Hidden processes and headless browsers only; no user-window, terminal or OS-input
  takeover. Genuine-device checks remain explicit when headless execution cannot prove them.
- Full required candidate evidence before promotion, authenticated public verification
  afterward, and guarded code-only rollback without restoring privacy/deletion ledgers.

## Traceability Index

| Requirement family | Authoritative location | Meaning |
| --- | --- | --- |
| INT-01 through INT-10; DEC-01 through DEC-12 | Intent and decisions | User expectations and design decisions |
| CAP-01 through CAP-07 | DOM capture architecture | Recorder behavior and observation limits |
| EV-01 through EV-08 | Evidence contract | Integrity, sufficiency and privacy of evidence |
| FLOW-01 through FLOW-05 | Task-flow coverage | Complete, honest versioned case accounting |
| EVAL-01 through EVAL-06; DET-* | Evaluation and design system | Evidence-grounded judgment and detector rules |
| ENV-01 through ENV-04; REL-01 through REL-04 | Real environments and release gate | Legitimate execution and enforced promotion |
| Q0 through Q7 | Implementation plan | Delivery sequence and completion criteria |

## Status and Next Delivery

The seed catalog is not 100% verified coverage. Numeric capture limits are initial
proposals, not measured guarantees. Browser APIs cannot prove that every physical
compositor frame was observed; the manifest must disclose capabilities and gaps.

The next artifacts are complete per-flow preparation packs and validated semantic-review
orchestration, with explicit missing prerequisites for every catalog row. No live capture
or eval loop may precede these prerequisites. Complete the flow/variant denominator and
recorder/reviewer calibration before a full-coverage or release claim. Unrelated DoD implementation
and promotion remain paused while the incident/qualification work is active.

Existing [harness guidance](../../harness/README.md),
[product specification](../01-product-spec.md), [UI design](../ui-design/README.md),
[DoD](../implementation/2026-09-10-autonomous-delivery/02-definition-of-done.md) and
[implementation backlog](../implementation/2026-09-10-autonomous-delivery/04-implementation-backlog.md)
remain relevant. This contract strengthens real-experience evidence without replacing
their safety, authority, compatibility or all-finding closure requirements.

## Review Outcome

The loop now specifies finding ownership/closure, evidence invalidation, per-claim
acceptance, required-branch reachability, passive capture during driver waits, scoped
observer cost, real test-state isolation and mixed-version deployment/rollback checks.
All remain design requirements until implemented and qualified. Do not start another
general planning layer in place of the first actual per-flow capture design.