# Frontend implementation audit

**Baseline:** `f7dc195300c4039aae5b9a7a8fb1691327864ea1` · **Assessed:** 2026-09-10.

## Executive assessment

Watai has a substantial, coherent personal-assistant interface, not merely a prototype screen. Chat, attachments, image generation, a searchable Library, skill management, dictation, voice replies, account onboarding, and adaptive settings have real implementations. Its strongest work is in preserving conversation continuity and accommodating mobile input. Its largest shortcomings concern **whether controls and persistence mean what users reasonably think they mean**, followed by accessibility behavior shared across screens.

| Category | Rating /10 | Basis and limiting evidence | Primary research |
| --- | ---: | --- | --- |
| **C01 Product and interaction UX** | **5** | Broad working flows, progressive responses, useful Library states; temporary-chat promises, onboarding tests, search destinations, and voice mute are materially inconsistent. | F03, F10, F11 |
| **C02 Accessibility and mobile resilience** | **4** | Named icon buttons, status primitives, adaptive sheets, viewport handling; incomplete modal/composite keyboard contracts, missing names, low-contrast text, and unverified device behavior. | F01, F02, F03, F04 |
| **C03 Client architecture and offline consistency** | **4** | Clear repository seam, local data, injected clients, recovery snapshots; unscoped account data, nontransactional outbox, one-way settings synchronization, and no reviewed service-worker implementation. | F05, F06, F07, F08, F09 |

These are engineering judgments, **not task-success percentages or accessibility conformance labels**. Rubric: 0 absent, 2 prototype, 4 functional with significant gaps, 6 credible personal beta, 8 robust production-proven, 10 exemplary with sustained evidence. Intermediate scores interpolate. The sources were actually fetched/read; dates, propositions, and limitations are in [the source register](research/frontend-sources.md).

**Priorities:** 0 P0, 8 P1, 5 P2, 0 P3 findings. P1 means correct before expanding use or relying on the affected guarantee; P2 means planned reliability/quality work. Counts are not independent risk estimates.

## Scope, evidence, and shipped-versus-planned boundary

This review traced the application shell/router/authentication, local repository and sync engine, state stores, design primitives/CSS, chat/history/search, attachments/sources/files, image studio, Library/detail/picker/upload, skills, onboarding, voice/media, and non-memory settings. Memory management, extraction, and memory-specific UI semantics belong to the separate memory audit; backend enforcement and delivery configuration belong to their respective reports.

Evidence is static implementation inspection plus selected existing test bodies, source searches, numerical color calculations, and one bundled static design-detector invocation. **This frontend inspection did not conduct a rendered usability session, screen-reader session, production-account check, native-device test, or field-performance measurement.** Test bodies establish intended coverage; coordinated baseline execution is reported separately in [validation evidence](evidence/validation.md). Automated browser-suite results, where available there, are not a substitute for the manual accessibility/device assessments proposed here. Unfetched deployment behavior is not assumed.

The architectural document, `documentation\ui-design\08-frontend-architecture.md:14-81,99-110`, proposes an error boundary, service worker, full-text index, query-cache tier, and overlay routes that preserve the chat. These are not all shipped. Actual routes are in `src\app\App.tsx:302-375`; voice is outside `Protected`, search is a separate route, and a global run store preserves generation despite view unmounting. Authentication remains enforced by backend APIs; the unguarded voice route is an inconsistent entry experience, not evidence of an authorization bypass. The earlier design-system audit's “Implemented” status and favorable adjectives are historical context, not current accessibility evidence.

### Strengths worth preserving

