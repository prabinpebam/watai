# First Deployed Flow Capture Designs

Status: HISTORICAL PARTIAL DIAGNOSTIC DESIGNS; NOT READY UNDER MANDATORY PREPARATION.
Version: AUTH-01 v2 / CHAT-01 v1. Date: 2026-09-12.

Executable definitions: [flows.json](../../../tests/e2e/deployed/flows.json).
Each definition is separately identified and hashed into its attempt. No other catalog
flow is implemented by these definitions. Selectors are grounded in source; only the
historical public diagnostic observed a production binding. New eval execution requires
complete preparation and validated binding first, not discovery during the tested flow.

These cards lack complete variant/action algorithms, reconstruction/paint calibration,
independent heuristic qualification and a calibrated semantic reviewer. They cannot
start a new eval loop. See the [mandatory contract](../05-evaluation-and-design-system.md)
and [per-flow gaps](../../../tests/e2e/deployed/preparation/catalog.json). Historical
evidence remains diagnostic and is not retroactively semantic-qualified.

## AUTH-01: Real Public Startup

Goal: a new signed-out visitor sees the actual welcome screen and an operable Sign in
control, without invoking login or any provider. Start with a fresh isolated headless
Chromium context at the exact public URL. No stored session or state injection.

| Phase | Trigger | Detailed capture | Context/abstract capture | Acceptance |
| --- | --- | --- | --- | --- |
| navigate | Before page.goto, observers installed via init script | Onboarding, real startup alerts/dialogs as they appear; safe text, roles, states and DOM deltas | Root structure, stylesheet/asset outcomes and viewport; unrelated subtrees as boundaries | No unobserved redirect, crash or unexpected authenticated content |
| ready | Actual welcome heading exists, within 45-second total deadline | Heading, description, Sign in and branding paint; ongoing mutation/frame samples | Ancestor geometry/opacity/clipping and focus | Correct heading and action; nonblank viewport; enabled, hit-testable control |
| inspect | Real keyboard Tab navigation to Sign in | Focus and control geometry through the complete action | Font/load state and actual screenshot, one-second observation window | Focus is on the real sign-in control, no clipping or page errors |

Do not click Sign in in this flow. Form input values, auth tokens and storage are never
recorded. Unknown relevant overlays are recorded and block clean interpretation rather
than dynamically rewriting the capture plan. Real fonts/resources are not substituted.

AUTH-01 v2 distinguishes startup wait until the first delivered frame from intervals
between delivered frames. Record startup latency and document ready state; the existing
whole-flow deadline still applies. A later visible-tab gap over 250 ms stops capture as
insufficient. This does not prove absence of paints before sampling or qualify browser
compositor completeness. The original v1 attempt and its gap verdict remain preserved.

## CHAT-01: Single Real Prompt and Reload

Goal: in a new test-owned conversation, the fixed arithmetic prompt receives `46`, with
prompt before reply throughout, and the same reply persists after reload. This is a
narrow diagnostic, not the entire streaming, cancellation or multi-session matrix.

Prerequisites: genuine dedicated test-account browser session obtained by normal login;
test-account consent/configuration reviewed; explicit one-submission authority and actual
provider-side spend ceiling; no real-user profile. Runner preflight must block if absent.
Session material never enters the model or evidence. No automatic account provisioning,
MFA bypass, fake tokens or request replay.

| Phase | Trigger | Capture and resolution | Required observation |
| --- | --- | --- | --- |
| navigate | Real navigation to /#/new | Shell/context; new thread/composer detailed; sidebar abstract | Actual configured test account reaches a new empty conversation |
| ready | Composer visible; no existing message nodes | Composer controls and focus detailed | Existing content blocks the case rather than being erased |
| compose | Before filling fixed prompt | Safe composer text and real input events; no other field values | Correct input and an operable Send control |
| submit | Before real Send click | All message roots detailed, timeline active during action waits | Submitted prompt remains represented; no fake acceptance |
| response | First actual assistant node | Message safe text/state mutations and per-frame order/geometry | Prompt precedes its response; no disappearance or unrelated substitution |
| complete | Real reply settled and Stop absent | Continue detailed capture through bounded reconciliation window | Exact answer `46`, no error, prompt/reply still present |
| reload | Real page reload | New document identity, fresh detailed message checkpoint | Prompt and correct reply persist; disappearance during navigation is not a same-document handoff |

