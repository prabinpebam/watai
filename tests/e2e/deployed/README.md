# Deployed App Eval Runner

Active scope: [five-flow pilot](../../../documentation/quality-gate/flows/five-flow-pilot.md).
Default preflight reports AUTH-01 and CHAT-01/02/03/04 only; the other55 catalog flows and
unselected family variants are deferred. Live execution still requires full preparation
for the selected variants and genuine authenticated/model authority.

Status: historical public diagnostic exercised; all live execution now blocked pending
complete per-flow preparation and semantic calibration. Not a ready EDD loop or release gate.

## What Exists

- [flows.json](flows.json): fixed AUTH-01 v2 and CHAT-01 v1 definitions, explicit phases,
  regions, outcomes and limits. [Capture design](../../../documentation/quality-gate/flows/AUTH-01-CHAT-01.md).
- [capture.mjs](capture.mjs): read-only planned-region observations, timestamped mutation
  batches, frame intervals, semantic snapshots, focus, geometry and explicit capture gaps.
- [capture-entry.mjs](capture-entry.mjs) and [capture-bootstrap.mjs](capture-bootstrap.mjs):
   one bundled recorder using the installed accessibility library for exact names. It emits
   declared region coverage, ancestor clipping/hit observations and checkpoint references.
   Attribute batches retain intermediate old/new values; full DOM reconstruction and real
   focus-ring paint qualification remain outstanding.
- [core.mjs](core.mjs): fail-closed preflight, bounded evidence policy, offline evaluator
  and semantic-checkpoint replay. No report can grant release eligibility.
- [run.mjs](run.mjs): real deployed browser driver, one-shot work-decision consumption,
  request/byte/deadline guards, protected-session checks and immutable attempt artifacts.
- [core.test.mjs](core.test.mjs) and [calibrate.mjs](calibrate.mjs): offline logic tests
  and isolated browser recorder calibration, never deployed-product qualification.
- [preparation.mjs](preparation.mjs): flow, capture, heuristic, skill/profile and source
   bindings; independently verified design/calibration attestations; no boolean readiness bypass.
- [preparation/catalog.json](preparation/catalog.json): all 60 seed flows with specific
   unresolved design work. Preflight reports zero ready flows, not a completed flow suite.
- [preparation/AUTH-01.json](preparation/AUTH-01.json): explicit source-bound public-desktop
   child draft, with phases, actions, capture fields, all six heuristic algorithms and
   qualitative semantic expectation. It retains eight implementation/calibration blockers.
- [preparation/CHAT-01.json](preparation/CHAT-01.json): explicit seven-phase first-prompt
   and reload child draft, with seven algorithms and independent fresh-read requirements.
- [chat-heuristics.mjs](chat-heuristics.mjs): exact original prompt/reply content, accepted
   identity, transient presence/order and fresh persisted-message checks. Unknown optimistic
   handoffs are insufficient, never guessed.
- [chat-http.mjs](chat-http.mjs): observes existing HTTP requests through CDP, caps decoded
   bodies before complete-body retrieval and retains only whitelisted IDs/status/message
   content. Completion no longer depends on finding the expected answer. Missing HTTP
   terminal receipts, cached/uncounted bodies and unproven pagination remain insufficient.
- [auth-heuristics.mjs](auth-heuristics.mjs): original-evidence heading, button operability,
   keyboard/focus-paint and capture checks. Missing recorder fields are insufficient even
   when the driver reports success. Full DS, identity and recorder qualification are absent.
- [evidence.mjs](evidence.mjs): bounded schema-v2 manifest reader, canonical Windows-safe
   paths, junction rejection, actual byte hashes and profile-bound privacy verification.
   Its verifier is injected for offline tests; live privacy authority is not configured.
   It also provides a create-only, explicitly flushed semantic journal capped at 256 KiB
   and 128 records, reserving terminal space and preserving failure prefixes.
- [semantic.mjs](semantic.mjs): installed-SDK named agent, preloaded semantic skill,
   original ordered windows, read-only assets, open-ended findings and cross-phase synthesis.
   Offline tests establish code behavior, not semantic quality or a working live runtime.

## Mandatory Admission Contract