- **Conversation continuity:** `src\features\chat\runStore.ts:63-151,213-260` maintains generation outside the view, snapshots progress, and restores interrupted content. `ChatView.tsx:43-98` coalesces resize-driven scrolling and stops following when users scroll upward. `useChat.ts:117-138` avoids replacing an already-open thread with a loading screen during refresh.
- **Thoughtful dictation:** `src\features\chat\Composer.tsx:372-555` guards rapid activation, retains failed audio for retry, aborts transcription, inserts at the captured caret, and cancels capture on page hiding. Existing tests exercise these behaviors (`Composer.test.tsx:83-165`). Voice mode does not yet inherit all these safeguards.
- **Useful asset workflows:** `src\features\library\LibraryView.tsx:161-176,270-302` differentiates initial failure, stale results, no matches, empty collections, and pagination failure. Detail has source/provenance information and download fallback (`LibraryDetail.tsx:75-88,247-289`). Picker selections are thread-scoped (`LibraryPicker.tsx:21-54`).
- **Skills and studio are functional:** the effective skills catalog supports upload/replace/delete, detailed validation errors, and optimistic preference updates (`src\features\skills\useSkills.ts:32-137`); studio supports reference images, remixing, placeholders, and realtime/poll recovery. These are useful workflows, not merely configuration labels. Whole-list rollback in skill updates can overwrite a concurrent change (`useSkills.ts:63-75,119-128`); apply FE-09's item-scoped reconciliation approach there too.
- **Real mobile groundwork:** viewport resize/scroll updates preserve pinch-zoom behavior (`src\app\viewportFrame.ts:1-34`), with explicit unit assertions (`viewportFrame.test.ts:29-104`). Safe-area padding, adaptive sheets, coarse-pointer styles, and an iOS share-based save path exist. These are implementation strengths, not proof of universal mobile usability.
- **Reusable foundation:** semantic light/dark tokens, named `IconButton`, native checkbox-backed `Switch`, `Spinner` and `InlineAlert` roles, lazy route imports, memoized Markdown, and disabled syntax highlighting during streaming all reduce duplication or work. HTML previews use a sandboxed opaque-origin iframe (`Markdown.tsx:129-132`); this is a boundary worth preserving, not a comprehensive security assessment.

## Findings

### FE-01 — Local account data and outbox are not identity-scoped

**P1 · C03 · High confidence · Observed design; cross-account consequences inferred.**

`src\data\db.ts:4-34` opens one database named `watai`; `src\data\sync\syncRepository.ts:29-39` uses global queue/cursor keys; `src\state\store.ts:219-245` persists drafts under `watai.ui`. `src\auth\cloudAuth.ts:250-254` performs MSAL logout without clearing or switching these application stores. Local reads do not filter by authenticated owner. The optimistic configured marker is also global (`src\app\App.tsx:74-120`).

**Impact:** account B signing into a browser previously used by A can encounter A's cached conversation/draft state. Pending A operations are not tagged with an owner before being sent with the current token. The [backend audit](03-backend-audit.md) independently identifies shared thread-ID storage namespace concerns; server authentication alone must not be assumed to contain this dispatch path. This finding covers local ownership, not a duplicate server finding. No production cross-account access was attempted.

**Recommendation:** account-keyed database/state namespaces and outbox ownership; stop realtime/runs before identity changes; migrate legacy data only after explicit ownership reconciliation. MSAL cache management is not application-data isolation [F08].

**Proposed acceptance:** synthetic A/B sign-in, sign-out, reload, offline, and two-tab tests show zero cross-account rows/drafts and zero requests carrying another account's queued operations.

### FE-02 — Queue updates can erase concurrent mutations

**P1 · C03 · High confidence · Observed algorithm; interleaving inferred.**

`src\data\sync\syncRepository.ts:370-384` reads the entire queue, awaits network work, then overwrites it with a sliced snapshot. Enqueue/coalescing also use separate read/write operations (`515-557`). `src\data\index.ts:34-40` does not serialize `syncNow`; focus, interval, online, and realtime paths can overlap.

**Impact:** push reads `[A]`; another action persists `[A,B]`; A completes and push saves `[]`. B is lost from the outbox even though its local mutation succeeded. Separate tabs create the same risk. Retryability and idempotent server writes do not repair a missing operation. Existing tests cover sequential coalescing/retry (`syncRepository.test.ts:631-718`), not this interleaving.

