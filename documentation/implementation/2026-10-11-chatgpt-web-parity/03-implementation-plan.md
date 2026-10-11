# Implementation plan

Date: 2026-10-11. Status: **planning only; implementation not started**.
Requirements: [specification](02-product-and-architecture-spec.md).
Evidence and reference unknowns: [research](01-research-and-evidence.md).

## 1. Delivery rules

- Do not start product coding under this request. Review this direction first;
  a later implementation mandate selects the next dependency-ready slice.
- Extend current source seams; do not rebuild the app around REA or copy ChatGPT
  client code. REA is an optional investigation tool, not a production dependency.
- Existing safety backlog remains canonical for audited findings. `CPxx` identifiers
  here are proposed parity slices, not replacements for H/S/E entries or closure.
- Couple only actual prerequisites. A blocked connector/browser/authority path
  must not hold safe independent search, files or private editing work.
- No installs, provider calls, permissions, cloud resources, model upgrades,
  configuration mutation or deployment were performed by this planning task.
- Before expensive work: Cost Challenger plus command-bound work decision.
  Hidden execution is mandatory; blocked hidden/auth paths have no foreground fallback.
- Each evaluation flow starts `NOT_READY`; author and validate exact task variants,
  phase capture, deterministic algorithms and semantic harness before running it.

## 2. First delivery and sequencing

**First recommended product milestone:** truthful model/tool readiness plus
non-destructive conversation versions. It improves daily chat without waiting for
connectors, collaboration or cloud computers. If versioning is temporarily blocked,
deliver unified discovery or audio ingestion as the next independent useful slice.

Privacy/owner/chronology prerequisites apply to affected paths immediately. Temporary
Chat does not have to delay ordinary safe chat, but remains explicitly unavailable
until CP03 and its existing safety dependencies are qualified.

### Proposed slice DAG

| Slice | Feature IDs | Actual prerequisites | Product output | Required acceptance | Effort band |
| --- | --- | --- | --- | --- | --- |
| CP00 | All | None | Bind current source/deployment identities; perform authorized reference observations; refresh gaps and record unsupported variants | AC22, source/authority ledger | S |
| CP01 | F01,F45 | Applicable existing chat/owner/sync gates; CP00 local baseline | Preserve every-frame chronology, draft/run handoffs, cancellation and responsive behavior while extending schema | AC01,AC19,AC20 | M |
| CP02 | F02,F46 | CP00; credential/endpoint authority | Unified server capability contract; compatible reasoning/model controls; honest usage scope | AC03,AC21 | M |
| CP03 | F31,F32,F33 | Existing memory/privacy/deletion gates; CP01 for temporary runs | Real temporary lifecycle, memory controls, complete account export/delete receipts and privacy hub | AC04,AC16,AC17 | L |
| CP04 | F03,F04,F05,F06 | CP01; atomic owner-qualified message/run mutations | Prompt/answer alternatives, selected-path context, non-destructive regenerate, feedback and coherent history | AC01,AC02,AC20 | L |
| CP05 | F07 | CP00; existing owner-qualified search/data APIs | Unified chat/message/Library/image discovery; later Project/Page providers plug in | AC05,AC19 | M |
| CP06 | F08,F09,F10,F11,F12,F13,F43 | CP01,CP02; relevant Library/asset/ingestion gates | Grounded multimodal input, cited web/file answers, audio-file transcripts, dependable real chart/file output and Library reuse | AC06,AC07,AC20 | L |
| CP07 | F15,F16 | CP01; existing memory exclusion/settings authority; CP06 source reuse | Private Projects and project-only context; instructions/files/chats; later search integration | AC04,AC06 | L |
| CP08 | F20,F21,F42 | CP01,CP02; AC07 for data-derived output | Typed interactive response blocks, safe incremental findings and quiz state | AC08,AC09,AC19 | L |
| CP09 | F18,F19 | CP06 for artifacts; CP08 block persistence; existing asset ownership | Private editable document/code workspace, targeted patches, undo/history/export; isolated previews only if separately qualified | AC07,AC08,AC10 | L |
| CP10 | F22,F23 | CP02,CP06; existing durable dispatch/cancellation/budgets | Bounded Research/Work jobs with plan, progress, durable reports and actual files | AC07,AC09,AC13,AC21 | L |
| CP11 | F14,F36 | CP02; connector consent/credential design and authorized sandbox | One read-only source (SharePoint/OneDrive preferred), account selection, browse/search/preview/source links | AC06,AC11 | L |
| CP12 | F34 | CP02,CP07; skill/asset owner isolation | Private assistant profiles with instructions, knowledge/tool policies and explicit invocation; skills remain separate | AC03,AC04,AC11 | M |
| CP13 | F25,F26,F27,F28,F29,F30 | CP01,CP02; relevant source grants/media privacy; Realtime optional | Image/voice quality and device qualification; optional edit masks/camera/Realtime; explicit platform limits | AC06,AC15,AC19 | L |
| CP14 | F39 | CP10; independent task-consent/budget/schedule specification | One-shot and recurring jobs with result inbox, pause/delete/timezone/DST handling | AC13,AC14,AC21 | L |
| CP15 | F37,F38,F40 | CP11,CP14 for event tasks; exact action authority | Confirmed connector writes, safe panels, authenticated webhook triggers and independent task copies | AC08,AC11,AC12,AC14 | XL |
| CP16 | F17,F47,F48,F49 | CP07 for project sharing; CP09 for Pages; asset grant/revocation authority | Revocable chat snapshots, shared Projects/Pages, comments and Space-like work organization | AC04,AC10,AC18 | XL |
| CP17 | F24,F41,F44,F50,F51,F52 | CP10,CP15; independently approved isolated execution/publishing and ongoing budgets | Separately gated browser/ongoing work, proactive digests, partner handoffs, Sites or coding environments | AC11,AC12,AC13,AC18,AC21 | XL |
| CP18 | F35,F53,F54,F55 | Explicit separate product mandate and legal/provider/platform eligibility | Record exclusions or separately scope marketplace/vertical/native/ecosystem products | No inherited parity claim | Unbounded; no estimate |

