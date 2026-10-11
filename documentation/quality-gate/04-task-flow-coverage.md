# Task-Flow Coverage

Status: DESIGN seed catalog, NOT a completed inventory or coverage claim.
Version: 0.4. Date: 2026-09-12. Every flow below is `UNVERIFIED` and `NOT_READY`.

## Coverage Contract

| ID | Requirement |
| --- | --- |
| FLOW-01 | Derive expectations from user goals and product requirements before selectors or implementation. |
| FLOW-02 | Enumerate every exposed action, promised capability and required recovery/variant case. |
| FLOW-03 | Give every step an observable expected state and every result a delivery contract. |
| FLOW-04 | Keep discovery, implementation, execution, evidence sufficiency and qualification separate. |
| FLOW-05 | Missing, disabled, blocked, skipped or unimplemented required cases do not count as passing coverage. |

The table is a seed denominator of 60 flow IDs, assembled from existing specifications
and discussions. It is not live-screen discovery. Split a row when discovery shows
independently testable user goals; assign child case IDs rather than conceal several
outcomes behind one successful click. Preserve stable IDs and record additions/removals
with their requirement rationale before locking a release coverage version.

The [machine-readable preparation catalog](../../tests/e2e/deployed/preparation/catalog.json)
has one explicit record for each of these 60 flows, with flow-specific unresolved design
work. Offline preflight derives a status and missing preparation path for every row.
There are currently zero complete approved packs. This inventory records work still to
do; it is not 60 authored task/capture/heuristic designs, nor may it be presented as such.

Each flow requires the complete [admission contract](05-evaluation-and-design-system.md)
before its eval loop starts: fully articulated task and variants, detailed capture plan,
complete deterministic heuristic algorithms, and a skill-configured validated open-ended
semantic agent. Missing details block admission, not only final qualification.

Source families:

- Product: [01-product-spec.md](../01-product-spec.md), [server-run migration](../06-server-runs-and-migration.md).
- UI: [design specification](../ui-design/README.md), [chat](../ui-design/04-screens-chat.md),
  [platform and responsive behavior](../ui-design/09-responsive-and-platform.md).
- Library/tools: [Library](../library-implementation-spec.md), [artifacts](../agent-artifacts-spec.md),
  [skills](../skills-system-spec.md), [web content](../web-rich-content-spec.md).
- Images/voice/memory: [images](../image-studio-spec.md), [voice](../voice-implementation-plan.md),
  [memory](../memory-system/README.md).
- Safety and closure: [DoD](../implementation/2026-09-10-autonomous-delivery/02-definition-of-done.md),
  [backlog](../implementation/2026-09-10-autonomous-delivery/contracts/backlog.json).

Source documents contain historical and proposed behavior. Reconcile conflicts against
current user intent and the observed deployment; do not turn legacy documentation into
proof of a shipped capability or derive expected correctness from a bug in current code.

## Seed Catalog

### Access and Startup

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| AUTH-01 | Open the real app from a cold start | Actual shell reaches honest sign-in/ready/error state with working assets. |
| AUTH-02 | Create and verify an invited test identity | Real identity and invitation flow grants only intended access. |
| AUTH-03 | Receive a clear denial without an invitation | No protected content or privileged operation becomes available. |
| AUTH-04 | Sign in and return from the real identity redirect | Correct account and route load without a redirect loop or stale identity. |
| AUTH-05 | Sign out | Account content and pending callbacks cannot appear in a subsequent account. |
| AUTH-06 | Recover from session expiry | Reauthentication is honest; no lost draft or silent access bypass. |
| AUTH-07 | Use separate accounts in isolated sessions | Account A data/grants never appear for account B, including collisions. |
| AUTH-08 | Recover from failed startup | Retry works without a late abandoned setup changing the active state. |

### Chat

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| CHAT-01 | Submit a first prompt | Durable acceptance, persistent prompt and a correctly associated reply. |
| CHAT-02 | Ask a follow-up | Answer uses the intended thread context and does not import another thread. |
| CHAT-03 | Read a streaming reply | Content/progress/order remain coherent throughout, not just at completion. |
| CHAT-04 | Stop generation | Stop is reflected honestly; no stale work replaces a subsequent reply. |
| CHAT-05 | Regenerate a response where supported | Correct prompt association, version behavior and stable history. |
| CHAT-06 | Recover a failed submission | Draft/attachments remain recoverable; no false acceptance or duplicate turn. |
| CHAT-07 | Leave and reopen an active conversation | Server work and visible state reconcile without response loss or jumping. |
| CHAT-08 | Reconnect after genuine network interruption | Prompt/reply ordering and deduplication survive delayed real responses. |
| CHAT-09 | Return to a long-open/background tab | Auth/realtime recovery and pending work remain coherent. |
| CHAT-10 | Continue from another session on the same account | Cross-session updates preserve each prompt/reply and local reading position. |
| CHAT-11 | Read rich formatted responses | Markdown/code/math/tables/links are accurate, readable and unclipped. |
| CHAT-12 | Copy a reply | Actual clipboard/download surface, when supported, contains the expected content. |