**Recommendation:** per-operation IndexedDB records, atomic entity-plus-outbox transactions, acknowledgement by operation ID, and single-flight draining with a cross-tab ownership strategy.

**Proposed acceptance:** deterministic delayed-request tests preserve all unrelated enqueues/deletes; crash/reopen and two-tab schedules converge without silent loss. Failed permanent operations remain inspectable rather than only console warnings.

### FE-03 — Composer clears work before durable acceptance

**P1 · C01/C03 · High confidence · Observed implementation; failure scenario inferred.**

`src\features\chat\Composer.tsx:284-299` calls a void-typed `onSend`, immediately clears text, revokes previews, and removes selections. The async send subsequently creates the thread, stores blobs, and appends the message without a surrounding recovery handler (`useChat.ts:181-228`). Busy protection is not established before the initial awaits.

**Impact:** denied/full IndexedDB storage can leave a cleared composer without a saved prompt or reusable attachment selection. Fast duplicate invocations can append multiple user turns before the run-store guard becomes active. The later run manager protects generation, not the whole send transaction.

**Recommendation:** return an explicit accepted/rejected result; atomically persist the local turn/outbox before clearing only that draft revision. Retain files and offer Retry on failure; guard submission synchronously. Do not wait for model completion before clearing.

**Proposed acceptance:** inject each storage failure and double-submit schedule; preserve input/selections, show one actionable error, and produce exactly one accepted user turn [F05, F11].

### FE-04 — “Default to temporary chats” does not affect chat creation

**P1 · C01/C03 · High confidence · Observed frontend mismatch.**

`src\features\settings\Settings.tsx:1600-1609` promises new chats will not enter history. Its value is saved but no production frontend consumer reads `temporaryDefault`. `useChat.ts:105,199-203` defaults its `temporary` argument to false; `ChatView.tsx:17` and `VoiceMode.tsx:33` do not override it. Sidebar creation also omits the flag (`src\app\AppShell.tsx:32-36`).

**Impact:** enabling the privacy-related control still creates an ordinary local thread eligible for synchronization. The repository test proving explicitly temporary threads are not queued does not test this UI path. The [memory audit](02-memory-audit.md) confirms extraction rejects genuinely temporary threads; this unwired preference means those guards correctly receive an ordinary thread despite the user's contrary expectation. Temporary-memory read policy remains a separate, conditional server concern.

**Recommendation:** hide/disable the promise until a supported end-to-end temporary-run contract exists, or wire every entry point through one policy-aware creation service. Merely setting the local flag is insufficient: `runStore.ts:158-169` still needs a compatible server execution path. The backend audit confirms thread creation rejects `temporary: true` and runs require a persisted owned thread; the current API therefore cannot implement this promise simply by forwarding the preference.

**Proposed acceptance:** normal, sidebar, voice, and Library-origin new chats honor the selection across local history, server persistence, and memory processing. The backend audit separately records that the stored retention preference has no production enforcement consumer; do not imply a frontend setting alone supplies that policy [F11].

### FE-05 — Voice mute does not stop active capture; pending capture outlives exit

**P1 · C01/C02 · High confidence · Observed state handling; device consequences inferred.**

`src\features\voice\VoiceMode.tsx:249-256` only toggles `muted`. The active recorder continues; `onOrbTap` checks `listening` before `muted` and can still stop-and-send (`181-191`). `startListening` stores a recorder after an await without a mounted/operation guard (`135-148`), while unmount cleanup can only cancel a recorder already stored (`200-209`).

**Impact:** “Mute microphone” can leave capture running. Exit during a permission prompt followed by granting permission can start capture after leaving the screen. Repeated startup taps can create multiple capture requests. Voice mode also lacks a distinct transcribing phase, unlike dictation.

**Recommendation:** reuse a lifecycle-safe capture controller; synchronously cancel/discard when muting, invalidate pending startup/transcription on exit, and report requesting/transcribing/failure distinctly [F07, F10].

