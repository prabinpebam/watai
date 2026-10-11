# Product and architecture specification

Version: 0.1. Date: 2026-10-11. Status: **PROPOSED; not implemented or qualified**.
Evidence IDs refer to the [research ledger](01-research-and-evidence.md).

## 1. Product boundary

Target **functional and experiential closeness**, not a ChatGPT clone. Preserve Watai
identity, account isolation, user Azure configuration, original visual assets and
server-authoritative generation. Modernize desktop/web workflows while retaining
mobile/PWA behavior, accessibility, drafts, chronology and offline read limits.

Three parity classes:

- **Native Watai equivalent:** achievable with application code and existing stores.
- **Azure/provider-dependent equivalent:** requires verified deployment/tool capacity.
- **Adjacent/proprietary service:** optional separately scoped product or explicitly
  unsupported; not obtainable by changing an Azure model name.

Do not promise OpenAI's subscription allowances, exact answers, search ranking,
voice identity, system prompts, marketplace, identity federation or private APIs.

## 2. Capability gap matrix

Baseline: `P` source-present, `L` partial foundation, `N` not established in survey,
`D` explicitly unavailable. None means authenticated production parity.
Feasibility: `A` app-native, `B` Azure/integration dependent, `C` major isolated
service/optional extension, `X` outside web parity or proprietary ecosystem.
Priority: `P0` trust prerequisite, `P1` core parity, `P2` expanded productivity,
`P3` frontier/optional. `U` means exact current reference details remain unknown.

Every row has a proposed delivered outcome. Slices in the plan bind rows to work;
source codes are not feature-completion claims.