Message DOM lifetime and domain IDs are distinct. Preserve all observed ordering, text,
visibility and geometry transitions. Allow only the already specified initial `msg-in`
entrance state, recording its timing; never exempt an already-visible message hidden
later. Branches not exercised here remain unqualified, including stop, stream retries,
multi-tab sync and correlated server identity handoff.

## Observer Topology and Representation

Capture a baseline, timestamped mutation batches with old attribute/text values on the
declared roots, DOM node IDs, and changed semantic checkpoints at animation frames.
Detailed descendants include meaningful text blocks and controls; incidental wrappers
retain layout dependencies but not framework data. Abstract subtrees retain boundary
identity and activity without descendant serialization. Document-wide discovery records
new semantic roots and unexpected dialogs. Fixed definitions only; no runtime relevance
model or arbitrary script supplied in configuration.

Monotonic observation time is not mutation-occurrence time. Mutation batches retain
order; frame checkpoints represent their actual read interval. Repeated frame state may
be deduplicated but frame health counts and intervals remain. Current implementation must
declare incomplete historical-value reconstruction where browser batching prevents it.
DOM/CSS/video limitations remain explicit and cannot yield release eligibility.

Bounds: event/byte/request/response/deadline ceilings are fixed in each definition.
Overflow or missing phases yields insufficient evidence. A test result and a release
verdict are separate: these first diagnostic flows never authorize deployment.

## Inputs, Privacy and Cleanup

AUTH-01 creates no account/server data. CHAT-01 creates exactly one real conversation
and one submitted run, with no automatic retry. Track the created route by a safe digest
for cleanup. Do not delete on failure: retain evidence and reconcile only test-owned data
through normal UI/API later. Never capture headers, cookies, storage, URL query strings,
auth forms, key input values or raw exception payloads. Screenshots are limited to the
public welcome or expected chat surface, never identity-provider/credential screens.

## Preparation Requirements

The following is the detailed design for two **narrow child cases**, not approval of the
whole AUTH-01 or CHAT-01 family. IDs are `AUTH-01.public-desktop` and
`CHAT-01.first-prompt-reload-desktop`; design revision is 1. Parent readiness remains
false while its other required variants are undefined. These requirements exceed the
current recorder/driver in the specifically listed implementation gaps below.

### Fixed Environment and Action Contract

AUTH uses headless installed Chromium, a fresh owned context, viewport 1280 by 850,
device scale factor 1 and locale en-US. CHAT uses the already authenticated, dedicated
Edge automation page; preserve and record its actual viewport, scale, locale and appearance.
Never clone, export storage, resize the user's window, focus it or close its page/context/browser.
Record the resolved theme, fonts, browser version and serving frontend/API identities;
default appearance is not light/dark matrix coverage. No extensions, service mocks,
forced clicks, script-submitted forms, app-state injection or alternative selectors.
Actions use real Playwright keyboard/pointer APIs, never Windows foreground input.
Supported mobile/theme/reflow cases require separately authored child designs.

AUTH starts with no storage state, cookies or authenticated identity. Navigate once to
the exact public URL with a 20-second DOMContentLoaded deadline. Install capture before
navigation. Require exactly one `.onboard__title` and one `.onboard__actions button`;
heading and action ambiguity is failure, not permission to take the first match. After
the heading becomes visible, inspect without clicking Sign in. Press Tab at most eight
times, one action and result record per keypress, stopping when the exact button owns
focus. Each keypress has a three-second deadline within the 45-second whole-flow bound.
Observe for another 1,000 monotonic milliseconds using frame callbacks, capture the
final public screenshot, drain capture and close the owned context. Never retry or log in.