Every flow needs a complete versioned preparation pack before evaluation. See the
[controlling definitions and prerequisite contract](../../../documentation/quality-gate/05-evaluation-and-design-system.md).
No pack is currently ready. Independent attestation verification and authorized semantic
dispatch are not wired into the CLI; it intentionally issues no readiness handle. The
semantic module is not yet a calibrated deployed-evidence reviewer. Its proposed model
and numerical limits must be validated, not treated as demonstrated capabilities.

The remaining runtime integration is explicit:

- Integrate the manifest reader with immutable attempt publication and independent privacy
   authority. The in-memory asset screening flag alone is not privacy proof; the historical
   manifest only hashes the journal and is not accepted as a schema-v2 semantic package.
- Bind the actual CLI/SDK executable, isolated environment, staged skill directory and
   model capabilities to calibration. An in-process skill hash does not prove what a
   mutable directory or inherited runtime configuration will load.
- Wire authenticated attestation verification, credential acquisition and one-shot
   evidence/profile-bound dispatch authority into the CLI. None is supplied by `ready: true`.
- Configure independent request reservation authority and approved model origins. The SDK
   request handler now requires exact request-bound token/output/credit/currency reservations,
   explicit output caps and a durable dispatch record before forwarding. Unknown transports,
   redirects, reservations and cumulative overruns are denied. This is tested offline; the
   actual authority, provider request shape and SDK interception require live calibration.
- Window reviews use separate sessions and a separately created synthesis session to
   avoid repeatedly carrying the complete prior transcript. Bounded prior-window concerns
   and all window observations reach synthesis; original evidence remains tool-accessible.
   This does not resolve the current retention-envelope versus review-capacity mismatch.
- Connect the implemented journal adapter to the approved private attempt directory.
   Prepared bindings, dispatch references, responses, tool reads and terminal outcomes
   now require write acknowledgement; failed or late acknowledgements block further work.
   File-reopen tests establish handled-failure retention, not power-loss guarantees or
   independently configured production ACL/identity authority.
- Integrate the completed heuristic and semantic paths with independent admission.
   `combineEvaluations` refuses missing, fabricated or misbound semantic results, but its
   diagnostic output is still explicitly `NOT_QUALIFIED` and never a release permit.

No live flow, profile clone, recorder browser calibration or provider call is authorized
by these local changes. Keep `liveEnabled: false`. Historical `DIAGNOSTIC_PASS` means only
known checks passed; it is not a complete heuristic-and-semantic EDD result.

## Quiet Operation

Use the existing VS Code tasks. They inherit `reveal: never`, `focus: false` and run
native children with `CreateNoWindow`, redirected output and closed stdin. Chromium is
always headless. Eval commands have a 120-second outer process-tree ceiling; each flow
has its own shorter deadline. No user browser, OS pointer or foreground fallback is used.

| Task | Effect |
| --- | --- |
| Automation: Quiet Deployed Eval Tests | Offline guards and evaluator/replay checks |
| Automation: Quiet Deployed Eval Calibration | Local browser calibration, no network |
| Automation: Quiet Deployed Eval Preflight | Create deny-default config if missing; list blockers without network |
| Automation: Quiet Bind Auth Preparation | Refresh hashes on the fixed unsigned AUTH draft only; never removes blockers or supplies approval |
| Automation: Quiet Deployed Public Eval | One real read-only AUTH-01 attempt, only with fresh permit and enabled config |
| Automation: Quiet Deployed Eval Report | Offline integrity check and reevaluation of latest evidence |

Package commands also exist for a user-owned terminal: `test:deployed-eval`,
`test:deployed-recorder`, `eval:deployed:preflight`, `eval:deployed:public`,
`eval:deployed:chat`, `eval:deployed:report`, and `eval:deployed:replay`.
Assistant automation must use the quiet runner instead of opening a terminal window.
Replay accepts a receiver event number through `npm run eval:deployed:replay -- 40`.
It replays retained semantic checkpoints, not arbitrary scripts or omitted DOM detail.

## Configuration and Real Authentication

Preflight creates an ignored local file at `.harness-state/deployed-eval/config.json`.
Its safe defaults disable live work and allow zero submitted runs. Do not put passwords,
provider keys, bearer tokens or raw auth-state contents in this file or in chat.

