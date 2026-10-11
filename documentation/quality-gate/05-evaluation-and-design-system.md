# Evaluation and Design-System Gate

Status: CONTRACT; local admission and semantic orchestration partially implemented, NOT QUALIFIED.
Version: 0.3. Date: 2026-09-12.
Inputs: [task flows](04-task-flow-coverage.md) and [evidence contract](03-evidence-contract.md).

## Independent Judgment

| ID | Requirement |
| --- | --- |
| EVAL-01 | Define each oracle from a user expectation, not the current implementation's output. |
| EVAL-02 | Require both complete deterministic heuristic evals and open-ended LLM semantic review; neither replaces the other. |
| EVAL-03 | Every finding and pass conclusion cites sufficient original evidence. |
| EVAL-04 | Calibrate detectors and reviewers independently; no self-approved baseline or hidden retry. |
| EVAL-05 | Design-system conformance means actual paint and interaction, not token declarations alone. |
| EVAL-06 | A clean verdict requires complete required coverage and no unresolved material findings. |

The driver cannot declare user success. The recorder cannot fill missing observations
with expected values. A screenshot reviewer cannot override a deterministic chronology,
privacy or authorization failure because the final screen looks correct.

## Controlling Definitions

**Heuristic evals** execute predefined task flows and deterministic algorithms for known
expectations. Before execution we know precisely what should happen, which observations
establish it, which algorithm checks them and what constitutes failure or insufficient
evidence. "Heuristic" here does not mean a merely suspicious proxy or optional hint.

**Semantic evals** start from an open qualitative statement of the user's expected
experience. A configured LLM agent reviews the DOM mutation timeline and accompanying
paint, content, execution and artifact evidence to discover unanticipated anomalies.
The possible failure modes are not a finite checklist. The reviewer is not restricted
to known detector IDs, predefined categories, answer correctness or heuristic findings.
It reviews whether the complete experience made sense and served the user's goal.

Semantic review is a core, mandatory catch-all responsibility, not a supplement. This
does not mean the model is infallible or can prove the absence of every possible defect.
Both eval paths must complete successfully for a clean flow result. Release authority
remains separate and cannot waive deterministic safety failures.

## Preparation Before the Loop

No tested flow may start until all of the following are frozen, implemented, bound by
content identity and validated for that exact flow and its required variants:

1. Task design: user expectation, real starting state, exact actions, branches, triggers,
	deadlines, intermediate outcomes, result delivery, failure/recovery and cleanup.
2. Capture design: exact regions and identities, structural/content/temporal/paint
	resolution per phase, observer lifecycle, privacy, sentinels, permitted resolution
	transitions, resource ceilings, reconstruction and evidence-insufficiency rules.
3. Heuristic design: every known obligation mapped to inputs, executable algorithm,
	exact pass/fail/insufficient rules, required branch reachability and negative controls.
4. Semantic harness: qualitative expectation, explicitly preloaded skill, pinned agent
	profile/model, evidence tools, complete-window coverage, asset inspection, cross-phase
	synthesis, result/citation validation, privacy boundaries and enforced execution budgets.
5. Validation: independent design review, recorder and heuristic calibration, semantic
	reviewer calibration, usable runtime/identity, approved environment and execution authority.

A template, skill file, permissive boolean or valid cost permit is not readiness. Every
missing artifact, unresolved detail, unvalidated capability or stale binding means
`NOT_READY` before browser launch. Reusing shared design is permitted only through exact
bindings and a flow-specific applicability decision. None of the 60 catalog rows inherits
readiness from another flow. No selector, oracle, capture threshold, review procedure or
variant may be improvised during the run. An omitted capability requires a revised plan
and new attempt, never a retrospective claim that it was captured.

## Detector Catalog

### Per-Claim Acceptance, Not an Overall Quality Score

For each claim, freeze its expected result, unacceptable counterexamples, evidence source,
decision rule/tolerance, timing window and `undetermined` condition before the run. A
rubric question alone is not an acceptance rule. Name the authorized expectation approver
and uncertainty adjudicator; absent reviewer authority blocks release, not permission
for the builder to approve its own output.

Use independent reference facts where possible: an expected calculation, the actual
test document, a known file structure or verified test-account state. App labels, model
claims and completion callbacks are observations under evaluation, not the oracle. For
persistence, verify the promised result through fresh user-visible reads and permitted
independent service evidence, not only the same optimistic local cache.