CHAT starts with the designated invited non-admin account, verified identity, explicit
consent/settings snapshot, real configured provider and enforced provider budget. Before
CDP attachment, require complete preparation and validate the exact loopback receipt,
PID/start time, profile and listener ownership. Select exactly one existing Watai page.
Install disposable page-scoped capture bindings, init script, request guards and listeners;
navigate through `about:blank` to `/#/new` within the same navigation-phase deadline.
This guarantees a new document without exporting credentials or capturing the prior account
screen. Require a fresh actual `/api/me` invited/non-admin email match before submission.
Reject any pre-existing `[data-message-id]` in the new thread rather than deleting it.
Require one composer `textarea[aria-label=Message]` and one `button[aria-label=Send]`.
Fill the exact prompt in the definition and click Send once. Observe the first assistant
root and all intermediate states until `button[aria-label='Stop generating']` is absent
and the reply has settled under the declared driver predicate. Retain 1,500 milliseconds
of reconciliation, then reload once and inspect the same accepted conversation. The
whole case has a 90-second bound and no automatic resend. An ambiguous acceptance stops
side effects and requires separate real-state reconciliation; it is never a retry signal.

Public unexpected authentication/forms or protected content stop the flow before taking
a screenshot. Chat account mismatch, existing history, unknown origin, unapproved request,
second submission or changed route identity stop side effects. Failures are retained;
cleanup drains capture and removes only runner-owned page instrumentation and CDP session.
Only AUTH closes its owned context/browser. CHAT transport disconnects when the driver
process exits after evidence/output drainage; it never calls browser/context/page close.
Borrowed-page cleanup and initial-view behavior remain unqualified until calibrated;
mocked ownership tests are not real-app evidence. Chat data is retained for diagnosis and
later test-owned cleanup, with no automatic deletion on success or failure.

### Exact Observation Contract

Use the phase/region maps above throughout action waits, not only after expected success.
Resolution is constant for these child cases; **no runtime resolution transition is
allowed**. New instances matching declared roots receive new DOM lifetime IDs. A removed
node is not the same lifetime as a later remount even if its domain ID is unchanged.

Detailed roots retain node identity, parent/sibling position, node type, safe text,
declared attributes, actual mutation old/new values where reconstructable, accessible
name/role/state, geometry and paint dependencies. Track heading, subtitle, brand logo,
button and focus for AUTH; prompt, reply, composer, progress, stop/send controls and
alerts for CHAT. Retain relevant code/math/table descendants as content when they occur
unexpectedly, not only h1/p/button nodes. Do not normalize unexpected generated output
to the requested integer before recording it.

Context roots retain boundary identity, ancestor visibility/opacity/overflow/transform,
scroll/clipping geometry and changes that can affect detailed descendants. Other
subtrees retain stable abstract boundaries and structural activity. A new unclassified
overlay, inaccessible frame, recorder disconnection or change whose effect is omitted
emits an evidence gap and stops; it cannot silently become irrelevant background.

The journal records document ID, strictly increasing per-document sequence and receiver
event ID, monotonic observation time, time origin, batch order, added/removed identities
and sibling anchors. MutationObserver delivery time is not claimed as mutation-occurrence
time. A->B->A history cannot collapse to A. If historical intermediate values cannot be
reconstructed, identify the missing interval; no semantic reviewer may invent it.

At every rAF opportunity record frame health and the actual ordered semantic state,
including visibility, bounds, focus, scroll anchor, viewport, font loading and image
decode. Retain frame accounting even when an identical state snapshot is deduplicated.
Pair timestamps with screenshot references at initial ready, focus completion, before
submission, first reply, terminal state and post-reload as applicable. A screenshot does
not prove all intervening compositor paints. No required media channel may be replaced
with a text description of what the image supposedly shows.