| ID | Capability / proposed Watai outcome | Reference | Watai evidence / gap | Class | Priority |
| --- | --- | --- | --- | --- | --- |
| F01 | Reliable streaming, stop, reload and closed-client completion | R01 Oct 7; RF01 | P W03/W13/W19/W21; preserve and qualify every intermediate state | A | P0 |
| F02 | Truthful model picker, explicit reasoning choice and compatible parameters | R01 Sep 14/Oct 7; R03/R04 | L W02/W14/W17; deployment/tool proofs and per-model effort absent | B | P0 |
| F03 | Prompt editing with preserved alternatives and selected-path context | U; RF02 | N W03/W12; no established edit/version UX | A | P1 |
| F04 | Non-destructive answer regeneration and branch navigation | U; RF02 | L W03; destructive trailing-message removal differs from target | A | P1 |
| F05 | Copy/code-copy/read-aloud plus useful feedback/report controls | U; RF01 | L W04; first actions present, feedback/report not established | A | P1 |
| F06 | Rename/pin/archive/delete and browser deep links | U; RF03 | P W01/W05; qualify archive/deletion/selection consistency | A | P1 |
| F07 | Unified search across chats, messages, files, images and projects | R01 Jul 14 | L W06/W07; separate conversation/Library queries | A | P1 |
| F08 | Recoverable composer with attachment chips, drag/paste, dictation and skill/tool entry | R01 Aug 14; U exact menus | P/L W25/W26; modernize without draft/caret regression | A | P1 |
| F09 | Image understanding and referenced multi-turn image context | R04; U exact ChatGPT UI | L W12/W15/W18; per-deployment vision proof required | B | P1 |
| F10 | PDF/document questions with inspectable file citations | R02; R01 connected Library | L W03/W15/W18; ingestion/readiness/lifecycle qualification | B | P1 |
| F11 | Data analysis with real charts and downloadable files | R01 Jul 9/Sep 3 | L W04/W16/W18; verify execution/output, add structured chart presentation | B | P1 |
| F12 | Audio-file transcript, summary and source-grounded questions | R01 Oct 6 | L W09/W12/W15; audio kind/STT exist, general ingestion not established | B | P1 |
| F13 | Account Library reuse, provenance, missing-file and lifecycle semantics | R01 Aug 13/Sep 10; historical Library spec | P/L W07/W18; reuse existing approved Library contract | A | P1 |
| F14 | Connected-file browsing, folder selection, source links and side previews | R01 Aug 13/Sep 10 | N W07; add consented read-only source references | B | P2 |
| F15 | Private Projects with files, instructions and grouped conversations | R02 | N W01/W12/W13; scope/context entities needed | A | P1 |
| F16 | Project-only memory with bidirectional isolation and editable policy | R01 Aug 14 | N W24; global work-context exclusion must be preserved | A | P0 |
| F17 | Project roles, invitations and shared context | R02 | N W01/W13; collaborative authorization not established | C | P2 |
| F18 | Editable document/code workspace, selections, revisions and undo | U Canvas; R01 Pages | L artifact output W04/W12; editor/history absent | A | P2 |
| F19 | Safe preview of generated code/interactive documents | R01 Sep 29/Oct 7; U exact Canvas | L W04/W15; arbitrary generated HTML must not run in app origin | C | P2 |
| F20 | Typed mixed text/chart/table/diagram/calculator/quiz response blocks | R01 Oct 7 | L W04/W15; Markdown/artifacts only in inspected contract | A | P1 |
| F21 | Incremental answers with later findings while tools continue | R01 Oct 7 | L W15/W16/W18; preserve truthful required-tool gating and revisions | A | P1 |
| F22 | Explicit bounded Research workflow with scoped sources and cited report | R01 Jul 9; U standalone Research UI | L W16/W18; old Research spec is intent, not shipped job | B | P2 |
| F23 | Bounded Work workflow producing verified document/sheet/presentation outputs | R01 Jul 9/Sep 3 | L W11/W16/W18; needs typed jobs, progress and output verification | B | P2 |
| F24 | Browser/computer actions with isolated session and approval pauses | R01 Aug 25; R03 preview | N W15/W16; model support does not provide a safe cloud computer | C | P3 |
| F25 | Image generation/remix with durable history and source references | R01 sticker packs; R04 | P/L W08/W18/W21; provider quality/capacity and outcome tests | B | P1 |
| F26 | Localized image edits/masks and optional partial-image progress | R03 limitation; U exact reference editor | L W08; dedicated edit capability proof; no Responses parity promise | B | P2 |
| F27 | Camera/image capture where browser permissions allow | U web interaction; R04 vision category | L W25; validate devices, permissions and secure cleanup | B | P2 |
| F28 | Dictation, captions, speaker selection, mute/exit and interruptible speech | R01 voice updates | P/L W09/W25; standard STT/chat/TTS foundation | B | P1 |
| F29 | Native low-latency speech-to-speech session where Azure supports it | R04 audio; U reference transport | N W09; need session/auth/tool/transcript design | B | P2 |
| F30 | Voice screen/camera sharing and background conversation | R01 native updates; U web scope | N; browser/platform constraints; native lock-screen equivalence excluded | C | P3 |
| F31 | Custom instructions and manageable saved memory | U account memory; Watai existing contract | P/L W10/W24; qualify use/learning/forget/export independently | A | P0 |
| F32 | Temporary Chat with actual isolation, expiry and accurate provider notice | U reference retention; RF13 | D W10; server/provider lifecycle not complete | B | P0 |
| F33 | Full account export, deletion status and privacy/security center | R01 Sep 21; U exact export policy | L W10/W21; current export is explicitly local and partial | A | P0 |
| F34 | Private custom assistant profiles: instructions/files/tools plus invocation | U GPT builder | L W11; skills are not assistants; introduce distinct profiles | A | P2 |
| F35 | Public assistant marketplace/discovery/monetization | U GPT store | N; own marketplace optional, no OpenAI store access | X | P3 |
| F36 | Connected app catalog, scoped OAuth grants and multiple account selection | R01 Sep 17 | N W14; vault model/Tavily credentials are not connector grants | B | P2 |
| F37 | Read/write app tools with explicit permissions, receipts and revocation | R01 Aug 25/Sep plugin updates | L W16 confirmation hook; need enforced action protocol | C | P2 |
| F38 | Safe interactive plugin panels/viewers and contextual mentions | R01 Sep plugin extensions | L W25 slash skills; no established app-panel host | C | P2 |
| F39 | One-shot/recurring tasks with durable results and notification inbox | R01 Aug 25 | L W19 queued runs; scheduling/notifications not established | A | P2 |
| F40 | App-event tasks, deduplication and shareable independent task copies | R01 Aug 25/Sep events | N; authenticated event ingress and copied consent needed | B | P3 |
| F41 | Opt-in proactive daily/ongoing digest from authorized context | U Pulse specifics; R01 dots/suggestions | L W24; no inferred background permission | B | P3 |
| F42 | Study-oriented help and persistent interactive quiz sessions | R01 Aug 14; R12 limited | L W04; typed learning state/answer feedback absent | A | P2 |
| F43 | Live web search with genuine source disclosure and follow-up grounding | R01 Work; U exact search UI | P/L W15/W18/W26; Tavily-supported, no OpenAI ranking equivalence | B | P1 |
| F44 | Shopping/travel/reservation comparison cards and handoff links | R01 Aug 10 reservations; U broader shopping | L web-search foundation; provider partnerships/checkout not implied | B | P3 |
| F45 | Accessible responsive shell, shortcuts and honest offline limits | R01 app updates; Watai product baseline | P/L W01/W25; verify WCAG/keyboard/real devices, preserve original DS | A | P0 |
| F46 | Usage/budget/capability status and clear configuration repair | R01 entitlement caveats; R03/R04 | L W13/W14/W21; agent-only token observations aren't full billing | A | P0 |
| F47 | Revocable chat snapshot share links with explicit asset visibility | U chat-share behavior; RF12 | N W05; project invitations do not establish public chat sharing | A | P2 |
| F48 | Collaborative Pages: revisions, comments and selected shared context | R01 Sep 29 | N W01; depends on editor and real authorization | C | P2 |
| F49 | Space-like workspace for Pages/files/work, distinct from Projects | R01 Sep 29 | L Library foundation; do not collapse different context boundaries | A | P2 |
| F50 | Sites: preview, publish/unpublish, guest access and optional schedules | R01 Sep 3/Sep 29 | N; isolated publishing origin, ownership and revocation required | C | P3 |
| F51 | Ongoing agent goals with autonomy scope, cloud state and review inbox | R01 Sep 29 dots | L queued-run foundation; sustained agent service absent | C | P3 |
| F52 | Coding tasks with isolated repository environments and finished artifacts | R01 Sep 29 Codex Cloud | N; separate optional product, not browser chat or engineering harness reuse | C | P3 |
| F53 | Health/Finances specialized sources, permissions and dashboards | R01 Jul 16/Sep 21 | N; regulated/partner/region-sensitive optional verticals | X | P3 |
| F54 | Native/adjacent features: desktop history, lock-screen voice, meetings, Office add-ins | R01 Jul-Sep | N; PWA cannot promise desktop/OS integration parity | X | P3 |
| F55 | OpenAI sign-in, plan-allowance sharing, shareable ecosystem profiles | R01 Jul/Sep | N; keep Entra identity and Watai budgets, no imported subscription rights | X | P3 |