Hard conditions combine by AND: content correctness, delivery, chronology, privacy,
operability, DS and persistence each satisfy their contract. No weighted score can offset
a critical failure with attractive paint or a correct final answer. Expected denial/error
flows pass only when the error is honest, bounded, recoverable as promised and free of
prohibited side effects.

Every implemented detector must record: ID/version, category, severity, source flow and
requirement, input fields, executable rule, firing condition, uncertainty behavior,
evidence references, calibration cases and why the finding affects the user.

| Detector | Default severity | Required rule |
| --- | --- | --- |
| DET-CAPTURE-01 | Blocking evidence gap | Required channel/phase absent, overflowed, uncalibrated or unreconstructable prevents a pass. |
| DET-CHRONO-01 | Critical | A prompt precedes its own response in every observed intermediate state; uncertain association is not a pass. |
| DET-CHRONO-02 | Critical | No transient disappearance, duplicate visible identity, old-reply substitution or reconciliation sequence jump. |
| DET-SCROLL-01 | Critical when it breaks reading | User-pinned history anchor remains stable through streaming/reconciliation; intended scrolling is distinguished. |
| DET-STATE-01 | Critical | Progress, failure, cancellation and completion agree with actual observed execution and delivered output. |
| DET-OUTPUT-01 | Critical | Intended real content/artifact appears in its required inspectable surface and survives promised persistence. |
| DET-PAINT-01 | Critical | Required surface is not blank, hidden, clipped, behind another layer or misleadingly stale. |
| DET-OPERABLE-01 | Critical | An enabled required action is hit-testable and keyboard-operable through the real user path. |
| DET-DS-01 | Critical or warning by impact | Computed paint/layout/typography/controls conform to the approved DS for the actual state and viewport. |
| DET-A11Y-01 | Critical or warning by impact | Names, focus containment/return, reading order, announcements, contrast and reflow meet the scenario contract. |
| DET-PERSIST-01 | Critical | Reload/second-session result preserves intended content, ownership and chronology. |
| DET-PRIVACY-01 | Critical | Permission, owner isolation, cancellation and deletion exclusions hold at actual read/write/use boundaries. |
| DET-SEMANTIC-01 | Critical for task failure | Mandatory open-ended LLM review assesses the complete experience and actual output against qualitative user expectations; novel findings need no existing detector ID. |

Known paint or progress checks are heuristic evals when their exact rule and uncertainty
conditions are predefined. Open-ended interpretation belongs to semantic review. For
example, mostly-white pixels alone cannot establish that an image generation failed.

## Temporal Interpretation

Evaluate ordered evidence before reducing it to final summaries. Check first feedback,
stable identity, valid progress transitions, terminal immutability, cancelled continuation,
output handoff and restore. Explicit user actions can legitimately reopen/edit a state;
the event model must distinguish that from spontaneous regression.

Chronology evaluation must not role-sort records, force replies to the bottom, rewrite
logical time, ignore streaming phases or start sampling only after readiness settles.
Retain DOM and paint timelines separately. Respect intentional entrance motion without
masking remount/disappearance or allowing a reply above its prompt.

Use declared timing contracts and measured clock uncertainty. A missing frame stream
does not prove the product was stable. A network idle event does not prove the UI is ready.

## Design-System Truth

Sources are the approved [tokens](../ui-design/01-design-tokens.md),
[components](../ui-design/02-components.md), [motion/accessibility](../ui-design/06-interaction-motion-accessibility.md),
[content/assets](../ui-design/07-content-and-assets.md) and
[responsive/platform rules](../ui-design/09-responsive-and-platform.md).

Bind the DS contract and approved reference set to each report. If documentation and
current components disagree, log the conflict and resolve intended behavior; do not
silently adopt the broken implementation as the reference.

Check real computed font family/load/glyphs, size/weight/line-height, spacing, semantic
colors, contrast on the rendered background, borders, radius, elevation, overflow,
responsive layout, focus indicators and relevant motion states. Reuse existing static
DS checks underneath this gate, but do not treat them as proof that the deployed paint
uses the expected values.

Use reviewed screenshot baselines for stable regions and structural/semantic visual
checks for generated content. Dynamic masks must be small, declared and cannot hide the
primary result, order, error, action, focus or typography. Keep deterministic screenshot
comparison and semantic composition review separate. No automatic baseline replacement
after a failure; record who approved the changed expectation and why.

