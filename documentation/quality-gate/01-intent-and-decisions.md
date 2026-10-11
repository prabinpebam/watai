# Intent, Sources and Decisions

Status: USER REQUIREMENTS RECORDED; IMPLEMENTATION DESIGN PROPOSED.
Version: 0.1. Date: 2026-09-12.

## Why This Work Exists

The user reports that the deployed app is broken and rejects callback/test-count-based
assurance. Prior work had local unit/component tests, development-fixture browser flows,
synthetic chronology canaries and production public-shell/health observations. Those
layers are useful but do not establish real authenticated task completion or coherent
intermediate rendering on the actual deployed product.

This set records the subsequent discussions about real-deployment qualification,
complete task-flow enumeration, dedicated test identities, DOM observation, semantic and
visual judgment, and adoption of Eval Driven Development. It is not a replacement for
the separate product specifications, the existing DoD, or the historical release receipts.

The current production failure has not been diagnosed by this planning task. No claim
is made that the current serving code equals the last recorded receipt, that tests
have run against it, or that test users and release enforcement already exist.

## User Requirements

| ID | Recorded requirement | Consequence |
| --- | --- | --- |
| INT-01 | Higher quality for deployed changes; do not break established behavior | Small evidence-backed changes, exact artifact qualification and recoverable promotion. |
| INT-02 | Chat chronology is sacrosanct in every observable intermediate state | No transient inversion, disappearing prompt/reply or reconciliation jump accepted. |
| INT-03 | Test the real deployed app in a real browser with no faked/mocked behavior | Local fixtures and fake transport cannot satisfy the deployed gate. |
| INT-04 | Enumerate all task flows and judge outcomes against user expectations | A frozen case/variant denominator and semantic/visual per-step acceptance, not test-count coverage. |
| INT-05 | The screen must appear, make sense, look correct and align with the design system | Verify actual assets/paint/layout/interaction and content meaning. |
| INT-06 | Create a legitimate test user | Dedicated real identities, protected credentials and real authorization flows. |
| INT-07 | Automation must not hijack active windows or the mouse | Verified hidden execution; no OS focus/input takeover or visible fallback. |
| INT-08 | Broken required flows prohibit deployment | Enforced candidate gate, real production verification and incident freeze/recovery. |
| INT-09 | Capture DOM state properly and optimally; unseen outcomes cannot be judged | Explicit multi-channel capture contract, resource calibration and insufficient-evidence verdict. |
| INT-10 | Persist the discussions in proper planning/specification documents | This versioned, linked set with clear implementation and verification status. |

The active incident/qualification work takes precedence over unrelated continuous DoD
delivery. These documents do not resume paused implementation or grant remote authority.
The existing watchdog is monitoring-only; it cannot supply missing deployment evidence.

## EDD Source Material

Reviewed user-provided sources from the CP Local Agent project:

| Source | Version/date in source | Local origin supplied by user |
| --- | --- | --- |
| Eval Driven Development - Framework Specification | 4.0, 2026-04-29 | `E:/Projects/Work/cp-local-agent/documentation/eval-loop-framework/eval-driven-development.md` |
| CP Local Agent Eval Driven Development Interpretation | 1.0, 2026-04-29 | `E:/Projects/Work/cp-local-agent/documentation/eval-loop-framework/eval-loop-framework.md` |
| DOM State Capture For Eval Driven Development | 3.0, 2026-04-29 | `E:/Projects/Work/cp-local-agent/documentation/eval-loop-framework/dom-state-capture-guide.md` |

These external paths identify reviewed sources; Watai's runtime must not depend on that
workspace existing. The documents below restate the Watai-specific contract rather than
copying the Electron runner or requiring external files during execution.

### Adopted Principles

- User problem -> scenarios -> user-can statements -> task flows -> expected experience.
- Define correctness before inspecting code for selectors and observation mechanics.
- Drive real user actions; directly reading evidence is different from injecting success.
- Record broadly enough to find unanticipated failures; observation precedes judgment.
- Separate product, execution, visual, integration and artifact layers.
- Require visible/operable output, not DOM existence, successful callbacks or hidden files.
- Require deterministic heuristic evals and mandatory open-ended LLM semantic review of the complete temporal experience.
- Retain attempt packages and converge on real experience, using tests underneath EDD.