Existing definition limits remain 12,000 events/8 MiB/80 requests/15 MiB network for AUTH,
and 24,000 events/16 MiB/120 requests/20 MiB network for CHAT. One recorded visible-frame
interval over 250 ms, observer callback over 50 ms, more than 400 selected nodes, a text
field over 4,096 characters, undrained mutations or byte/event overflow means insufficient
evidence. These thresholds are proposed current limits, not calibrated sufficiency.
First-frame startup wait is recorded separately; absence of an early frame is not proof
of an empty screen. All limits require independent calibration before admission.

### AUTH Deterministic Heuristic Algorithms

For each algorithm, absent required fields or intervals means insufficient evidence,
not false/empty. Assertions inspect original evidence, not only driver outcome booleans.

| ID | Algorithm and exact pass condition | Failure and negative control |
| --- | --- | --- |
| AUTH-H01 | Find exactly one heading in the ready/inspect welcome region; its observed text is exactly `Welcome to Watai` and it remains visible through the final frame. | Wrong, duplicate, missing or hidden heading; test each even when driver `heading` is true. |
| AUTH-H02 | Find exactly one named `Sign in` button. At ready and each inspect action, disabled/inert/aria-disabled are false, width/height positive, bounds inside viewport, ancestor clip intersection contains the action center, and hit-test resolves to the button or its descendant. | Enabled DOM node behind an overlay, clipped center, zero opacity or offscreen bounds; test each independently. |
| AUTH-H03 | Observe real Tab action records and focus transitions. Within eight presses the exact button owns focus and a visible focus indicator is painted. Preserve the complete sequence before and after focus. | Focus reaches a hidden proxy, action count exceeds eight, focus is only set by script, or indicator is invisible. |
| AUTH-H04 | Match loaded required HTML/CSS/JS/font identities to the approved deployment/reference binding; logo is visibly rendered and required text is readable at actual resolved fonts. | Missing asset, blank logo or fallback glyph overlap even with successful page navigation. |
| AUTH-H05 | Account state remains signed out, no protected content appears, all requests obey the fixed method/origin/budget contract, and no page error occurs. | Unexpected authenticated shell, unauthorized method/origin, crash or budget breach. |
| AUTH-H06 | Required phases occur in order, capture spans every action wait, sequences are continuous, all required screenshots are present and capture drains normally. | Missing phase, lost event, unclassified overlay or incomplete finalization cannot pass. |

AUTH-H04's exact DS/asset reference values and AUTH-H03's focus-paint tolerance must be
bound to approved source artifacts before implementation is called complete. The current
driver only checks heading text, center hit-test and final focus; it does not implement
the complete algorithms above. This is a named readiness blocker, not a deferred runtime choice.

### CHAT Deterministic Heuristic Algorithms

| ID | Algorithm and exact pass condition | Failure and negative control |
| --- | --- | --- |
| CHAT-H01 | One actual Send action and at most one accepted run; the persisted prompt's text matches the submitted prompt exactly and its identity is linked to the actual acceptance receipt. | Duplicate acceptance, lost prompt, altered text, missing or ambiguous association. |
| CHAT-H02 | In every observable same-document intermediate state after prompt submission, its representation remains present and before its own reply in DOM and visual reading order. Association uses immutable logical IDs, not role sorting. | One-state inversion, hide/restore, duplicate identity, remount handoff gap or later sequence correction. |
| CHAT-H03 | Progress, streaming, cancellation/error and terminal indications agree with actual run receipts and delivered content; terminal state never regresses without an explicit new action. | Spinner disappears before a failed run is disclosed, truncated stream claims complete, stale work alters terminal output. |
| CHAT-H04 | Read the complete actual assistant answer after terminal handoff; trim only leading/trailing whitespace and compare exactly with `46`. | Markdown fences, explanation, wrong arithmetic, an empty answer or a correct hidden value behind wrong visible content. |
| CHAT-H05 | After actual reload, the same conversation/prompt/reply identities and answer are returned from fresh persisted reads, with no duplicate or transient reordered representation. | Optimistic-only success, wrong route, substituted response, duplicate or stale read. |
| CHAT-H06 | Composer, messages, alerts, fonts and output are visible, unclipped and usable; inspect ancestor clipping, actual paint, focus and scroll anchoring at every relevant transition. | Correct DOM content hidden/covered, displaced reading anchor, missing glyphs or unusable action. |
| CHAT-H07 | All required phases, per-document sequences, action records, receipt correlations, screenshots and final drains are present within fixed limits. | Missing branch/receipt/channel or any capture gap is insufficient; a reliable chronology failure remains a failure too. |