**Proposed acceptance:** delayed permission, repeated taps, mute-while-listening, navigation during transcription, and device removal release every track and never send after cancellation.

### FE-06 — Shared overlays and navigation have incomplete accessibility contracts

**P1 · C02 · High confidence · Observed code; assistive-technology behavior untested.**

The shared `Modal` traps edge Tab movement but does not restore the trigger or make the background inert (`src\design\overlays.tsx:27-90`). `ConfirmDialog` and `PromptDialog` omit its `title`, so the visible heading is not associated with the dialog name (`105-145,186-219`). Chat and studio lightboxes declare modality but lack equivalent focus management (`chat\Lightbox.tsx:51-70`; `images\components\Lightbox.tsx:28-68`). Mobile navigation lacks dialog semantics, focus transfer, and Escape handling (`src\app\AppShell.tsx:125-138`).

Collapsed New chat/Search/Settings buttons lose their text without replacement labels (`AppShell.tsx:49-96`). `SelectMenu`, `Segmented`, and `Menu` advertise composite roles without their corresponding arrow-key/focus models (`ui.tsx:123-200`; `overlays.tsx:237-263`). Markdown image expansion is click-only (`Markdown.tsx:23-28`).

**Recommendation:** a shared tested dialog primitive with labeled heading, inert background, nested-overlay ownership, and focus return; native selects/radios where possible; named navigation links/buttons [F01, F02].

**Proposed acceptance:** keyboard-only completion of navigation, rename/delete, model selection, image viewing, and Library selection; verify accessible names and focus restoration with NVDA/Firefox and VoiceOver/Safari.

### FE-07 — Low-contrast informative text; mobile resilience needs bounded verification

**P1 · C02 · High confidence for contrast; medium for layout risk · Calculated/static.**

Light-theme tertiary text is `#a8a8b3` (`src\design\tokens.css:11,35-45`). Informative navigation labels use it on the `#f4f4f5` sidebar (`global.css:137-145,200-206`); the Library count uses it on the light page (`library.css:351-355`). Calculated contrast is **2.14:1** against the sidebar and **2.36:1** against white, below the ordinary-text 4.5:1 reference [F01]. This calculation is not a rendered screenshot assessment.

Attachment removal targets are 18×18 CSS pixels (`global.css:1302-1307`), requiring spacing/equivalent-control analysis before claiming a WCAG target-size failure: WCAG 2.2's minimum is 24×24 with exceptions, not universally 44×44. The nonshrinking model selector plus app-bar controls also warrants narrow-screen/long-label testing.

**Recommendation:** separate readable secondary information from decorative muted color; provide larger coarse-pointer hit areas and compact overflow controls.

**Proposed acceptance:** verify informative text contrast in both themes; complete key tasks at 320 CSS-pixel width, 200% text, pinch zoom, and keyboard-open portrait/landscape without obscured controls [F04].

### FE-08 — Onboarding “Test all models” tests only chat

**P2 · C01 · High confidence · Observed behavior/copy mismatch.**

`src\features\onboarding\Onboarding.tsx:138-162` saves credentials and calls only `chatComplete`, leaving three model statuses idle. The screen promises one request per model (`250-254`) and labels the action “Test all models” (`278-285`). `allTested` therefore cannot become true through this implementation. The reasoning-effort control (`223-234`) is also absent from the saved `vaultBody` and default-settings write (`115-131`).

**Impact:** configuration appears broader and more verified than it is, while later transcription/image/TTS tasks may fail. A user-selected effort value is discarded.

**Recommendation:** accurately label a chat-only test, or add independently visible capability tests with cost/permission disclosure; persist supported settings and explicitly identify skipped tests. A per-feature “Try” action is a cheaper alternative to automatically spending on every model.

**Proposed acceptance:** mocked requests prove each claimed test actually runs; optional models show Not configured/Not tested; saved effort survives reload [F11].

### FE-09 — Collection requests can show stale or misleading results

**P2 · C01/C03 · High confidence · Observed request handling; races inferred.**