`X` rows remain visible exclusions/optional product decisions, not silently removed
from the comparison. `U` rows need reference verification before an exact-match claim;
their proposed Watai outcomes can still be designed from user needs.

## 3. Core UX requirements

### 3.1 Shell and capability discovery

Keep Chat as default; use progressive navigation for Search, Library, Projects,
Work, Images and Tasks. Pages/Space appear only when a coherent workflow exists.
Retain current URL/deep-link conventions, responsive sidebar and mobile docked
composer. New surfaces return users to their exact prior thread/scroll position.

Use understandable capabilities, not ChatGPT plan names. A selectable model is a
configured deployment whose supported request parameters are known. Reasoning
choice is explicit, model-specific and distinct from semantic tool routing.
Show actual resolved model when reported, otherwise "not reported."

Unavailable controls explain **why** and how to repair configuration. Unknown is
neither available nor absent. Do not infer code/file/vision support solely from
hostname, model marketing or a configured string.

### 3.2 Conversation versions

Editing/regeneration creates a new version or branch, never destroys prior
assistant content as the normal operation. Preserve original attachments,
citations, artifacts and parent relationships. Selected branch determines model
context and visible history; sibling answers must never bleed into context.

A submission binds branch/version/revision atomically on the server. Concurrent
devices cannot silently move a run to another selected path. Late streamed events
belong to their original run/branch. Existing idempotent submission and logical
chronology remain controlling; regeneration identity must represent a new attempt
without duplicating the original prompt.

### 3.3 Unified discovery and files

One search entry with object-type filters and result-specific deep links. Search
metadata/content only where the user has access; tombstoned/forgotten objects are
ineligible. Label cached/partial results honestly. Do not introduce a vector search
dependency solely to search titles and text.

Reuse the existing Library lifecycle, provenance and grants. Audio ingestion
creates a durable transcript linked to its source and disclosed transcription
uncertainty. A recording-file upload is not equivalent to dictation or merely an
`audio` attachment chip. Document questions wait for actual readable/indexed state.
Generated charts/files need real inspectable output, not claims in prose.

### 3.4 Projects

