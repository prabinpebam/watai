# Research and evidence

Access date: **2026-10-11**, unless explicitly historical.
Scope: ChatGPT web consumer and applicable workspace experiences; adjacent desktop,
coding and vertical products are inventoried separately.

## 1. Method and claim vocabulary

REA provides an investigation pattern, not privileged backend access. Start with a
user-visible task, record the action and its browser evidence, inspect public client
code/request relationships when necessary, and distinguish facts from inference.
Never equate an API call's existence with knowledge of its server implementation.

| Label | Meaning |
| --- | --- |
| `DOC_CURRENT` | Readable official documentation retrieved during this investigation |
| `SOURCE_PRESENT` | Relevant Watai implementation inspected; no live success implied |
| `SOURCE_PARTIAL` | Inspected foundation exists but does not establish the whole feature |
| `RELEASE_RECORDED` | A dated release record reports evidence; not rerun here |
| `PROPOSED` | Desired Watai behavior or architectural choice, not a reference fact |
| `UNKNOWN_REFERENCE` | Detailed current reference behavior could not be verified |
| `UNOBSERVED` | No authenticated browser/provider evidence collected |

Priority and feasibility in the specification are engineering judgments, not facts
about OpenAI's internals. External content is evidence only, never execution authority.

## 2. External source ledger