Bands are relative scope, **not calendar commitments**: S = small bounded change;
M = several affected seams; L = new vertical workflow; XL = independent authorization,
isolation or collaboration service. Account access, actual provider capability and
observed UX are required before estimating effort/dates in working days.

CP00 reference work is iterative: only a slice's necessary reference observations
must precede its exact-parity claim. Missing RF14 access does not block independently
specified CP05. This investigation already completed CP00's initial static inventory,
not its authenticated/reference/deployment qualification.

## 3. Milestone packages

| Milestone | Deliverable | Sequencing and limits |
| --- | --- | --- |
| M1 Everyday chat trust | CP02 and the first coherent CP04 increment | Preserve CP01 invariants; split versioning into schema compatibility, selected-path reads and edit/regenerate UX. Do not bundle a runtime migration. |
| M2 Find and understand | CP05 and first useful CP06 input/output increments | Search, durable audio transcripts and source-grounded files ship independently as validated. |
| M3 Project context | CP07, project discovery integration | Private/project-only first. Collaboration and default/global context are not silently enabled. |
| M4 Interactive workspace | CP08 then CP09 | First typed charts/tables/calculator/quiz; then private revisioned editing. Pages collaboration later. |
| M5 Research and connected knowledge | CP10 then first CP11 source | Research without connector access can ship first. Read-only connected content before writes. |
| M6 Reusable assistant and media quality | CP12/CP13, independently | Do not block voice/image fixes on Research or collaboration. Native-only behavior remains unsupported. |
| M7 Scheduled productivity | CP14 then narrow CP15 | Inbox and simple schedules first; event triggers/writes only with receipts and revoked-consent tests. |
| M8 Collaboration | CP16 | Separate owner/editor/viewer data model and invitations from chat generation. |
| M9 Optional frontier | Explicitly selected CP17 subset | Choose one outcome, not the entire cloud-agent/Sites/coding platform at once. |

CP03 privacy milestones run on their own critical path; new data/context-sharing
features depend on the particular privacy subcontracts they use, not on an arbitrary
"finish all data controls first" barrier.

Promote one coherent validated user-visible slice, or after at most three completed
slices, whichever occurs first. Each release records frontend/API/config identity,
Settings > About benefits/limits and exact post-smoke deployment timestamps. A
milestone is a feedback checkpoint, not permission to stack changes over a regression.

## 4. Existing safety backlog integration

The [canonical backlog](../2026-09-10-autonomous-delivery/04-implementation-backlog.md)
and its machine-readable dependencies continue to control audited repairs.
These mappings identify relevant prerequisites; they do not declare them closed.