### History and Navigation

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| HIST-01 | Browse and load older conversation history | No missing/duplicate history; bounded loading and preserved anchors. |
| HIST-02 | Search and open the matched message | Exact intended result is reached, visible and highlighted appropriately. |
| HIST-03 | Rename a conversation | Name persists across reload without losing concurrent metadata. |
| HIST-04 | Pin/unpin a conversation | Ordering and persisted pin state agree across sessions. |
| HIST-05 | Archive/unarchive a conversation | Visibility matches the selected state and remains recoverable. |
| HIST-06 | Delete a conversation | Disclosed deletion behavior holds; late work cannot recreate it. |
| HIST-07 | Use deep links, back and forward | Correct route/modal stack and draft/scroll restoration. |

### Attachments and Tools

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| TOOL-01 | Attach an image to a prompt | Real upload, preview, correct attachment and inspectable response. |
| TOOL-02 | Attach a document | Valid upload/index progress and honest byte/format failures. |
| TOOL-03 | Ask a question grounded in an attached document | Answer and source evidence match the actual document contents. |
| TOOL-04 | Request web-grounded information | Actual lookup, inspectable sources and claims supported by those sources. |
| TOOL-05 | Obtain a generated file/code artifact | Real generated artifact is delivered, opens and has correct contents. |
| TOOL-06 | Select and use a skill | Intended enabled skill affects the real operation; unsupported skills fail honestly. |

### Images

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| IMG-01 | Generate an image | Actual provider output visibly matches the requested subject and constraints. |
| IMG-02 | Edit an image | Intended input is used and the requested edit is inspectable. |
| IMG-03 | Inspect and download an image | Viewer framing, decode, dimensions and downloaded content are correct. |
| IMG-04 | Cancel/delete image work | No ready state or new reference revives an observed deleted item. |

### Library

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| LIB-01 | Browse/filter/search the Library | Correct records for each state, with no stale-filter intermediate render. |
| LIB-02 | Open supported item previews | Real bytes render in an appropriate readable/operable viewer. |
| LIB-03 | Upload and complete a Library item | Actual object and metadata agree; retries never overwrite another item. |
| LIB-04 | Reuse a Library item in chat | Same authorized artifact reaches the intended prompt with clear provenance. |
| LIB-05 | Rename/star/organize an item | Each discovered action receives a child case; concurrent edits remain intact. |
| LIB-06 | Trash/restore/purge an item | Each transition has its own case, disclosed retention and no stale resurrection. |

### Memory and Privacy

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| MEM-01 | Choose memory off or Saved-only | Persisted permission, subsequent recall and UI labels agree. |
| MEM-02 | Explicitly choose or stop learning | New learning follows current permission; late work cannot bypass revocation. |
| MEM-03 | Save/correct a memory | Exact approved text persists, failed drafts survive, later replies use the correction. |
| MEM-04 | Inspect structured and raw memory evidence | Eligibility, provenance, subjects, dates and labels are honest and consistent. |
| MEM-05 | Forget/restore eligible memory | Forget prevents future use; restore respects exclusions and disclosed validity rules. |
| MEM-06 | Export/preview a memory archive where supported | Actual file preserves promised metadata; preview never claims unsupported restore. |
| MEM-07 | Inspect memory used or skipped for a reply | Disclosure matches actual supplied context and any degraded recall outcome. |

### Settings, Voice and Administration