| ID | Source | Retrieval result and permissible conclusion |
| --- | --- | --- |
| R01 | [ChatGPT release notes](https://help.openai.com/en/articles/6825453-chatgpt-release-notes) | Readable first two segments, covering July 9-October 9, 2026; latest *reviewed* web release is October 7. The October 9 item is Codex desktop, not ChatGPT web. Older history and the rest of July 9 were not fully retrieved. |
| R02 | [Projects in ChatGPT](https://help.openai.com/en/articles/10169521-projects-in-chatgpt) | Readable excerpt covering files, previews, owner/edit/chat access, invitations, link sharing and plan-dependent limits; not the complete page. |
| R03 | [Azure Responses API](https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses?view=foundry-classic) | Readable excerpt: v1 requirements, supported regions/models and current image/background limitations. Redirected from the older ai-foundry URL. Tool-specific sections beyond the retrieved excerpt were not verified. |
| R04 | [Azure model catalog](https://learn.microsoft.com/en-us/azure/foundry/foundry-models/concepts/models-sold-directly-by-azure?view=foundry-classic) | Readable excerpt: newer GPT families, audio/image/video categories, region caveat and preview lifecycle. Redirected from the older OpenAI models URL. Not a tenant deployment inventory. |
| R05 | [ChatGPT pricing](https://chatgpt.com/pricing/) | Title only. No complete entitlement or price matrix established. |
| R06 | [Capabilities overview](https://help.openai.com/en/articles/9260256-chatgpt-capabilities-overview) | HTML extraction insufficient; not used to substantiate feature details. |
| R07 | [Agent Help](https://help.openai.com/en/articles/11752874-chatgpt-agent) and [announcement](https://openai.com/index/introducing-chatgpt-agent/) | Both access paths returned 403. Current Work/cloud-browser observations come from R01, not these pages. |
| R08 | [Deep Research Help](https://help.openai.com/en/articles/10500283-deep-research) and [announcement](https://openai.com/index/introducing-deep-research/) | Help redirected to deep-research-in-chatgpt then returned 403; announcement returned 403. Detailed standalone Research UI is unverified. |
| R09 | [Memory FAQ](https://help.openai.com/en/articles/8590148-memory-faq) and [announcement](https://openai.com/index/memory-and-new-controls-for-chatgpt/) | Returned 403. Project memory changes are documented by R01; account-wide memory details require later verification. |
| R10 | [Canvas Help](https://help.openai.com/en/articles/9930697-what-is-the-canvas-feature-in-chatgpt-and-how-do-i-use-it) and [announcement](https://openai.com/index/introducing-canvas/) | Returned 403. Pages/interactive editing are documented by R01; exact Canvas controls/versioning are unverified. |
| R11 | [GPTs announcement](https://openai.com/index/introducing-gpts/) | Returned 403. Assistant-builder/store behavior remains a reference candidate, not a fresh observation. |
| R12 | [Study Mode announcement](https://openai.com/index/chatgpt-study-mode/) | Extraction returned an example teaching conversation, not a reliable full feature description. Interactive quizzes are independently documented by R01. |
| R13 | [REA browser guide](https://rea.tools/guides/browser/) | Read in the preceding discussion: attach to an existing Chrome debugging endpoint, capture before the action, correlate request initiators and script evidence. This is methodology, not ChatGPT evidence. |

Public source excerpts are summarized rather than copied. Tool-generated temporary
fetch files are session-only, not portable research artifacts or release evidence.
The durable references are the URLs, dated claim ledger and access outcomes here.
Neither source-access failures nor partial extraction was treated as a clean result.

### 2.1 Current dated reference facts

All entries below are `DOC_CURRENT` from R01 except where R02 is named. Availability
is a statement in the reference source, not proof of access in a particular account.

| Date | Capability | Important boundary |
| --- | --- | --- |
| October 7 | GPT-6 and Intelligent UI: mixed text/visual/interactive answers; answer may start while thinking/tools continue | Source differentiates plans and reasoning modes. It does not expose the UI implementation protocol or prove Azure supplies it. |
| October 6 | Audio-file upload for transcripts, summaries and questions | Paid subscription/workspace rollout; region, model and workspace caveats. |
| September 29 | Pages: editable text, charts and interactive content with collaborators/comments | Space availability/sharing governs access; private chats/memory are not implicitly shared. |
| September 29 | Space collects Pages/files/work; replaces Library for eligible accounts; Projects remain separate | Do not rename Watai Library into Projects or assume one universal ChatGPT sidebar. |
| September 29 | Sites: editing, publishing and recurring cloud schedules | Product/service capability, not an inference API. |
| September 29 | Dots: ongoing agents with cloud computers, connections and autonomy settings | Gradual adult/plan/market rollout; Enterprise beta off by default; not ordinary chat. |
| September 29 | Codex Cloud and GPT-6.1 in Work/Codex | Adjacent coding environment and Work model release; not proof the same model powers Chat. |
| September 29 | Meetings plugin saves summaries/action items; reported deletion of original audio | Desktop macOS beta, not a web recording-parity requirement. |
| September 29 / September entries | Interactive plugin panels/viewers; connected-app events; third-party allowance preview; shareable profiles; sign-in to other products | Separate integration, consent, identity and billing services. Several are restricted previews. |
| September 21 | Finances credit-report/score connection; Privacy Center | Finances rollout is U.S./plan restricted. Privacy Center links existing controls, not a new retention guarantee. |
| September 17 | Multiple connected accounts; Microsoft Word add-in | Multiple-account connections are web relevant; the Office add-in is adjacent. |
| September 14 | Plus/Pro automatic Instant-to-Thinking switching retired except safety; explicit reasoning choice remains | Do not copy stale automatic-switching behavior or confuse model routing with reasoning selection. |
| September 10 / August 13 | Library connected sources: Google Drive, then Box/Dropbox/SharePoint; folder context, side previews and source links | Source permissions remain applicable. Editing/collaboration coverage varies. |
| September 3 | Astra adds complex professional work capabilities; Data/Zendesk/OneNote integrations; Sites guest access | Product output quality and integrations cannot be inferred solely from an Azure model name. |
| August 25 | Scheduled/webhook tasks; share independent task copies; signed-in cloud-browser work | Confirmations for consequential actions; some triggers/plans restricted; user's own app connections required. |
| August 14 | Interactive quizzes, eligible personalized homepage suggestions, explicit Think on web | Exact quiz UI was not observed. |
| August 14 | Existing project memory setting can change; shared projects remain project-only | Project-only isolates both directions; source reports changes may take hours. Watai should disclose its own actual timing. |
| August 10 | Restaurant search/reservation cards | Provider contracts and geography matter; Work does not include this search per source. |
| July 14 | Unified search across chats/projects/images/documents with filters and deep links | Distinct from web search or file-grounding retrieval. |
| July 9 | Work performs longer research/analysis over apps/files and creates finished artifacts/Sites | Retrieved introduction is partial; precise limits, progress controls and persistence need observation. |
| R02, current | Projects accept multiple material types; owner/edit/chat access; invitations/link joining; file management | Retrieved limits range by plan. Do not inherit OpenAI's file counts or sharing defaults for Watai. |

### 2.2 What is not established

- No complete Free/Go/Plus/Pro/Business/Enterprise/Edu entitlement comparison.
- No signed-in observation of composer menus, sidebar variants, message editing,
  regenerate branching, sharing, feedback, Canvas, GPT builder or Research controls.
- No measured ChatGPT latency, per-frame chronology, failure recovery or accessibility.
- No proof that OpenAI's runtime outputs use a specific DOM/component/schema technology.
- No mapping of Watai subscription, actual deployed models, regional quotas or Azure
  feature permissions. Published model support is not usable capacity.
- No verified server-side source, search-ranking algorithm or model system prompt.

## 3. Watai source evidence map

Source inspected at the baseline SHA. Existing tests indicate intended coverage,
not a newly executed test pass.

| ID | Inspected source / record | Findings |
| --- | --- | --- |
| W01 | [App](../../../src/app/App.tsx) | Lazy chat/search/images/settings/voice/Library routes and authenticated/invite/config gates; no inspected routes for Projects/Pages/Work/task management. |
| W02 | [ChatScreen](../../../src/features/chat/ChatScreen.tsx) | Configurable model selector, chat files, tools, new chat and voice entry. |
| W03 | [useChat](../../../src/features/chat/useChat.ts) | Optimistic prompts, ordering/handoff integration, file indexing, Library reuse, skill selection and server submission. Regenerate removes trailing assistant messages and resubmits the last user turn. |
| W04 | [Message](../../../src/features/chat/Message.tsx) | Markdown, tool cards, citations, memory disclosure, artifacts, copy/regenerate/read-aloud. No full branch selector/edit feedback surface established. |
| W05 | [HistoryList](../../../src/features/history/HistoryList.tsx) | Rename/pin/archive/delete and active-run markers. |
| W06 | [SearchView](../../../src/features/history/SearchView.tsx) | Conversation search, loading/error/retry, deep link to a message; not unified object search. |
| W07 | [LibraryView](../../../src/features/library/LibraryView.tsx) | Account catalog with type/origin/sort/search filters, paging, upload cancellation and detail navigation. |
| W08 | [Image composer](../../../src/features/images/components/Composer.tsx) | Prompt, reference/remix, aspect, count, quality and capability notice; no inspected mask editor. |
| W09 | [VoiceMode](../../../src/features/voice/VoiceMode.tsx) | Recording/transcription -> ordinary server chat -> streaming sentence TTS, captions, local cancellation fences. Not an established native speech-to-speech WebRTC path. |
| W10 | [Settings](../../../src/features/settings/Settings.tsx) | Models/keys, personalization/memory, tools, voice, data. Temporary unavailable; timed deletion not enforced; export explicitly local/cache-limited; clearing device does not delete server data. |
| W11 | [SkillsBody](../../../src/features/skills/SkillsBody.tsx) | Packaged instruction/script skills with enable/upload/replace/delete; not a custom-assistant registry or GPT store. |
| W12 | [Frontend types](../../../src/lib/types.ts) | Thread/message/attachment/artifact/citation/tool models; parentId exists but does not prove branch/version functionality; audio kind exists but does not prove recording-file understanding. |
| W13 | [Run domain](../../../api/src/domain/run.ts) | Strict bounded request, idempotency ID, logical prompt/reply order, model/tool allowlists and authorization fields; no inspected job-type/project/branch schema. |
| W14 | [Credential service](../../../api/src/application/credentialService.ts) | Encrypted vault and metadata-only status. Agentic/code/file support inferred from Foundry hostname; web support from Tavily credential. |
| W15 | [Responses client](../../../api/src/ai/responses.ts) | Typed text/image/function/server-tool/citation/completion stream; no inspected typed interactive-answer block or audio input item contract. |
| W16 | [Orchestrator](../../../api/src/ai/orchestrator.ts) | Bounded model/tool loop with required-tool completion enforcement and optional destructive-action confirmation. Not a full browser agent or durable task scheduler. |
| W17 | [Semantic router](../../../api/src/ai/semanticRouter.ts) | Semantic selection among respond/image/code/file/web with image reference identity. Not the latest ChatGPT reasoning selector/product router. |
| W18 | [Run worker](../../../api/src/application/runWorker.ts) | Server context/tools/memory/image/artifact and Library integration; inspected context handles image attachments. General audio-file transcript ingestion was not established. |
| W19 | [Queue function](../../../api/src/functions/runWorker.ts) | Storage Queue owned worker with execution/release identity. Current execution is not the Durable Functions design in older docs. |
| W20 | [Infrastructure](../../../infra/main.bicep) | Functions/Cosmos/Storage/Key Vault/queues, memory controls and always-ready parameters; configuration intent is not a live cloud inventory. |
| W21 | [0.2.4 release](../../releases/2026-10-11-v0.2.4.md) | Deployed hardening, exact public-byte/API-health records. Authenticated production chat/media and semantic EDD were explicitly not performed; Node 20 production versus Node 24 source. |
| W22 | [Safety backlog](../2026-09-10-autonomous-delivery/04-implementation-backlog.md) | Existing safety/privacy/worker/sync/asset/temporary constraints remain authoritative. |
| W23 | [EDD contract](../../quality-gate/05-evaluation-and-design-system.md) | Deterministic and open-ended semantic paths; preparation for each exact flow precedes evaluation. |
| W24 | [Memory domain](../../../api/src/domain/memory.ts) and [extraction domain](../../../api/src/domain/memoryExtraction.ts) | Project/work context deliberately excluded from normal manual/automatic memory lanes; future project context must not silently enter global memory. |
| W25 | [Composer](../../../src/features/chat/Composer.tsx) | Attachments/Library picker, slash skills, caret-aware dictation, VAD/waveform and bounded recording constants. |
| W26 | [ToolsMenu](../../../src/features/chat/ToolsMenu.tsx) | Tool controls and dependency hints; several available flags are synthesized client-side. Central truthful capability policy must replace assumptions. |

An inspected surface's absence establishes only "not found in this baseline survey,"
not a repository-wide proof of nonexistence. Each implementation slice traces its
complete controlling path before editing.

## 4. Safe REA-style reference-observation plan

This procedure is **planned, NOT_READY and not executed**. REA installation is
optional; an equivalent authorized CDP reader can collect the same browser evidence.
No privileged backend access is required or inferred.

### Preparation

1. Use a consenting synthetic/reference account and identify plan, region, workspace,
   feature flags, browser version and observation time. Never use private user chats.
2. Require a verified non-visible existing debugging connection or an explicitly
   authorized interactive exception. Do not start/focus browser or console windows,
   prompt for authentication, bypass CAPTCHA, or extract credentials/cookies.
3. Bind exact task variants, synthetic fixtures, capture regions, deterministic
   algorithms and skill-configured semantic review to content hashes. Validate
   recorder/reviewer calibration and independent authority before any eval loop.
4. Bound time, bytes, screenshots and requests. A generation/upload/share/app
   connection is a state-changing action: it needs explicit task authority and a
   separate spend/data budget. Passive inspection does not authorize it.

### Capture and interpretation

For each task, capture before interaction: baseline -> entry -> user action ->
pending -> first result -> intermediate tool/content revisions -> completion ->
reload/reconnect -> cleanup. Record visible DOM mutations, stable entity IDs,
screenshots at phase boundaries, relevant request metadata and public script
initiators. Public client-source analysis is optional and narrowly scoped.

Exclude Authorization, cookies, SAS/token query strings, real accounts/documents and
unnecessary request bodies. Raw evidence stays local with declared retention.
Redaction insufficiency means stop/insufficient, not upload to another service.

Agent synthesis must cite the exact event/asset behind each conclusion, separate
observed facts from inferred intent and unknown implementation, and preserve
transient failures. Include open-ended cross-phase semantic review, not just a
predefined checklist. Do not copy proprietary client source into Watai.

### Reference task inventory

| Task | Starting fixture and exact outcome to characterize | Required branches |
| --- | --- | --- |
| RF01 Conversation | Synthetic text thread; send, stream, stop, reload and return from another device | Stale/out-of-order reads; failed admission; tool progress; history scroll |
| RF02 Versioning | Existing two-turn thread; edit first prompt; regenerate an earlier answer; select alternatives | Original history retained; context on selected path; duplicate submit |
| RF03 Discovery | Known chat/file/image/project titles and content; search, filter, open selected match | Archived/missing object; no-result; permission revocation |
| RF04 Inputs | Synthetic PDF/image/CSV/audio fixture; upload, wait, ask a grounded question | Limit/type rejection; cancellation; partial ingestion; source deletion |
| RF05 Projects | Two projects with unique canary facts; change memory policy and move chat | Cross-project/global exclusion; shared access changes; concurrent instructions |
| RF06 Interactive output | Known numeric comparison and quiz; inspect, operate, follow up, reload | Invalid schema; long stream; non-interactive fallback; keyboard/mobile |
| RF07 Workspace editing | Synthetic document/code; select region, ask revision, manual edit, undo, restore | Concurrent edits; stale assistant patch; isolated preview/download |
| RF08 Research/Work | Approved finite research question with source fixtures; review scope, start, interrupt | Partial results; missing source; cancellation; resume and cost ceiling |
| RF09 Connected source | Consenting sandbox source; read file, revoke grant, query again | Multiple accounts; source changed/deleted; permission inheritance |
| RF10 Scheduled work | Synthetic one-shot/recurring task; inspect schedule, pause, change timezone | DST; duplicate trigger; overdue run; missing connection; disable/delete |
| RF11 Voice | Consenting mic session; dictate/edit/send; voice with interruption and mute/exit | Denied mic; noisy room; device change; visible/background limits |
| RF12 Sharing | Synthetic chat/page; preview share, grant/revoke, view as distinct account | Hidden memory/tool details; new branches; asset grants; deleted source |
| RF13 Privacy | Save synthetic memory, disable use/learning, forget, temporary conversation, export/delete | Delayed worker; restore/import; provider copies; reference product's actual notices |
| RF14 Frontier | Eligible sandbox account; characterize Space/Pages/Sites/dot task/access controls | Unavailable plan; approval pause; spend ceiling; unsupported native-only feature |

These rows define investigation questions, not complete executable flow algorithms.
Selectors, thresholds, recording contracts and semantic identity must be authored
for the exact task before execution. Missing account/access/authority means
`UNKNOWN_REFERENCE`/`NOT_READY`, not an inferred pass.

## 5. Investigation outcome

Enough source and dated product evidence exists to propose a broad Azure-feasible
roadmap. It does **not** establish complete latest reference behavior. Fetching
blocked pages repeatedly, installing a decompiler or analyzing hidden backend guesses
would not improve the evidence. The next discriminating reference step is authorized
task observation, not additional infrastructure or a parity percentage.

### 5.1 Requested read-only Edge observation: attachment blocked

After the user requested Playwright inspection of their signed-in Edge profile,
a local read-only process-metadata check found 31 running Edge processes and **no
process advertising a remote-debugging port or pipe**. An independent listener
check also found **zero Edge-owned loopback listeners**, so no alternate existing
local CDP endpoint was available. No browser was launched,
focused, navigated, closed or restarted. Profile files, cookies, login tokens,
private conversations and account contents were not read or copied.

Playwright cannot attach to an ordinary already-running Edge profile merely from
its profile email. The inspected repository launcher starts a new visible window
and fresh profile; it was not executed and would not preserve the user's existing
authenticated session. No claim of Playwright page observation is made.

Continuation requires an authorized local debugging connection to the intended
profile or another explicitly shared browser connection. A one-time interactive
setup would require a specific exception to background-only operation. Passive
DOM/control inspection must still exclude private chat content and must not send
prompts, upload files, change settings, connect apps or perform account actions.

### 5.2 Headless Playwright attempt

User direction was extended to perform necessary Edge setup, using existing login
for a strict-read-only assessment.

At `2026-10-11T06:23:25.769Z`, an existing idle dedicated automation profile was
opened by installed Playwright 1.61.1 in **headless Edge**, using an owned pipe
rather than exposing remote CDP. Metadata checks verified current-user ownership,
protected private ACLs, no unsafe allow rules, no reparse points and no existing
process using that dedicated profile. The installed Playwright launcher explicitly
uses `windowsHide: true`.

Context guards were installed before one navigation to ChatGPT: exact read-host
allowlist, GET/HEAD only, WebSockets closed, service workers blocked and private
conversation/history reads denied. No prompts, uploads, account actions, setting
changes or model calls were authorized.

Result at `2026-10-11T06:23:30.561Z`: **BLOCKED** after six attempted HTTP requests.
One non-GET/HEAD request was aborted; the guard reported
`APP_WRITE_ATTEMPT_BLOCKED`. The request's endpoint was not retained, so its precise
purpose is **unknown**; it must not be described as a proven account mutation or
known harmless bootstrap request. No authenticated controls were captured, account
identity was not established, and the owned context was closed. Successful
generation and mutation requests were zero. The dedicated profile may have normal
local browser-maintenance writes; byte-for-byte immutability is not claimed.

A separate metadata-only check matched the active `Default` Edge profile to the
requested email without returning account or credential values. Opening its cookie
store with read access and read/write sharing failed with Windows sharing-violation
error **32**; **zero cookie bytes were read or copied**. Historical profile-clone
receipts already record locked session stores and were reused rather than repeating
the clone. No user Edge process was stopped/restarted and no credentials were
decrypted, extracted or supplied to another service.

Thus a hidden Edge launch is possible and was performed, but **using the current
active authenticated session has not been achieved**. Neither the old automation
profile nor the blocked canary proves the user's ChatGPT login. Further inspection
requires an attachable authenticated session; forcibly unlocking session files,
restarting user windows or bypassing authentication is not a safe continuation.
This was a passive connection canary, not an EDD task-flow evaluation or semantic
qualification.