A private Project groups chats, instructions and approved source references. Context
precedence: mandatory safety/system policy -> selected assistant/project instructions
-> user settings -> selected branch -> authorized sources. Conflicts are surfaced,
not silently merged into an unexpected instruction.

Project-only excludes global and other-project memory/history **in both directions**.
Explicitly decide whether a project's default mode can use global saved memories;
default the first Watai release to project-only. No automatic global learning of
project files or work context. Changing policy revokes future context use at the
server admission/read boundary; disclosure reports Watai's actual timing.

Shared Projects use owner/editor/chat roles with explicit file/chat visibility.
Moving a chat previews changed context/access and does not implicitly expose its
private memories, existing assets or old branches.

### 3.5 Interactive output and editing

Use a versioned **typed response-block contract** for text, table, chart, diagram,
calculator and quiz. The model proposes data; application validation selects known
renderers. Never execute arbitrary generated JavaScript in the Watai origin.
Validate size/depth, numeric values, accessibility labels, identifiers and asset
ownership. Invalid blocks produce an explicit error plus a safe text representation
when available, not silent content loss.

Streaming blocks are individually versioned. Early answers remain labeled
provisional while required work is pending; later findings preserve user reading
position and change identity. Do not disclose private chain-of-thought.

The document/code workspace supports manual edits, targeted assistant patches,
revision history, undo, restore and export. A patch includes its base revision:
reject stale edits with conflict/retry instead of overwriting human work.
Generated-code previews, if implemented, use a separate origin and constrained
network/filesystem; code output does not inherit app tokens or source grants.

### 3.6 Research, Work and connected applications

Research starts with an inspectable scope/source plan, then runs as a bounded durable
job with milestones, cited findings and an actual report. Work shares the lifecycle
but has artifact-delivery obligations. Both survive disconnect, permit cancellation,
resume safely and disclose partial failure/cost. A long ordinary answer is not
automatically Research, and a Python log is not a finished spreadsheet.

Start connectors read-only with one Azure-relevant source, preferably SharePoint/
OneDrive via approved Microsoft Graph access. Add other sources only after their
account/permission model is implemented. Each selected file retains source account,
stable external identity, revision, provenance and access checks. Revoking a grant
invalidates future use, cached retrieval and queued work under that grant.

Write tools require action preview, target account/resource, bounded payload,
one-time approval bound to exact action/revision, idempotency and durable outcome
receipts. No automatic resend after outcome-unknown. MCP is a transport, not an
authorization system; approved endpoints/tool schemas and execution policy remain
server-controlled. Imported content is untrusted, never authority.

### 3.7 Voice, images and scheduled work

Retain the working STT -> server agent -> sentence-TTS loop; qualify interruption,
mute/exit and microphone cleanup. Native Realtime is an optional provider-backed
upgrade, not a replacement until its transcript/tools/privacy behavior passes.
Never promise mobile background microphone operation or native lock-screen UI from
a PWA.

Preserve separate image-generation/edit capability evidence. R03 documents a current
Responses limitation for multi-turn image editing/streaming: evaluate dedicated image
APIs and persist explicit edit lineage rather than promising unsupported integration.

Tasks are server-owned schedules with timezone, next occurrence, last result,
pause/delete and bounded missed-run policy. Each occurrence has a unique execution
identity. Copies require the recipient's own connections/consent and cannot reuse
the creator's tokens. Start with an in-app result inbox; email/push requires separate
permissions and actual delivery/error evidence.

## 4. Azure target architecture

Preserve React/Vite PWA, Entra External ID, Functions application/ports/adapters,
Cosmos, Blob, Key Vault, Storage Queue workers and SignalR/polling. The frontend is
currently GitHub Pages; hosting the backend in Azure does not mean the frontend is
already Azure-hosted. A frontend hosting migration is **not** required for parity.

```text
React PWA / account-scoped cache and drafts
    -> authenticated Functions API
       -> capability policy / owner + scope + consent checks
       -> Cosmos: conversation versions, projects, work and task records
       -> Blob: canonical files, transcripts, artifacts and document revisions
       -> Key Vault + encrypted credentials / connector grants
       -> durable dispatch -> existing run/image/memory queues
                              + new job/ingestion lanes only when necessary
       -> Azure model/tool adapters and approved source adapters
    <- stable snapshots/events over SignalR, polling fallback

Optional isolated services, never in the HTTP/chat-worker process:
    generated-code previews / browser actions / ongoing cloud agents / Sites
```