All production assets must load normally. Blocking icon fonts and then ignoring fallback
ligature overlap is not full visual qualification. A gallery requires actual images;
a canvas requires actual paint; a menu requires real reachable controls in the viewport.

Record the reference approver, rationale, viewport/theme/font/browser conditions and
comparison tolerance before execution. Independently review the reference's usability;
matching a bad screenshot does not make the product good. Separate permissible raster
or animation variance from clipping, wrong spacing and missing glyphs. Generated-content
regions still require composition/readability and semantic checks, not broad masking.

## Mandatory Semantic Review

Each evaluation card supplies a qualitative expected experience and relevant domain
context before live calls. Known calculable assertions belong to the heuristic path.
Anchors and examples may help semantic interpretation, but cannot fence off unexpected
failures or convert semantic evaluation into a closed list of assertions.

| Task family | Semantic judgment beyond a success event |
| --- | --- |
| Chat | Correct answer to the actual question, requested constraints, context attribution, no unsupported certainty. |
| Document-grounded answer | Claims and cited spans agree with the actual uploaded document, including conflicting or absent evidence. |
| Image | Requested subject/edit visibly present, original/input association correct, output inspectable and usable. |
| Generated file | Actual file opens and contains correct values/structure; preview and download agree under declared transformations. |
| Memory | Current approved meaning, subject/temporal/sensitivity attribution and reported use match subsequent real replies. |
| Deletion/export | Actual scope and retained copies match the wording; partial success is not represented as complete. |

A semantic review packet includes original goal, starting state, chronological action
log, safe content/artifacts, timeline references, DS expectations, known omissions and
scenario-specific questions. Reviewers must be able to open the original evidence;
summaries and hashes alone are insufficient for meaning or visual quality.

The LLM reviewer is mandatory and cannot solely authorize release. Pin its model, skill,
profile and evidence protocol, measure behavior on independently labelled positive and
negative cases, retain disagreements and require authorized adjudication of uncertainty.
Generated UI/content is untrusted evidence, never an instruction to the reviewer to
ignore a rule or change its verdict. No raw credential or personal-account evidence is
sent to a reviewer. Reviewer execution needs its own request/token/spend budget.

## Semantic Evidence and Accountability

The review procedure is reproducible and auditable; identical stochastic judgments are
not guaranteed. Every finding states its observation, expected experience, user impact,
severity and original evidence IDs. Categories are free-form: a previously unknown issue
is valid without a detector ID. Separate observed facts from causal hypotheses. A
provider's description of an image is not evidence that the image contains the subject.

Retain reviewer inputs, outputs, coverage, usage and exact evidence references.
Reviewers must receive failed/intermediate states, not just a curated final summary.
Calibrate on independently labelled acceptable and unacceptable outputs, including
plausible-but-wrong results and prompt-injection attempts inside untrusted evidence.
Measure false acceptance and false rejection separately; agreement between two identical
reviewers is not independent ground truth. Use held-out cases not repeatedly tuned during
the repair loop. An LLM vote or self-reported confidence alone never authorizes release.

Review every ordered evidence window, with predeclared overlap and stable event IDs.
Preserve concerns across windows and perform a separate whole-experience synthesis.
The implemented protocol isolates each window in a fresh bounded SDK session, carries
bounded prior-window concerns and performs synthesis in a separate session with all
window observations and read-only access to the original evidence. Session isolation
reduces repeated context, but never permits omitting windows or losing cross-phase issues.
Required screenshots and artifacts must be inspectable through bounded read-only tools.
The initial semantic pass receives original expectations and observations, not a curated
heuristic conclusion; compare the two paths afterward to reduce anchoring. A novel anomaly
found by either path survives aggregation. Inspecting a window is coverage evidence, not
proof that the model understood it. Missing context or exhausted budgets cannot be fixed
by silently truncating history or reviewing only the final screen.

Semantic outcomes are `ANOMALIES_FOUND`, `NO_ANOMALIES_FOUND` or `INSUFFICIENT_EVIDENCE`.
The latter cannot be converted into a pass. Preserve reliably observed product failures
even when recording or review subsequently fails. Deterministic failures cannot be
overruled by a favorable semantic assessment. No arithmetic quality score offsets them.

## Critique and Improvements

- The earlier "supplementary AI" framing was an architectural error. It left unexpected
	failures unowned. Semantic review is now mandatory before a flow can be clean.