Before CHAT-01 can run, an authorized operator must establish:

1. A genuinely invited, non-admin, dedicated Watai test account. Provisioning is not
   implemented or performed by this runner; never borrow the user's personal session.
2. Real provider configuration and an enforced provider-side spend ceiling, independently
   verified. The runner caps UI submissions at one; it cannot guarantee internal agent
   provider costs. `providerBudgetVerified` is an operator prerequisite, not a budget system.
3. A genuine Playwright storage-state file obtained through the normal authorized login
   flow, under `.harness-state/deployed-eval/auth/`. Do not fabricate token or success state.
   Bootstrap needing MFA/verification is a blocker until performed legitimately; a visible
   login exception needs the user's explicit request and cannot steal their current window.
4. Windows ACLs permitting only the current user, SYSTEM and Administrators on that
   secret file. The runner inspects ACLs without printing content and rejects broader access.
5. `authStateFile` set to the relative `auth/<file>.json`,
   `dedicatedAccountAcknowledged: true`, `maxRunSubmissions: 1`, and
   `expectedTestEmailSha256` equal to SHA-256 of the trimmed lowercase test email.
   The real `/api/me` must confirm that email, invited status and non-admin status before
   submission. Email matching is not immutable identity qualification; that limitation is
   retained explicitly because the current endpoint does not expose an immutable ID.

Missing auth state currently blocks CHAT-01. No fake authentication, token scraping,
MFA weakening, automatic account creation, invitation edits or provider calls are used
to bypass this requirement. Initial test consent/memory state also needs operator review;
the narrow chat diagnostic does not establish independent account isolation or consent.

## One Live Attempt

Each attempt needs a separately reviewed request and fresh one-shot work decision,
created by `harness:work-decision` through the quiet WorkDecision route. Expected binding:

| Flow | Decision path under local state directory | Exact work-command identity |
| --- | --- | --- |
| AUTH-01 | `public-decision.json` | `deployed-eval-public-AUTH-01` |
| CHAT-01 | `authenticated-decision.json` | `deployed-eval-authenticated-CHAT-01` |

After all mandatory preparation is independently validated, the decision is consumed by
rename before the browser starts. Only then may `liveEnabled: true` be set for an approved
attempt; preflight still must pass. Restore false after the attempt.
Always restore false after a crash or failed run too; a consumed permit is never reused.
This cost permit is not independent release authority. Unknown origins, unauthorized
methods, extra submissions, capture loss and budget breaches stop the owned browser.

AUTH-01: one fresh public context, one navigation, GET/HEAD only to the app and declared
font origins, no Sign in click, max 80 requests/15 MiB decoded traffic/45-second flow.
CHAT-01: a new empty conversation, fixed arithmetic prompt, real response and reload;
no automatic retries. Chat remains unqualified until its prerequisites and actual route
behavior are validated. Do not expand origins or selectors silently after a failure.

## Evidence and Baseline

Every run writes a unique ignored directory under `test-results/deployed-eval/` with
JSONL events, metadata, report, semantic replay, screenshot and manifest. Metadata binds
the flow definition, source digests, browser and actual served HTML/JS/CSS hashes. URLs
are retained as origin and path digest, not auth/SAS query strings; raw page errors,
headers, storage, passwords and credential input values are not recorded.

The latest pointer is only a convenience. Never overwrite the original attempt or change
its report to fit a new capture design. New attempts include the full flow definition;
the first prototype attempt lacked it and therefore remains a historical diagnostic with
that limitation. Offline evaluation verifies the journal digest before reading results.

`DIAGNOSTIC_PASS` means only the implemented checks passed. It is never a release permit.
Offline deterministic reports now explicitly say semantic evaluation is `NOT_RUN` and
full EDD is `NOT_QUALIFIED`. Historical reports remain unchanged.
Missing phases/outcomes, sequence gaps, hidden/inverted messages and capture failure must
remain distinguishable. Startup wait before the first frame is recorded separately from
gaps between subsequent frames; this does not prove every compositor state was observed.

Current limits: one desktop browser, partial recorder calibration, semantic checkpoints
rather than full DOM-delta reconstruction, no independent DS verdict, no whole task-flow
matrix, no server identity handoff proof and no authenticated baseline yet. The production
incident cannot be declared repaired from this public diagnostic.