| Parity work | Existing slices/contracts to reconcile |
| --- | --- |
| CP01/CP04 conversation paths | S02/S04/S05/S07-S11/S33; chronology instructions and every-render tests |
| CP02 credentials/capabilities | S25-S28/S35; endpoint, account, settings and tool authority |
| CP03 privacy/memory | S01/S06/S12-S24/S29/S34/S39/S49; actual temporary capability, not containment-only |
| CP05 search/discovery | Owner-scoped data and deletion exclusions; S15 inventory lessons without conflating memory search and content search |
| CP06/CP09 files/output | S03/S27/S29-S32/S35; canonical grants, bytes, durable ingestion and provider resources; existing Library contract |
| CP07/CP12 project/assistant context | S06/S12-S14/S19/S23/S27; preserve deliberate exclusion of global project/work memory |
| CP10/CP14 jobs | S07-S10/S18/S35; durable dispatch, leases, cancellation, approval and bounded tools |
| CP13 media | S36 voice privacy; existing voice, image lineage and asset gates |
| CP11/CP15/CP16/CP17 new data boundaries | Owner/credential/privacy/worker/asset contracts plus new connector/sharing/isolation threat models; existing closure never automatically proves a new boundary |
| All promotion | Existing H/E/G gate authority, runtime/release plane and exact staged evaluation |

Current release 0.2.4 has integrated hardening evidence but explicitly does not close
the 52-finding audit or qualify authenticated product flows. Do not reinterpret
this parity program as permission to bypass that distinction.

## 5. Proposed implementation seams

| Work | Existing seams to extend | Avoid |
| --- | --- | --- |
| Capabilities | [Credential service](../../../api/src/application/credentialService.ts), [Responses](../../../api/src/ai/responses.ts), [model UI](../../../src/features/chat/ChatScreen.tsx), [tools UI](../../../src/features/chat/ToolsMenu.tsx) | Hostname-only support, silent model/price upgrades or per-render expensive probes |
| Branches | [Run contract](../../../api/src/domain/run.ts), [chat hook](../../../src/features/chat/useChat.ts), [message rendering](../../../src/features/chat/Message.tsx), existing stores/order/handoffs | Role sorting, timestamp hacks, deleting old answers or appending every branch response at the bottom |
| Search/files | [Search](../../../src/features/history/SearchView.tsx), [Library](../../../src/features/library/LibraryView.tsx), [run worker](../../../api/src/application/runWorker.ts) | Duplicate Library lifecycle, global unqualified search or a premature vector platform |
| Projects | Existing application/port/adapters and [memory exclusions](../../../api/src/domain/memoryExtraction.ts) | A parallel browser generation loop or automatic global memory capture |
| Blocks/editor | [Message](../../../src/features/chat/Message.tsx), [frontend types](../../../src/lib/types.ts), [Responses events](../../../api/src/ai/responses.ts), artifact/Library contracts | Arbitrary HTML in app origin, stale full-document replacement or invisible invalid-block fallback |
| Work/tasks | [Orchestrator](../../../api/src/ai/orchestrator.ts), [queue worker](../../../api/src/functions/runWorker.ts), dispatch/cancellation/sync ports | Reusing engineering-agent authority for product autonomy; unbounded retry or fictional queue atomicity |
| Connectors/collaboration | Existing credential-wrapper, owner authorization, canonical assets and SignalR projections | Frontend tokens, inherited third-party permissions, shared account keys or consent by model instruction |
| Media | [Voice](../../../src/features/voice/VoiceMode.tsx), [composer](../../../src/features/chat/Composer.tsx), [Image Studio](../../../src/features/images/components/Composer.tsx) | Forking text/voice memory pipelines or promising background/native behaviors without device evidence |

Before each edit, trace the actual controlling code and neighboring tests; this
planning-level survey does not replace implementation analysis.

## 6. Validation program

### V0 Static admission

Bind source/deployment/config/capability records and affected requirements. Review
request/schema/owner/privacy/migration contracts and the relevant existing tests.
No provider/browser suite to diagnose a basic unsupported parameter or missing grant.

### V1 Focused local deterministic checks

Use current test runners and relevant files only. Add fixtures for branch exclusion,
stale revision, source revocation, duplicate queue occurrence, malformed response
block and timezone behavior. Typecheck touched frontend/API surfaces.

Chronology tests observe **every committed render and meaningful DOM/frame** through
optimistic submit, pending writes, stale reload, first/growing response, timestamp
handoff, completion and background reconciliation. Include delayed/out-of-order
reads and failing negative controls. A final-state test cannot substitute.

### V2 Exact-flow EDD preparation

For each affected RF/task variant author executable:

- starting fixtures, actions, permitted effects, phases and recovery;
- capture regions/identities/timeline/paint/privacy/resource ceilings;
- every deterministic heuristic algorithm and pass/fail/insufficient rule;
- mandatory open-ended semantic reviewer with explicitly preloaded
  `edd-semantic-review` skill, pinned identity, evidence access, complete windows
  and cross-phase synthesis;
- independent calibration, exact source/runtime hashes and execution authority.

Existing generic templates, a skill file or cost permit do not make a flow ready.
No browser/provider eval loop starts while any field or calibration is missing.
This planning request does not execute semantic evaluation.