Image-studio refresh has no request identity/cancellation and swallows failures (`src\features\images\imageStudioStore.ts:140-187`); an initial failure becomes “Create your first image” (`components\Gallery.tsx:21-42`). Its pagination uses an old list snapshot. Library protects initial fetches but not a `loadMore` response arriving after a filter change (`LibraryView.tsx:199-213`). Picker ignores pagination and supplies no direct Retry (`LibraryPicker.tsx:32-44,75`).

Conversation search initially reports “No matches” before its debounced request finishes and opens only the thread, discarding the matched message ID (`history\SearchView.tsx:32-41,61-70`).

**Recommendation:** request-keyed results, cancellation/version guards, item-scoped optimistic rollback, preserved stale data labeled as stale, explicit pending/error/empty states, pagination, and message-targeted search navigation [F07, F11].

**Proposed acceptance:** resolve requests in reverse order, change filters during pagination, and search an old turn in a long thread; only current-query results appear and the exact match becomes visible.

### FE-10 — Offline/install/export language exceeds the durability boundary

**P2 · C03 · High confidence · Observed implementation; cold-offline outcome untested.**

`public\manifest.webmanifest:1-38` supplies standalone metadata/icons, but no service-worker registration or implementation was found in reviewed entrypoints, public assets, or Vite/PWA configuration. Local IndexedDB data does not itself ensure the app shell loads offline [F06]. Library and studio refetch remote records; Library-backed asset resolution returns a URL rather than caching its bytes (`syncRepository.ts:139-141`).

Browser data is best-effort unless persistence is granted [F05]. Settings estimates usage, but no persistence request or cache-budget policy was found. “Export all data” produces local JSON, not blob bytes or a complete cloud Library export (`Settings.tsx:1630-1636`; `localRepository.ts:308-320`). Local delete clears database content but not the persisted draft store (`localRepository.ts:342-348`; `state\store.ts:236-245`).

The backend asset-path finding has a **conditional** client dependency: attachment upload records only the returned `blobPath` (`syncRepository.ts:499-508`), while the fallback reader interprets it as legacy thread/asset coordinates (`592-601`). An uncached `user/library/hash.ext` reference without `libraryItemId` becomes thread `library`. However, the backend audit confirms new server-appended attachments are enriched with `libraryItemId`, so an ordinary fresh-device pull should resolve through Library successfully. The mismatch concerns un-enriched/legacy/imported references without cached bytes; existing idempotent rows can bypass enrichment. Test that failure case alongside the normal enriched fresh-device control. This is cross-scope contract evidence, not a duplicate backend finding or blanket attachment-failure claim.

**Recommendation:** publish an explicit offline/export/clear-device matrix. Either cache a versioned shell with safe update behavior or describe installation without promising offline reopening. Distinguish JSON conversation export from a portable backup.

**Proposed acceptance:** warm/cold offline, eviction, expired asset URL, clear-device, and exported-archive checks match the displayed promises; authenticated APIs are never indiscriminately service-worker cached.

### FE-11 — Growth costs are unbounded despite useful optimizations

**P2 · C03 · High confidence on mechanisms; medium on user impact · Inferred performance risk.**

`src\data\local\localRepository.ts:64-68,287-305` loads all threads and sequentially scans their messages for search. `ChatView.tsx:151-165` renders the whole conversation. Every persisted UI update includes all composer drafts (`state\store.ts:145-146,236-245`). Blob object URLs remain in a module map without revocation (`localRepository.ts:9,163-169`); opening the generated-image filmstrip resolves every missing image (`Attachments.tsx:409-420`). Library text preview downloads the full response before truncation (`LibraryDetail.tsx:27-30`).

**Impact:** large histories or image-heavy sessions can increase main-thread work, memory, and downloads. No measured INP, heap leak rate, bundle regression, or latency claim is made.

**Recommendation:** measure representative synthetic workloads first; indexed/paged search, bounded asset leases, incremental previews, and throttled draft persistence. Window long conversations only after preserving search, selection, and assistive-technology access.

