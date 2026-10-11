# Eval Loop Approach Review

Status: CORRECTED FRAMEWORK REVIEW; LOCAL FOUNDATION TESTED, RUNTIME NOT QUALIFIED.
Version: 0.2. Date: 2026-09-12.

Scope: critique of the whole proposed loop, not a code audit or diagnosis of the current
production failure. Priorities below describe release-risk significance, not verified
production incidents. Existing correct requirements are retained, not presented as absent.

## Assessment

The direction is right: real deployed workflows, explicit per-flow capture designs,
localized DOM detail, temporal evidence, actual paint and independent outcome judgment.
The weakness was operational precision. The approach could accumulate detailed recordings
and green script results without a reproducible answer to "is this user expectation now
satisfied, and is this exact deployment safe?" Documentation alone cannot enforce the gate.

The later terminology correction exposed a deeper error: treating AI review as
supplementary left unanticipated anomalies outside the mandatory loop. The controlling
[evaluation contract](05-evaluation-and-design-system.md) now makes semantic review a
mandatory LLM responsibility and requires complete task, capture, heuristic and semantic
preparation for every flow before any evaluation starts.

## Findings and Improvements

| ID / priority | Weakness in the previous design | Improvement made | Required proof still outstanding |
| --- | --- | --- | --- |
| REV-01 / P0 | Milestones and capture/fix/rerun language existed, but finding ownership, closure and evidence invalidation were under-specified. | [Operating loop](07-implementation-plan.md) defines locked expectations, diagnosis by failure layer, bounded repair, real rerun/contrast and independent closure. | Close one real incident with preserved before/after evidence and compatible counterexamples. |
| REV-02 / P0 | Mandatory per-flow design was explicit, but no individual flow was actually capture-designed. Generic rules could still be mistaken for readiness. | [Coverage contract](04-task-flow-coverage.md) requires claim-to-phase/field mapping and proof that required branches occurred; [plan](07-implementation-plan.md) makes one reviewed design the next artifact. | Author and review actual selectors, regions, resolution, branches, observation topology and insufficiency rules for each qualifying flow. |
| REV-03 / P0 | Playwright could wait, retry or scroll past an unusable intermediate state, then succeed; capture phase transitions could depend on the correct outcome. | [Capture architecture](02-dom-capture-architecture.md) requires passive observation throughout action waits and wrong-state branches; no force-click or capture-after-correction shortcut. | Calibrate transient hidden/covered controls and real first-response timing without changing product behavior. |
| REV-04 / P0 | Semantic questions and multiple reviewers did not alone define a binding acceptance decision; a plausible answer or a bad visual baseline could pass. | [Evaluation rules](05-evaluation-and-design-system.md) require per-claim criteria, independent references, non-compensating hard conditions, reviewed DS tolerances and held-out reviewer calibration. | Approved rubrics/references, false-accept/reject evidence and authorized uncertain-case adjudication. |
| REV-05 / P0 | User accounts were isolated, but repeated flows could share learned memories, exclusions, caches and pending work, invalidating independence. | [Environment rules](06-real-environments-and-release-gate.md) define verified initial-state profiles, state lineage and non-destructive cleanup boundaries. | Real test-account provisioning and repeatable legitimate setup, including fresh versus stateful cases. |
| REV-06 / P0 | Artifact binding and code-only rollback existed, but source equality did not establish auth/origin/cache parity or backward data/worker compatibility. | [Release rules](06-real-environments-and-release-gate.md) add environment delta and mixed-version qualification before mutation. | Private/public equivalence, old-client/new-API behavior, safe retained rollback and enforcement on every mutation path. |
| REV-07 / P1 | Lossless JSON compression did not ensure low observer cost; global old-value capture or recursive hashing can still perturb streaming. | [Observer topology](02-dom-capture-architecture.md) is part of each flow design, with scoped channels, phase-switch drain and browser-side cost measurement. | Size/latency/old-value-copy calibration; no measured optimality claimed. |
| REV-08 / P1 | A single status could obscure a genuine product failure when another capture channel failed; absent branches could yield vacuous passes. | [Evidence contract](03-evidence-contract.md) separates execution, product outcomes, evidence sufficiency and release eligibility; [coverage](04-task-flow-coverage.md) requires reached-branch evidence. | Validator and report negative controls for mixed failure, missing phase and truncated capture. |
| REV-09 / P1 | Repeated clean examples could encourage retry-until-green and tuning the judge to familiar failures. | [Evaluation](05-evaluation-and-design-system.md) fixes sampling/stopping rules, retains all attempts and uses independent calibration/holdouts; [loop](07-implementation-plan.md) controls rerun scope. | Execute the existing DoD repetition/semantic gates without hidden retries or denominator changes. |