### V3 Single provider/stage canary

After V0-V2, separately approve one discriminating exact-deployment request or
workflow. Record actual model/version/tool support, response/output, usage,
latency and errors. Failure preserves evidence and changes approach; do not
increase timeout/budget or rerun the unchanged denominator.

### V4 Focused browser and multi-device validation

Run only prepared affected desktop/mobile/keyboard/reload/reconnect variants.
Use synthetic accounts/material. Include actual outputs, permission revocation,
failure/cancel branches and storage/provider receipts. Semantic review examines
the original full timeline/assets for unexpected anomalies and cannot waive
deterministic privacy/chronology failures.

### V5 Full applicable qualification and release

Only after preceding gates pass, use the required full applicable matrix. Reuse
qualification until source/runtime/contract/relevant behavior changes. Validate
physical-device voice/camera/keyboard limitations before claims requiring them.
Public-shell/health checks are supplementary, not authenticated workflow proof.

## 7. Migration and rollout

1. Capture immutable frontend/API/config predecessor and compatibility contract.
2. Add server schemas and readers first, flag off; old clients continue to work.
3. Backfill only necessary version/project/source metadata with idempotent progress
   and owner/deletion checks. Never rewrite chronology timestamps for display.
4. Deploy compatible backend before frontend consumers. Enable one account/canary
   capability, then expand only on admitted workflow evidence.
5. Old schema support stays until active clients and exports are compatible.
6. Roll back **code only** to retained identities on failed smoke/regression.
   Revocation, deletion, forget, consent and purge ledgers never roll backward.

For future isolated services: separate origin/identity/storage/queue, bounded
filesystem/network, expiry and teardown; model output cannot select host commands
or self-grant capabilities. Retain exact artifacts and rollback procedures before
any remote mutation.

## 8. Risks, dependencies and decisions

| Risk / unknown | Consequence | Next discriminating step |
| --- | --- | --- |
| No authenticated reference captures | Exact UI/branch/Canvas/Research details unverified | Authorized RF task observation; use original Watai designs meanwhile |
| Blocked official pages / incomplete entitlements | Cannot assert all latest features or exact plan limits | Recheck only with a changed approved access path; date claims and retain U status |
| Actual Azure deployments/quotas unknown | Newer model/tool may be unavailable or costly | Read-only inventory, then one separately budgeted canary |
| Hostname-derived capabilities | False available tools or inappropriate parameters | CP02 server evidence contract before broad enablement |
| Destructive regeneration | Lost alternatives and invalid context/history parity | CP04 server version model and race tests |
| Temporary/retention incomplete | False privacy promises | CP03 plus existing S49; keep feature unavailable until qualified |
| Project context enters global memory | Cross-project disclosure | CP07 bidirectional policy and delayed-worker canaries |
| Generated code/plugin panels | Token exfiltration or unsafe execution | Typed renderer first; isolated preview/panel service later |
| Connector writes/browser autonomy | Consequential or duplicated actions | Exact approvals, idempotency/outcome receipts and independent authority |
| Schedule/runtime cold starts | Delayed work, duplicate execution, cost | Occurrence identity and bounded missed-run/capacity model; no blanket always-ready expansion |
| Concurrent document/shared edits | Lost human work or permission race | Revision-aware patches and authoritative role/grant reads |
| Frontier scope explosion | No near-term user benefit | Ship M1-M5 first; select one optional CP17 result at a time |
| Production/source runtime drift | Incompatible release artifact | Separate Node runtime milestone with exact artifact tests |

Proposed defaults: Azure backend retained; Pages frontend retained; private Projects
project-only; connectors read-only first; interactive blocks over arbitrary code;
standard voice retained while Realtime is optional; in-app task inbox first;
original Watai design; frontier/ecosystem features explicitly deferred.

Decisions requiring a separate mandate: public marketplace, regulated verticals,
third-party checkout/reservation mutation, cross-tenant organization administration,
public Sites hosting, cloud coding environments and sustained autonomous agents.
None is necessary for the first useful ChatGPT-web-like upgrade.

## 9. Definition of planning completion and implementation completion

**This planning task:** dated reference/source ledger, categorized matrix, target
contracts/acceptance, prerequisite-ordered slices, safety/EDD/release integration
and honest unknowns, with no product code changed.

**A later implementation mandate:** all selected in-scope feature rows are deployed
and workflow-qualified on the exact frontend/API/config identity, with real user
outcomes, required deterministic plus semantic evidence, accessible controls and
published limits/rollback. Unsupported rows remain explicit; documentation or a
disabled feature is not implementation completion.