**Proposed acceptance:** record typing/search/scroll traces at 1,000 threads, a 500-message thread, and 100 images; adopt p75 field INP ≤200 ms as a later device-segmented target, not an achieved result [F09].

### FE-12 — Recovery/status handling is uneven outside Library and dictation

**P2 · C01/C02 · High confidence · Observed omissions; runtime impact inferred.**

Ordinary assistant text/completion lacks a dedicated status announcement (`src\features\chat\Message.tsx:520-530`); only tools are in a polite live region. Voice status/captions are ordinary divs (`VoiceMode.tsx:234-246`). Some failed asset resolutions leave indefinite loading visuals (`Attachments.tsx:15-22,52-59`). `useChat.ts:128-134` and `useSettings.ts:12-17` have no rejected-read recovery. Bootstrap waits for auth before mounting any React UI (`src\main.tsx:37-42`), and no render/chunk error boundary was found.

**Impact:** a screen-reader user may not know a text-only reply finished; a failed local read or missing asset looks perpetually busy. The connection banner reflects browser online state/auth, not actual API health (`ConnectionBanner.tsx:25-48`).

**Recommendation:** bounded, contextual loading with Retry; durable failed-turn notices; one concise reply-complete announcement rather than token-by-token chatter; distinguish offline, reconnecting, and service unavailable [F03, F11].

**Proposed acceptance:** injected auth/storage/chunk/asset failures always reach an actionable state; screen-reader testing announces completion once without reading historical transcripts again.

### FE-13 — Settings synchronization is push-only

**P1 · C03 · High confidence · Observed client/server contracts; cross-device consequence inferred.**

`src\data\sync\syncRepository.ts:169-170` returns local settings, while `pull:387-403` fetches only threads/messages. No production frontend call to the cloud settings getter was found. Backfill always enqueues `settings.save` (`351-367`), which sends all local settings (`428-430`). New-device initialization/backfill occurs in `src\app\App.tsx:278-293`.

**Impact:** preferences changed on one device do not hydrate another device's settings UI through this engine. A fresh browser can submit defaults before learning existing server preferences. The backend audit confirms supplied settings keys are authoritative and persistence has no revision precondition: this is not only a stale-display problem. The memory audit traces a concrete policy consequence: defaults can overwrite a cloud memory opt-out. That consequence is covered by MEM-01; this finding retains the general settings-authority scope. No real cross-device session was exercised.

**Recommendation:** hydrate account preferences before backfilling; use revisioned, field-level mutations and distinguish device-only appearance/audio-device choices from account policy. Defaults should initialize missing fields, not act as user edits.

**Proposed acceptance:** configure device A, open fresh B, change disjoint fields concurrently, reconnect offline A, and confirm predictable convergence without resetting policy [F07, F08].

## Category improvement proposals and tradeoffs

### C01: make task promises dependable before expanding features

First address FE-03–05 and FE-08; unify accepted/pending/failed/cancelled state terminology across chat, studio, voice, and uploads. Keep the Library's useful error/empty distinctions. Make irreversible actions honest about local versus cloud scope; preserve input after failure.

Prefer a shared small operation-state contract over replacing every feature store. A query library could standardize request identity/retry, but would not fix capture cleanup, dishonest controls, or transactional acceptance. Native browser controls may look less bespoke but simplify reliable selection. **Proposed evidence to reach 6:** ten scripted synthetic journeys spanning new chat, upload, retry, search-to-turn, image remix, and dictation complete without lost work or contradictory state. This is a future acceptance set, not user-research success data [F03, F11].

### C02: repair shared behavior, then verify devices

Fix overlay semantics/names and readable tokens centrally before component-by-component polish. Extend existing role-based tests with focus entry/return and composite-keyboard cases. Add explicit completion announcements, meaningful error associations, and a text alternative to voice-only state.