| Flow ID | User can | Primary observable outcome |
| --- | --- | --- |
| SET-01 | Configure/test/remove model credentials | Real capability probes, protected secrets and persisted removal semantics. |
| SET-02 | Change appearance and personalization | Theme/text/instructions persist; late saves cannot repaint newer choices. |
| SET-03 | Use data export/clear controls | Actual output and deletion scope match the claim, including retained server data. |
| SET-04 | Inspect version, release notes and limits | Information identifies the actually serving frontend/API combination. |
| VOICE-01 | Dictate into the composer | Real audio is transcribed appropriately; draft and language behavior are correct. |
| VOICE-02 | Hold a voice conversation | Real input/output, turn-taking and displayed transcript agree. |
| VOICE-03 | Play/stop spoken responses | Intended audio plays/stops with correct state and accessible controls. |
| VOICE-04 | Mute/deny permission/leave voice mode | Capture stops; late callbacks do not publish unwanted audio or text. |
| ADMIN-01 | Perform only authorized administration | Real role checks permit the dedicated authorized case and deny ordinary accounts. |
| PLATFORM-01 | Use promised offline/install/device behavior | Separate child cases prove supported PWA, offline, native-share and hardware claims. |

## Required Variants

For every row, document applicability and child case IDs for:

- Clean/new account, existing account/data, cold load, reload and direct navigation.
- Empty, loading, ready, running, completed, failed, cancelled, blocked and retry states.
- Keyboard/pointer/touch workflows; desktop/narrow/mobile viewports and text zoom/reflow.
- Light/dark themes, reduced motion, production fonts/icons and relevant content extremes.
- Real slow network, offline/reconnect, background/foreground and out-of-order completion.
- Rapid repeated actions, navigation/unmount, two tabs/sessions, owner switch and deletion.
- Server failure/unavailable provider, denied permissions and insufficient configuration.
- Persistence, artifact inspection and subsequent use; cleanup and reversibility where promised.

Use actual browser network conditions or authorized real dependency failure modes, not
fulfilled fake responses. An unsafe/unavailable failure mode is blocked coverage; it is
not simulated and then relabelled as deployed evidence. Destructive tests use only owned
test data. Hardware-only scenarios require genuine hardware evidence.

The full Cartesian product is not an implicit promise. Define mandatory risk combinations
before execution, and use justified combinatorial reduction for independent lower-risk
axes. Chronology/privacy/owner/worker races retain their mandatory combinations. A case
omission needs a product applicability decision, not a post-failure test skip.

## Flow Card Template

Each executable case must supply: stable ID/version; source expectation; user goal;
initial account/data/config; real actions; expected intermediate UI and operational
outcomes; output-delivery contract; qualitative semantic expectation and review protocol; temporal invariants; DS/accessibility
rules; timing and cost ceilings; evidence/capability requirements; cleanup; environment
matrix; and owner/reviewer. Include expected errors, not just the happy path.

Track separately: `discovered`, `expectation-defined`, `capture-designed`,
`capture-design-reviewed`, `driver-implemented`, `executed`,
`evidence-sufficient`, `deterministic-pass`, `semantic-reviewed`, `qualified`. A single
boolean such as `covered` obscures failures and must not be the release denominator.

The runtime's structural validator checks fields, phase/step/outcome coverage, identities,
source hashes and attestation bindings. It cannot decide whether generic prose describes
a complete algorithm. The independent design review must reject missing branches, vague
oracles, unsupported selectors, incomplete capture and inadequate semantic context. Until
that review is authenticated and the required calibration is available, readiness stays false.

## Per-Flow Capture Design Template

Before capture design, split each flow into independently judgeable claims. For each
claim record the step/branch, expected outcome, unacceptable counterexample, observation
source, required fields/resolution/interval, decision rule, deadline and uncertainty
behavior. Every required claim needs a mapping; every expensive captured field needs
a claim, diagnostic dependency or explicitly justified sentinel purpose.

Do not reduce capture to values a detector expects. A chronology claim requires actual
node/domain identities, positions and changes even when they are wrong; a response-status
field cannot replace order evidence. Validate abstraction with known counterexamples so
the selected representation distinguishes good from bad.

Every flow needs its own explicit capture design, including its applicable variants.
Record it alongside the flow card with a stable ID, version and content digest. Reusing
shared profiles is allowed only through explicit bindings; "use the generic DOM recorder"
does not satisfy this requirement. None of the seed rows is capture-designed merely
because the shared architecture exists.