Do not install a new orchestration platform merely because ChatGPT has one. Extend
existing durable-job seams first; choose Durable Functions or Container Apps jobs
only if a documented lifecycle need cannot be met reliably by the present queues.
Source runtime migration and provider model upgrade are independent milestones.

### 4.1 Proposed additive domain/API contracts

These are design shapes, not executable code or finalized endpoint schemas. Follow
repository-standard validation/error envelopes and owner-qualified access.

| Contract | Required information and operations |
| --- | --- |
| Capability record | Deployment/version/API/region/config identity; supported inputs/tools/reasoning; policy/consent; observed-at/expiry; state `supported`, `unsupported`, `unknown` or `temporarily_unavailable`; evidence and failure reason |
| Conversation path | Stable thread/branch/version/parent IDs; active selection and revision; server atomic edit/regenerate/select operations; immutable old messages; run binds exact path and idempotency attempt |
| Project | Owner, name, instructions revision, context policy, member roles, source refs; list/create/read/revisioned patch/move-chat/delete; context authorization evaluated at use |
| Response blocks | Schema version, block ID/type/revision, lifecycle, bounded validated payload, fallback text, source/artifact refs; shared persistence/sync/export/render contract |
| Document/Page | Owner/scope/title, canonical revision, content/block refs, version history, comments, grants; base-revision patch/restore; Pages add collaboration only after private editing is safe |
| Work job | Kind, scope, source manifest, budgets, plan revision, status/phase, lease/fence, approved actions, outputs and usage ledger; create/inspect/cancel/resume subject to authoritative policy |
| Source connection | Owner/account/source type/scopes, encrypted secret reference, consent revision, status/revoked-at; browse/read/revoke; no token in frontend DTO, prompt or export |
| Action receipt | Job/actor/account/resource/tool/payload digest, approval expiry, idempotency key, execution state and outcome; unknown outcome blocks automatic replay |
| Scheduled task | Owner/spec revision, timezone/schedule, next run, trigger allowlist, budgets, consent/source bindings, pause/deletion fence; unique occurrence receipt and result notification |
| Search result | Type, stable ID, safe snippet, scope/owner, target route, source revision and cache/freshness; authorization at query and open |
| Privacy operation | Policy revision and exclusion generation, durable purge/export job, provider/source deletion receipts, progress/failures, complete manifest; local versus account operation distinguished |

Entity partitions/indexes require a capacity/ownership design before provisioning.
Avoid a blanket migration of existing messages to a new container; prefer additive
version metadata with compatibility reads. Changes spanning different Cosmos
partitions must use documented conditional writes/recovery, not fictional atomicity.

### 4.2 Provider strategy

1. Inventory actual endpoint, deployment ID/version, region, quota and entitlement
   using authorized read-only metadata; never print secrets.
2. Start from R03/R04 as candidate support, not runtime proof. Capability probes are
   bounded, opt-in and cost-governed; normal rendering does not repeatedly probe models.
3. Pin selected stable versions where operationally possible; do not silently upgrade
   to a preview or a more expensive family.
4. Separate chat/text/vision/code/file/audio/image/edit/research/computer capabilities.
   New GPT model availability does not supply ChatGPT Projects, Sites, Dots or plugins.
5. Keep Tavily if configured until an alternative is proven better/authorized. New
   search providers require data-boundary and cost disclosure.
6. Treat Realtime, remote MCP, managed Research, multi-agent and computer-use support
   as unverified until tool-specific docs and exact-deployment canaries pass.

## 5. Non-negotiable acceptance

All thresholds below are **proposed Watai targets**, not measured ChatGPT performance.
Freeze fixture, viewport/device, runtime/config, sample count and timing definition
before a slice's tests. Model-dependent targets need a separate bounded canary.