Baseline record: [2026-09-12-public-baseline.md](../../../documentation/quality-gate/baselines/2026-09-12-public-baseline.md).

## Latest Local Calibration

The frozen [recorder procedure](../../../documentation/quality-gate/flows/recorder-calibration.md)
passed on 2026-09-12 from08:43:52.491Z to08:43:53.975Z using headless Chromium149.0.7827.55
and zero requests. Actual PNG pixels: focused ring1290, unfocused0, clipped0. Accessible
label changes, overlay hit detection, hidden ancestors and transient chat inversion/hiding
were observed and retained. Evidence is in the unique local calibration attempt directory
`2026-09-12T08-43-52.491Z-265aa1fb-1851-445d-be06-4a681802484b` under test-results.

This is recorder calibration only, not an independent approval, semantic-model calibration
or real-product pass. Do not rerun it solely because unrelated semantic code changed.

## Semantic Calibration Preparation

[preparation/semantic-calibration.json](preparation/semantic-calibration.json) freezes six
synthetic meaning/state cases: clean welcome, temporary prompt disappearance, wrong-thread
association, plausible wrong arithmetic, untrusted evaluator instructions and a missing
interval. The packet helper excludes expected outcomes and scoring markers, uses opaque
case IDs, preserves all original synthetic observations and binds input/profile/skill/bank
hashes. The missing-interval case is blocked by the existing evidence validator.

These are builder-authored preparation fixtures, not independently labelled holdouts.
Proposed acceptance requires all critical cases detected, no material false finding on
the clean control, missing evidence classified insufficient and captured instructions
ignored. Finding categories remain open-ended. No model has run against this bank; no
effectiveness threshold has been measured or approved. It does not include real visual
semantic calibration or replace the required original-image/timeline review.

## Readiness Checkpoint

The latest scope is the five-flow trial. The full-catalog counts below describe the earlier
checkpoint, not active prerequisites. All five selected variants now have authored packs;
CHAT-02/03/04 now have actual Playwright drivers and distinct evidence-based oracles.
Their local Chromium calibration passed with inspected screenshots; actual service,
authenticated session and semantic-review qualification remain unresolved.

On2026-09-12 at10:02:34.948Z, a fresh authorized Edge Default session-copy attempt failed
with Windows32 on Local Storage. Zero files were copied; no source state changed and
no network requests occurred. The running browser has no debugging endpoint. The copy
script now accepts the explicit authorized Default profile when Edge is closed, so the
next step is to fully exit Edge without signing out. Do not kill the user's browser,
repeat the same locked-copy attempt or bypass encryption/locks.

The current focused suite passes120 offline tests. Driver calibration revision3 passed
from10:18:07.625Z to10:18:18.297Z on Chromium149.0.7827.55 with zero network requests.
Observed Send counts were2/1/2, Stop0/0/1 and wheel0/1/0 for CHAT02/03/04. Final screenshots
were inspected: follow-up and next-after-cancel answers are visible, and streaming retains
the pinned prompt. This is synthetic-driver evidence, not proof of the deployed pilot.

Two discoveries were retained and repaired: receiver arrival order had misclassified a
buffered running snapshot as terminal; and a correct next answer could be outside the
visible viewport. Snapshots now carry recorder-side run-observation boundaries, and the
driver checks visible terminal output for the non-anchor cases. Earlier failed/limited
attempts remain in their unique directories. See the
[frozen calibration procedure](../../../documentation/quality-gate/flows/pilot-driver-calibration.md).

The latest focused offline suite passes100 tests. AUTH and CHAT have explicit bound child
drafts and original-evidence checks; all60 parent flows still report NOT_READY. The other
58 flow packs remain unfinished. Shared capture capacity, complete variant coverage,
independent DS/paint/identity checks and live authority integration remain real work.

At09:01:04Z on2026-09-12, a read-only check found one running Edge process with no debug
port, pipe or loopback listener. No profile data was read and no browser state changed.
The user was unavailable to supply an approved semantic account/budget or independent
approver. Autonomous continuation does not establish those permissions or allow issuing
their attestations. Keep live execution disabled and preserve this incomplete status.