P0 findings are prerequisites to a trustworthy release claim. P1 findings are also
blocking when required to establish capture/evaluation adequacy for the tested flow.
"Improvement made" means the requirement was specified, not implemented or independently
proven. No finding is runtime-closed by the presence of this review.

## What Not to Change

- Keep real product execution as the qualification layer. Unit/component/calibration
  fakes are useful for diagnosis and detector tests, never deployed-workflow proof.
- Keep every flow's capture design authored before execution. No automatic relevance
  invention, retrospective detail expansion or silent lower-resolution fallback.
- Keep the JSON-video concept: baseline plus timestamped ordered changes, frame/paint
  evidence and explicit gaps. Do not turn it back into final screenshots or full-DOM dumps.
- Keep observations separate from judgment; safety sentinels may stop an unsafe run,
  but must not curate away unexpected state or fill it with expected state.
- Keep critical chronology, privacy, isolation, delivery and DS conditions non-waivable.
- Keep all automation hidden and isolated from the user's desktop, mouse and browser.
- Keep existing G00-G12 authority, full required matrix and rollback/privacy constraints.

## Improved Loop in One View

```text
User expectation and unacceptable counterexamples
  -> complete per-flow task/capture/heuristic designs and legitimate initial state
  -> configured, skill-loaded and calibrated open-ended semantic reviewer
  -> validate and lock every prerequisite, authority, budget and observation capability
  -> real actions with continuous declared temporal/paint evidence
  -> complete deterministic heuristics AND independent open-ended LLM timeline review
  -> mandatory cross-phase semantic synthesis and conservative combined judgment
  -> retain finding; distinguish product, capture, driver, oracle or environment cause
  -> smallest evidence-backed repair and focused regression
  -> new real attempt plus impacted/held-out cases
  -> independent closure and full exact-candidate release gate
  -> authenticated public verification and guarded recovery
```

Unknown evidence, an unvisited required branch, an uncalibrated reviewer or a live failure
prevents promotion. Fixing a capture defect does not erase a reliably observed product
defect. A full gate pass is scoped to the exact recorded artifacts, state and environment;
it is not a permanent certificate against future provider or deployment drift.

## Stop General Planning Here

The next useful artifacts are complete flow packs, executable admission checks and the
mandatory semantic harness, not another generic layer. Unknown actions and selectors
remain blockers until separately authorized preparation resolves them. No live eval may
start while its task, capture, heuristic or semantic design is incomplete.

Do not claim the 60-row seed is complete live coverage, the recorder is implemented,
test-account automation is available, the deployed app is fixed or the ultimate gate is enforced. Those
remain explicit work with their own authorization, budgets and evidence.

## Verification of This Review

Verify document links, unique flow IDs, referenced detectors, requirement/version labels
and a single authoritative location for each rule. Validate the proposed loop on paper
against: inversion then correction; covered control eventually clicked; plausible wrong
answer; stale test memory; missing recorder channel; mixed-version rollback; and a required
branch never reached. None may result in a release-eligible pass from a success callback.

This is specification consistency checking only. Real browser, recorder performance,
semantic calibration, account provisioning and deployment tests were not run in this pass.