- "No detail left undefined" concerns the execution and evaluation procedure, not an
	exhaustive enumeration of what may go wrong. Freeze the procedure; leave discovery open.
- An LLM catch-all cannot compensate for selective evidence. Per-flow abstraction must
	preserve diagnostic context and be tested against counterexamples outside known checks.
- Long captures require an explicit capacity calculation. The current bounded reviewer
	must reject a trace that cannot fit its planned windows; it cannot invent a compaction
	strategy mid-review. A larger flow needs a separately designed and calibrated protocol.
- Structural schema validation proves fields and bindings, not the quality of prose or
	completeness of a design. Independent substantive review is mandatory, with authenticated
	provenance; a builder-authored `accepted` field is insufficient.
- Reviewer skill and model configuration require real held-out calibration. Offline fake
	clients test orchestration only. No calibration thresholds or approval are inferred from
	those tests, and no diagnostic history is retroactively semantic-qualified.
- Preparation is a per-flow prerequisite, not a demand to run all variants simultaneously.
	An admitted flow can run only its predefined matrix; absent cases remain visible in the
	full denominator. The whole suite is not ready while required packs are missing.

## Current Implementation Boundary

[Preparation validation](../../tests/e2e/deployed/preparation.mjs) denies unbound or
unverified packs at the [launch boundary](../../tests/e2e/deployed/run.mjs). The
[semantic module](../../tests/e2e/deployed/semantic.mjs) uses the installed Copilot SDK,
a named agent and the explicitly loaded [skill](../../.github/skills/edd-semantic-review/SKILL.md).
Its [profile](../../tests/e2e/deployed/semantic-agent.json) is a proposed bounded
configuration, not a validated model/runtime or proof of semantic quality.

The local recorder calibration now has real headless-browser evidence for the fixed
geometry, accessible-name, focus-pixel and chronology controls in the
[frozen procedure](flows/recorder-calibration.md). Durable semantic journals and an SDK
pre-dispatch reservation guard are implemented and tested offline. Neither test callbacks
nor that local calibration supply independent privacy, budget or release authority.

No deployed flow currently has complete approved preparation. The CLI has no configured
independent attestation verifier or credential/semantic-dispatch authority. Evidence
ingestion, privacy approval, complete recorder fidelity, reviewer calibration and release
integration are not yet qualified. Launch stays denied and live configuration stays off.

### Verified Runtime and Capacity Checkpoint

On 2026-09-12, the installed SDK 1.0.13/runtime 1.0.83 returned authenticated
normal-user status without creating a session or attempting inference. A separately
bounded metadata GET confirmed that `gpt-5.4` is enabled. Metadata travels through the
same SDK request handler as inference: a denied metadata request must not be counted as
a model call. The metadata channel now permits only the observed exact HTTPS `/models`
GET, once, with redirects disabled, a 2 MiB streamed response cap and a 10-second deadline.
The inference guard also sets `redirect: error` at forwarding; SDK-default requests do
not supply that setting themselves.

The supplied prices are AI credits per 1,000,000 tokens, not dollars: standard input
250 and output 1,500 up to a 272,000-token prompt; long-context input 500 and output
2,250. The model advertises a 922,000-token maximum prompt. These are point-in-time
metadata observations, not a guaranteed account allowance or future price contract.
The active profile's 120,000-input/10,000-output ceilings would reserve 45 credits at
standard rates, exceeding its two-credit cap. Neither model capacity nor compression
authorizes raising a spend ceiling.

One synthetic two-session canary was admitted only as far as account quota inspection.
The quota response did not establish that paid overage was disabled, so it stopped as
`CANARY_ADDITIONAL_CHARGE_NOT_EXCLUDED`, with zero reserved model attempts and no model
usage. The user was unavailable to provide specific paid-overage approval; the zero
additional-charge boundary remains intact. Browser login is resolved and was not
restarted, cloned or disturbed by these checks. See the retained
[canary result](../../.harness-state/deployed-eval/semantic-roundtrip-0e720121-d2b3-4bca-9feb-4a0f92295bef/result.json).

A separate blinded agent labelled the six existing synthetic examples before builder
label comparison. Its findings are advisory, not independent ground truth, held-out
qualification or a validation of the pinned SDK reviewer. No real five-flow eval has run.

### Candidate Lossless Timeline Protocol