| ID | Acceptance rule |
| --- | --- |
| AC01 | Zero transient prompt/reply inversions, disappearing prompts, duplicate identities or branch sequence jumps across every committed render and captured DOM/frame; delayed/out-of-order persistence and multi-device variants mandatory. |
| AC02 | Regeneration/edit preserves every old version; 100% of selected-path fixture turns enter context and 0 sibling turns enter it. Reload/second-device selection and late old-branch events are tested. |
| AC03 | In synthetic server tests, unsupported/unknown tool or effort is rejected before provider dispatch; unavailable UI states expose the same reason. Credential/config changes invalidate stale capability identity. |
| AC04 | Project A/B/global canary fixtures show 0 unauthorized source/memory inclusions at submission, retrieval and delayed-worker execution. Permission/policy revocation blocks the next use, not only the next UI refresh. |
| AC05 | Known fixture search results resolve the correct object/message and type; revoked/deleted/foreign results = 0. Proposed warm p95 <=1 s for 10,000 indexed metadata records, excluding network conditions not in the fixture. |
| AC06 | PDF/CSV/audio fixture questions cite inspectable source locations; transcripts are labeled machine-generated; incomplete ingestion never renders as ready. Cancel/reload and source deletion cannot resurrect bytes or grants. |
| AC07 | Generated artifacts exist, open in the required viewer/download and survive fresh authenticated reads. Fixed calculation fixtures produce exact expected values; empty/corrupt/foreign outputs cannot count as success. |
| AC08 | Typed blocks reject unknown type, oversized/deep/nonfinite payload and unsafe URL. Chart/table fixture values match source data exactly; keyboard/mobile use works; no app-origin generated-script execution. |
| AC09 | Streaming updates preserve stable block/turn identity and user-pinned history. Provisional text cannot claim a required tool/output completed before verified completion. |
| AC10 | A stale assistant/editor patch fails with an explicit revision conflict; manual content is not overwritten. Undo/restore yields the exact saved fixture revision after reload. |
| AC11 | Connector revocation cancels/blocks dependent new and queued reads/writes; 0 tokens in DTOs, model input, logs, archives or shared content. Distinct connected accounts never silently substitute. |
| AC12 | Consequential action requires an unexpired approval bound to exact account/resource/payload; mutation/replay/missing approval produces 0 external actions. Outcome-unknown is visible and not automatically retried. |
| AC13 | Job/task duplicate queue delivery and concurrent claim produce at most one admitted occurrence/action; interruption, poison messages and cancellation converge with visible durable state. |
| AC14 | Task schedule fixtures cover DST gaps/folds, timezone changes, pause/delete, duplicate webhook and missed-run policy; each admitted occurrence has exactly one result receipt, not a prose-only completion. |
| AC15 | Voice mute/exit terminates capture immediately; proposed same-device local interrupt-to-stop-audio p95 <=100 ms. Final captions/transcript persist on the ordinary run path; denied mic does not submit. No background/OS guarantees without device evidence. |
| AC16 | Temporary mode is never enabled until history visibility, local cache, memory use/learning, assets/jobs, export/restore and provider retention are verified. Any cleanup limit is explicitly disclosed; no "zero retention" claim by inference. |
| AC17 | Account export has a complete object/media manifest and reports every unavailable item. Local-only export remains separately labeled. Deletion/forget dominates delayed work, restore/import and code rollback. |
| AC18 | Share preview enumerates included text/versions/assets; private memory/tool secrets are excluded. Revocation prevents fresh reads and grants; viewer rights do not grant editor/owner operations. |
| AC19 | WCAG 2.2 AA target: task-specific keyboard, focus, announcements, contrast and reflow checks; 320 CSS px reflow plus desktop/mobile viewports. Accessibility is not claimed from automated tooling alone. |
| AC20 | Proposed local pending acknowledgement <=150 ms; preserve failed-send draft until durable acceptance. Provider TTFT/TTS/Research completion are measured separately with cold/warm conditions, not folded into a false universal latency promise. |
| AC21 | All resource-consuming work has explicit request/token/tool/wall-time/currency ceilings; overage stops new side effects. Missing provider usage is unknown, not zero; agent-only token records are not full account billing. |
| AC22 | Every exact tested flow has validated version-bound task, capture, complete deterministic algorithms, preloaded semantic skill/harness and independent authority before execution. Both evaluation paths must complete; missing evidence is not a pass. |

## 6. Parity reporting and exclusions

Maintain per-feature `not_started`, `designed`, `source_implemented`,
`locally_validated`, `deployed`, `workflow_qualified`, `blocked` or `unsupported`,
with exact source/frontend/API/config identity and evidence. Track documented
reference, browser-observed reference and measured Watai behavior independently.

A weighted parity score is **not** a release gate. Safety, privacy, chronology,
delivery, authorization and evidence conditions combine by AND.

Explicitly outside the first program: OpenAI subscription/sign-in/marketplace,
native desktop history/lock-screen integrations, regulated Health/Finances
partnerships, cloud coding product, public Sites and unrestricted ongoing agents.
They remain optional future product decisions, not forgotten gaps.