Choose native `<dialog>`/select/radio controls where their behavior suits the product, or a well-tested accessible primitive layer where adaptive sheets require more flexibility. Either option still requires nested-overlay, mobile-keyboard, zoom, and screen-reader testing. Retain the incumbent neutral visual identity; a visual redesign cannot fix semantic failures. **Proposed evidence to reach 6:** keyboard and assistive-technology checks of all primary tasks plus the FE-07 device matrix, with no known critical task blockers. This is not a WCAG certification claim [F01–F04].

Include reduced-motion and orientation in that matrix. `src\app\ThemeProvider.tsx:36-41` samples the system motion preference when the setting changes, rather than subscribing to subsequent system changes. Some CSS animation durations bypass its motion-scale token. `public\manifest.webmanifest:11` requests portrait orientation: verify installed-app behavior rather than assuming landscape remains available or declaring a conformance failure from metadata alone.

### C03: establish one ownership and durability model

Account scoping and transactional outbox operations precede caching improvements. Define server-authoritative versus local-authoritative fields, settings revisions, conflict rules, retryable failures, and acknowledged deletion. Surface pending count, failed operations, and last successful sync rather than a permanently affirmative “synced” label.

For a personal beta, an IndexedDB operation table plus single-flight draining is smaller than a wholesale local-first framework migration. Cross-tab coordination and database migration still need deliberate tests. If offline editing is not a product requirement, a server-first model with recoverable local drafts is simpler—but reduces disconnected capability. A service worker adds reliable shell availability and update complexity; it must follow, not conceal, identity-boundary work. **Proposed evidence to reach 6:** deterministic identity/concurrency/recovery tests, fresh-device settings hydration, and an honestly verified offline matrix [F05–F08].

## Validation record and cross-scope handoff

Read-only commands included `git rev-parse HEAD`, `git --no-pager status --short`, targeted `git grep`/source searches, the Impeccable context script, one `detect.mjs --json src` invocation, and Python standard-library HTTP/text extraction and contrast arithmetic. The service-worker search returned no matches (exit 1, expected). Detector easing warnings were not promoted: `--ease-spring` resolves to `cubic-bezier(0.22,1,0.36,1)`, so its name alone does not prove bouncing. No application edits, dependency installation, commits, production calls, or full-suite reruns were performed here.

Existing tests read include sequential sync/retry, rapid/cancelled dictation, viewport geometry/cleanup, Library routing/empty/retry, image-store mutation rollback, and same-thread refresh preservation. Missing end-to-end assertions are proposed above, not disguised as test failures.

The shared validator reported **32 frontend test files / 231 tests passing** and a successful production build. Its Markdown chunk measured **614.32 kB minified / 186.30 kB gzip**; this supports profiling, not a measured responsiveness regression. Exact commands, dependency-restoration details, browser prerequisites/results, and remaining limitations belong to the linked validation evidence. These successful baseline checks do not establish coverage of the adversarial schedules and cross-device contracts identified above.

After browser installation, the shared full Playwright matrix reported **36 passed / 16 intentional skips / 8 failed**. A targeted serial rerun reported **9 passed / 1 skipped**; this does not replace the initial result or constitute a clean full rerun. The upload locator's ambiguity was timing-dependent. Seven other failures stopped at initial readiness with “Loading,” before functional viewport assertions. These results indicate harness/startup sensitivity, not demonstrated viewport geometry regressions. Cases use signed-out contexts, development fixtures, and synthetic assets—not live account switching, cloud outbox execution, or Blob roundtrips. Browser automation is not treated as manual assistive-technology or native-device evidence.

Coordinate identity/outbox ownership with backend authorization and storage namespaces; settings hydration and temporary/retention controls with memory governance; image/upload retry and regenerate semantics with server idempotency; service-worker rollout and performance measurement with delivery. Backend deletion/run races and intentionally retained Library assets belong to the backend audit, but deletion copy must describe their resolved lifecycle accurately. In particular, regenerate deletes trailing assistant rows locally (`useChat.ts:308-335`) while repository message deletion is local-only (`syncRepository.ts:305-310`): agree whether old replies are retained as variants or replaced before asserting cross-device regeneration semantics.