[The candidate codec](../../tests/e2e/deployed/review-codec.mjs) operates after capture;
raw observations remain authoritative. It is not wired into live admission or semantic
review. Its fixed format is `lossless-timeline-delta-v1`:

1. Keep records in original order. A record contains either a complete event or a
	backward reference to the preceding event of the same kind and document, plus changes.
2. Preserve every event ID, timestamp, frame measurement and unknown field. Changes use
	explicit paths with `set`, or a UTF-16 prefix length plus literal text suffix. A key
	insertion/deletion, object-key reorder or array-size change replaces that container;
	the replacement retains the exact structure and order. No detector-selected omission,
	frame sampling, rounding, semantic summarization or final-state substitution is allowed.
3. Every window starts with its own complete records for each kind/document it uses.
	References never cross windows or documents. The planner starts at at most 80 events,
	reduces the end until the encoding fits 24,576 bytes, and retains exactly four events
	of overlap. A non-final window that cannot hold overlap plus new evidence fails.
4. At most 24 windows and 786,432 encoded bytes are allowed in this local experiment.
	A single oversized record, unique-data overflow, invalid JSON, forward reference,
	unsafe path or missing reconstruction fails; no fallback drops evidence. Decoding
	is separately bounded. Reconstructed JSON must match the original event bytes in
	property order and values for each independent window.

The retained local driver traces measured as follows, including independent-window
checkpoints and overlap under the 24 KiB window limit:

| Flow | Raw bytes | Delta bytes | Windows | Largest window |
| --- | ---: | ---: | ---: | ---: |
| CHAT-02 | 124,325 | 55,051 | 3 | 24,436 |
| CHAT-03 | 1,690,086 | 370,651 | 16 | 24,512 |
| CHAT-04 | 173,640 | 75,585 | 4 | 24,486 |

All windows reconstructed exactly. The [measurement report](../../.harness-state/deployed-eval/timeline-capacity-d6ccfd50-68c2-477f-b23e-cf7a9e701430.json)
binds the retained source. These sizes exclude skill/system text, prompts, tool schemas,
prior-window notes, original-evidence rereads, screenshots, synthesis and wire framing.
They are not a complete review budget or a worst-case compression guarantee.

Adoption still requires a complete priced envelope with enforced pre-dispatch token,
request and spend reservations; a capture-time encoded ceiling whose overflow remains
insufficient evidence; source-bound per-flow plans; and blinded held-out calibration
showing that the reviewer understands deltas and can use original reconstructed evidence.
The current raw-capacity admission gate remains unchanged. The candidate cannot qualify
any flow merely because these three retained traces fit.

Fix the sample count, variation dimensions and stopping rule before generated-output
qualification. Retain all attempted outcomes and usage. Do not repeatedly generate until
one answer passes, exclude service failures from the denominator, or claim statistical
reliability from three favourable examples. Existing DoD repetitions and G06 calibration
still apply; missing thresholds or independent review block the relevant claim.

## Clean Criteria

A scenario is clean only when required evidence is sufficient, deterministic rules pass,
there are zero critical findings, no unresolved warnings and no actionable semantic
findings, and primary output is inspectable. Informational notes are not surprise blockers.

A warning may be accepted only by the authorized expectation/release owner with evidence,
rationale, scope and expiry, before the verdict. Chronology, privacy, owner isolation,
missing primary output and required DS violations cannot be downgraded or waived merely
to ship. The builder cannot accept its own warning or update a baseline into a pass.

Timing-sensitive/generated/integration flows need independent repeated clean runs under
the frozen matrix and budget. Preserve all attempts; a retry is a new attempt, not erasure
of failure. Follow the existing DoD's required repetitions and gates; this specification
does not lower them. No invented universal repeat count for stochastic semantic quality.

## Detector Qualification

Maintain a separate calibration bank with known positives and injected negatives:
inversion then correction; hidden then restored prompt; wrong but plausible answer;
wrong artifact; clipped menu; fallback icon text; stale profile; unexpected ownership;
incomplete recording; and valid entrance animation. Each critical detector must reject
its relevant mutant while allowing the known-good control.

Calibration can use synthetic states because it tests the recorder/evaluator itself.
Its results must never be substituted for running the real deployed product. Detector
changes re-evaluate retained evidence where sufficient; rerun the product only when the
old evidence cannot answer the revised question or relevant product/environment changed.