The exact durable receipt/correlation API, every-render paint fidelity, scroll reference,
settled-response predicate and independent DS thresholds are not provided by the current
diagnostic. They must be implemented and validated before this child case is ready.
Pending/stale/out-of-order/server-handoff and second-session cases require separate
fixed schedules and branch-reachability proof; a fast happy-path run never covers them.

### Semantic Preparation for Both Cases

AUTH qualitative expectation: "As a new visitor I immediately understand which app I
opened and encounter a coherent, readable, trustworthy welcome experience with an
obviously usable Sign in action, without unexpected account content or confusing state."

CHAT qualitative expectation: "I can ask this question once, follow a coherent response
that visibly belongs to it, understand what the app is doing at every step, and return
to the same trustworthy conversation after reload without lost or displaced work."

Use the exact version/hash-bound `edd-semantic-review` skill and named agent configuration.
Review all original temporal windows, required screenshots, safe actual output and
execution/identity evidence, then perform whole-experience synthesis. Unexpected problems
in wording, association, layout, progress, usability or neighboring state are in scope even
when no heuristic lists them. These examples are not a closed anomaly taxonomy.

The frozen protocol partitions ordered receiver events by both 80-event and 24,576-byte
limits, with up to four overlapping events; never omit an event. Each window gets a
review before final cross-phase synthesis. Maximums are 24 windows, 48 read-only tool
calls, 786,432 input bytes, 49,152 output bytes and the remaining profile limits. Every
required asset must be tool-inspected, not merely listed as reviewed. Findings cite
original `event:<id>` or `asset:<id>` evidence. Missing context, unconfirmed model/usage,
invalid citations or uninspected assets cannot return a clean result. No heuristic pass
skips this path. Inspecting evidence is not a guarantee of understanding it.

The current capture ceilings exceed this proposed review capacity. Before admission,
define and calibrate a capacity-compatible protocol or a lossless capture representation
that fits; never silently reduce capture to obtain a model pass. The selected `gpt-5.4`
profile has not been validated for runtime availability, visual/tool support, context or
semantic effectiveness. No live reviewer call or calibration has been performed.

### Remaining Admission Work

For each child case, close all algorithm/reference/capture/capacity gaps above; implement
the exact driver and heuristic rules; bind artifacts and supported variants; validate
privacy/evidence ingestion, hidden runtime, credential dispatch and budget enforcement;
and independently accept recorder, heuristic and held-out semantic calibration. Parent
family variants require their own equally detailed designs. The machine inventory remains
`NOT_READY`; these written requirements are not a substitute for completed preparation.

Calibration uses separate in-memory browser pages to test the recorder and is labelled
calibration, never real-deployment evidence. Actual runs navigate only real deployed
origins, with no fulfilled routes, Vite pages, synthetic stores or generated replies.
Calibration uses separate in-memory browser pages to test the recorder and is labelled
calibration, never real-deployment evidence. Actual runs navigate only real deployed
origins, with no fulfilled routes, Vite pages, synthetic stores or generated replies.