### Adaptations and Rejected Shortcuts

| Source pattern | Watai decision |
| --- | --- |
| Real Electron launch/window selection | Real deployed web origin in dedicated headless browser contexts, never a user window. |
| Optional synthetic setup with disclosure | No substituted action/result in deployed qualification; administrative real setup is labelled and separately tested. |
| 200-500 ms polling | Idle health fallback only; transition capture uses ordered DOM events and frame/layout/paint channels. |
| Basic visibility/name/image helpers | Require ancestor clipping/occlusion, real accessibility semantics, decoding and actual paint evidence. |
| Fingerprint suppression | Lossless reconstruction and temporal accounting; no coarse filtering that removes transient changes. |
| Default empty execution/store summaries | Use explicit unknown/unavailable; absence of an observation API is not an empty successful state. |
| Fixed stabilization sleeps or permissive readiness | Lifecycle/capture-health predicates with deadlines; timeout always has an explicit non-pass outcome. |
| Semantic review of a compact narrative | Reviewers can inspect original safe evidence; no summary-only approval or builder self-approval. |

Generic examples are illustrative, not a drop-in gate. The source guidance about visible
Electron windows or local instance control never authorizes killing user processes,
focusing applications, restarting shared production, or bypassing identity controls.

## Decision Record

| ID | Decision | Reason |
| --- | --- | --- |
| DEC-01 | Playwright execution is the driver, not the verdict | Actions can succeed while the user receives wrong or invisible output. |
| DEC-02 | Capture sufficiency is checked before a clean judgment | Missing evidence must not become false confidence. |
| DEC-03 | Separate loss-detecting raw observation from derived detectors | Unknown failures and future detectors need original evidence. |
| DEC-04 | Preserve identity and clock uncertainty across layers | Receipt time and DOM order cannot invent backend causality. |
| DEC-05 | DOM, geometry and pixels are complementary | Each has blind spots; none proves every compositor frame alone. |
| DEC-06 | Optimize recorder scheduling, not away the temporal record | Full-DOM/full-screenshot work per token perturbs the system being measured. |
| DEC-07 | "100%" refers to a versioned required case matrix | Universal correctness and every possible device/state cannot be promised. |
| DEC-08 | Treat physical-device limits as explicit blockers | Desktop WebKit or fake microphone input is not genuine hardware evidence. |
| DEC-09 | Use pre-promotion real-candidate and post-promotion real-production gates | New bytes must be deployed somewhere before testing, without exposing all users first. |
| DEC-10 | No baseline self-approval, hidden retry or critical-finding waiver | A convenient green report must not replace the user's expectation. |
| DEC-11 | Keep auth state and evidence sensitive by default | Screenshots/traces and SAS/token URLs can leak even when logs are sanitized. |
| DEC-12 | Complete all prerequisites for a flow before starting its eval loop | No execution-time invention of task steps, capture strategy, heuristic rules or semantic reviewer configuration; missing preparation blocks admission. |

## Authority and Change Control

The existing [DoD](../implementation/2026-09-10-autonomous-delivery/02-definition-of-done.md),
[backlog](../implementation/2026-09-10-autonomous-delivery/contracts/backlog.json),
repository chronology/no-focus instructions and explicit user constraints still apply.
This set does not waive independently signed evidence, safety ceilings or authentication.

User requirements above are recorded commitments. Proposed architecture, numeric capture
budgets and the seed flow list remain design pending implementation/calibration/review.
Changing an expectation, threshold, flow denominator, DS baseline or warning acceptance
requires an explicit traceable decision, not a silent adjustment after a failing run.

## Discussion Outcomes Not Yet Delivered

- Complete live-screen/role/task-flow reconciliation and approved coverage denominator.
- Actual production incident reproduction with real authentication and sufficient capture.
- Dedicated test identities, provider budgets and protected evidence storage policy.
- Implemented, calibrated recorder and semantic/visual evaluator bank.
- Enforced independent release gate and tested compatible rollback route.

Keep these gaps visible until evidence closes them. A documentation review cannot close
them, and the presence of this folder is not a certificate that deployment is safe.