| Required design field | What must be decided before execution |
| --- | --- |
| Expectations and phases | Step IDs, branches, start/end conditions, pending/error/retry/cancel/reload variants and the outcome each phase must make judgeable |
| Region map | Exact semantic roots, selector/identity rules, dynamic-instance binding and required ancestors/siblings/scroll containers |
| Resolution by phase | Detailed/context/abstract assignment for every region; retained node/content/state/geometry fields and abstract subtree summaries |
| Temporal capture | Timestamp/sequence semantics, mutation types, frame sampling, event triggers, checkpoints and required paint evidence in each phase |
| Resolution transitions | Named trigger, source/destination phase, required checkpoint and guards; promote before the relevant action, not after detecting a failure |
| Observation traceability | For every expectation, required channels/fields and sufficient evidence of both correct and incorrect outcomes |
| Exclusions | Omitted descendants/payloads, privacy policy, rationale and retained dependency effects |
| Unexpected-state policy | Fixed sentinel coverage, bounded diagnostic fallback and exact conditions requiring insufficient-evidence/replan |
| Resource and lifecycle limits | Time/bytes/overhead budgets, overflow handling, cleanup, observer continuity and unsupported browser capabilities |
| Design validation | Selector/capability validation, critical-detail and abstraction counterexamples, reviewer and locked run bindings |

Preflight checks that each planned action, expected asynchronous transition and required
variant has a matching capture phase. Missing mappings block qualification before user
actions or model work. A changed app surface invalidates its unresolved selector/identity
bindings; runtime code must not silently choose a weaker selector or omit the surface.

Required branches have coverage obligations, not merely `if present` assertions. If the
case tests pending persistence, cancellation or reconnect, record evidence that this
condition occurred. A fast run that never entered the branch does not cover it. Real
fault timing that cannot be exercised safely stays unqualified; do not fake its response
or infer coverage from a test name. The per-flow design must include observer topology,
action-wait coverage, wrong-state phases and test-state lineage, not only the happy path.

Per-flow design determines what is observed, not the verdict. Within that declared scope,
capture remains agenda-free and preserves unexpected values and transitions. When an
unplanned event exposes a design omission, retain the discovery, amend the design and
run a new qualifying attempt. Never reinterpret the old evidence as though additional
fields or earlier detail had been captured.

## First Detailed Card: CHAT-01/03/08/10

User goal: ask a question, follow the answer and retain a trustworthy conversation.
Input: an approved non-sensitive prompt with an explicit semantic answer rubric.
Prerequisites: real invited account, real provider configuration and actual deployment
identities; one fresh browser context and a second session when the variant requires it.

This is an expectation/evidence outline, not an executable capture design. Before any
qualifying run, each constituent flow and variant needs the region/field/phase mappings,
transition guards and reviewed selector contracts specified above.

| Step | Action or real event | Required observable outcome | Evidence |
| --- | --- | --- | --- |
| 1 | Open conversation and focus composer | Correct account/thread, readable history and operable composer | Baseline state, screenshot, focus/hit evidence |
| 2 | Type prompt and submit normally | Feedback and draft policy match acceptance; prompt is not lost | Action pair, text/DOM deltas, real request correlation |
| 3 | Admission remains pending | Prompt persists; no reply appears above it | Frame/order/visibility timeline, request timing |
| 4 | First response and streaming | Reply belongs to this prompt, text grows coherently, no unrelated push replaces it | Logical IDs, DOM/geometry frames, permitted real events |
| 5 | Scroll into older history | New content does not pull the reader away | Scroll/anchor geometry, screenshots |
| 6 | Genuine reconnect or second-session update | Reconciliation preserves prompt/reply association and peer order | Both session timelines, uncertainty-aware correlation |
| 7 | Response completes | No disappearing handoff; no false spinner/success; answer meets rubric | Final artifact/content, state and semantic review |
| 8 | Reload and inspect in second session | Same meaningful answer/order without duplicates | Fresh observations, actual persisted read responses |

Explicit detectors: `DET-CHRONO-01`, `DET-CHRONO-02`, `DET-STATE-01`, `DET-OUTPUT-01`,
`DET-DS-01`, `DET-SEMANTIC-01` from the evaluation specification. A request callback or
server `complete` status is not a substitute for any row's visible outcome.

## Closing the Denominator

Walk every live navigation path and exposed control under each authorized role; compare
with these sources and register discrepancies. Planned but absent features are tracked
as missing capability, not invented in the test app. Publish the full matrix with gaps
before building the full suite. Lock the agreed case list for a candidate; count only
cases with sufficient exact-candidate evidence and all required judgments passing.

The claim permitted at completion is "100% of required cases in coverage version X
qualified on environment matrix Y," never "all possible states proven correct."

Publish numerator and denominator separately for discovered flows, reviewed capture
designs, required branches, executed cases, sufficient evidence and fully qualified cases.
No blended score: ten happy paths cannot compensate for a missing privacy or chronology
variant. Deliberately disabled capabilities still need required denial/no-side-effect
checks under the DoD; absent promised capabilities remain product gaps.