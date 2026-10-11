# Real Environments and Release Gate

Status: DESIGN, NOT IMPLEMENTED. Version: 0.2. Date: 2026-09-12.
No account provisioning, live test execution, remote mutation or deployment is authorized
merely by this document. The reported production failure remains undiagnosed here.

## Real-System Boundary

| ID | Requirement |
| --- | --- |
| ENV-01 | Qualification runs use the actual deployed frontend and real identity/API/storage/realtime/provider paths. |
| ENV-02 | Test identities have normal least-privilege access and no authentication bypass. |
| ENV-03 | Tests may mutate only explicitly owned test data within declared cleanup/spend limits. |
| ENV-04 | All processes and browser interaction remain windowless and cannot hijack user focus/input. |
| REL-01 | Full required candidate evidence must pass before production promotion. |
| REL-02 | Actual production verification must pass after promotion; failed rollout triggers guarded recovery. |
| REL-03 | Trusted enforcement binds evidence to exact artifacts/configuration and rejects missing/stale/failed evidence. |
| REL-04 | A broken production baseline freezes normal promotion, not the ability to qualify a repair privately. |

Public app under discussion: https://prabinpebam.github.io/watai/.
API under discussion: https://func-watai-cbroocyg3omrk.azurewebsites.net/api/health.
These are discovery anchors, not proof of current deployment identity or health.

No development routes, component harnesses, route fulfillment, mocked provider replies,
state injection, fake SignalR messages, seeded successful runs or CSS/font replacement
in real-product qualification. Harmless test documents/prompts are real inputs; answers,
files, identities and service effects must be real outputs. Browser throttling/offline
transitions can test actual behavior; fabricated responses cannot replace those effects.

Use actual public workflow boundaries for the action being evaluated. Administrative
setup via a real authorized API is recorded as setup, never counted as completing the
equivalent UI task. Existing local/mock tests remain valuable lower-layer regression
checks with a different evidence classification.

## Dedicated Identities

| Identity | Purpose | Constraints |
| --- | --- | --- |
| Test A | Ordinary task flows and persistence | Real invited non-admin CIAM identity, dedicated data and funded provider configuration. |
| Test B | Isolation and independent-account cases | Distinct non-admin identity; must never inherit A's browser profile, grants or data. |
| Same-account second session | Reconnect/concurrent-device behavior | Separate browser context/session genuinely authenticated as A. |
| Uninvited identity | Denied-access cases | Normal identity flow, no hidden invitation or privileged fixture flags. |
| Scoped administrator | Admin-only coverage if supported | Separately authorized least privilege; never turn ordinary test accounts into admins. |

Before creating users, inspect the actual CIAM/invitation flow and available authorized
administration. The plan must record who owns each account, allowed environments,
provider limits, credential renewal and cleanup responsibility. Do not invent a tenant
permission or weaken invitation checks because automation cannot proceed.

Secrets come from approved protected storage directly into the hidden test process,
not through assistant messages, arguments, source files, reports or prompts. Saved
Playwright authentication state is a secret: restrict ACLs, expiry and environment/owner
binding, keep it out of Git, and destroy it according to the agreed retention policy.
Using genuine stored sessions does not bypass the separate fresh-login task-flow test.

If MFA, CAPTCHA, email verification or consent needs user interaction, return a precise
bootstrap requirement. Never solve it through token injection, password scraping, MFA
weakening, unsolicited visible windows or an elevation prompt. Interactive exceptions
require the user's explicit request for that particular action; no secret is requested
through a model-visible question tool.

## Data and Spend Safety

Use unique run/scenario namespaces and a manifest of created object IDs. Restrict tests
to dedicated accounts and verify ownership before every destructive cleanup. Use normal
product deletion and preserve required exclusion/audit ledgers; do not wipe containers,
restore data snapshots, erase privacy records or delete arbitrary records by name pattern.

Real generated text/images/audio and semantic reviewers cost money. Each execution stage
needs a reviewed machine-readable decision with wall time, request, token/credit/currency
ceilings, existing evidence, continuation/stop rules and recovery. No default unlimited
full matrix. Gate order is setup/static checks, one canary, focused flows, then required
full qualification. A setup/auth failure never triggers the expensive denominator.

On a budget breach, stop new provider actions and preserve the attempt and uncertain
effects. Do not automatically replay ambiguous requests. Cleanup failures are recorded
and reconciled; success assertions do not disappear because their evidence is inconvenient.

## Browser and Hardware Matrix

### Test State Is Part of the Experiment

Each case declares its initial and final state contract: account role, actual saved
permissions, conversation history, memory learning/read policy, Library contents,
exclusion history, browser cache/session state and relevant pending jobs. Verify these
through normal authorized setup and reads, recording only safe identities and summaries.
An unexpected starting state blocks the case; it is not silently fixed by clearing data.

Use distinct explicit profiles:

| Profile | Purpose | State rule |
| --- | --- | --- |
| Fresh-user/session | Onboarding and clean-path behavior | Legitimate new/known-clean test-owned state; no injected completion or preloaded answer. |
| Existing-user/session | Realistic established usage | Known persisted history/settings/assets; preserve actual migrations and caches. |
| Stateful continuation | Reconnect, learning, deletion and multi-session cases | Deliberately share declared lineage; do not reset between steps or call repeats independent. |
| Independent repetition | Stochastic/timing qualification | Distinct declared state seeds or isolated data; retain model/config and corpus bindings. |
| Old-client compatibility | Long-open tabs during backend/frontend rollout | Keep the genuine prior client/cache, then exercise the compatible new backend. |

Real input fixtures are allowed; fake outputs are not. Setting up a document or approved
memory through a legitimate interface is setup, not proof that its creation workflow
passed. Record setup actions and their actual outcomes. Never import successful run
records or bypass consent to make a subsequent case easy.

Prevent test contamination: repeated prompts may create learned memory, change rank or
invalidate a deletion test. Use planned independent data and inspect the relevant prior
state; do not give the provider or reviewer the expected answer via hidden history.
Failures with unknown side effects cannot be rerun on the same state as if fresh.

Read-only snapshot/identity comparison detects drift but does not prove absence of all
hidden state. When independence cannot be established, report the dependency and narrow
the claim. Never erase exclusion/consent ledgers to simulate a fresh account. Serialize
destructive cases sharing an account; use separate contexts/accounts and declared barriers
for intentional concurrency. Cleanup is owned and bounded, with failures retained for
reconciliation; it must not race the next case or run against real-user data.

Use real headless Chromium, Firefox and WebKit as required by the frozen support matrix.
Start with one Chromium canary, then expand after readiness and recording pass. Use
isolated profiles/contexts with real assets and normal security settings. Record versions,
viewport, DPR, locale, timezone, theme, text zoom, reduced motion and actual configuration.

Headless browser operation is real browser execution, not mocked UI. Its limitations
must still be disclosed: emulated touch/viewport is not an iPhone, browser permission
grant is not actual microphone input, and a downloaded stream is not proof of native
share-sheet behavior. Real microphone/speaker, installation, native sharing, assistive
technology and physical-device flows require separately obtained evidence. If required
evidence cannot be obtained without interfering with the user, keep that coverage blocked.

No OS mouse/keyboard automation, bringing pages to front, focusing terminals, opening
trace/report windows, or attaching to the user's browser. Use the existing hidden native
runner and quiet task presentation. Every child process inherits no-window/captured-I/O
constraints. Close only test-owned processes. The watchdog remains check-only; it cannot
authorize spending, sign evidence, repair an app or promote a deployment.

## Two Release Boundaries

It is impossible to test new deployed bytes before deploying them somewhere. Therefore:

1. Preserve the serving frontend/API artifacts and configuration identity with exact
   code-only rollback commands. Confirm there is no concurrent production drift.
2. Deploy the isolated immutable candidate privately to a real compatible environment,
   backend first. This is a candidate deployment, not production promotion. It requires
   separate authority and must not consume production queues or real-user records.
3. Run the full required real-service case matrix against that exact candidate. Match
   configuration/feature flags, auth behavior and provider model identity; no bypasses.
4. Admit independent evidence only when capture health, deterministic, semantic, DS and
   existing DoD gates pass. Required skipped/blocked/incomplete cases prohibit promotion.
5. Promote the same verified frontend/API artifacts, never rebuild different bytes after
   qualification. Bind environment-specific configuration separately and qualify its
   differences. Do not bundle the large dirty working tree.
6. Verify the actual public deployment: artifact identities, real authenticated critical
   tasks, chronology/paint and relevant service effects. Define the safe production subset
   before mutation and map every other required case to exact-candidate evidence; unsafe
   production-only gaps are blockers, not silent omissions.
7. Maintain real-production qualification and drift checks for all applicable safe flows.
   A critical live failure freezes further promotion and begins incident recovery.

Private-candidate evidence alone is not evidence that production works. Public health
and HTML/asset responses alone are not authenticated task-flow verification. Production
checks must include real test-user behavior and actual visible outcomes.

Broken production must not create a deadlock where no repair can be qualified. Normal
features remain frozen while an isolated incident repair is validated. An emergency
restore uses an already addressable, evidence-backed compatible target under explicit
incident authority; it does not waive safety or turn an unverified candidate into LKG.

### Environment Equivalence and Mixed-Version Exposure

Before promotion, record an explicit candidate/production delta table: frontend bytes,
API package, runtime, identity issuer/audience/redirects, origin/CORS/CSP, flags, queues,
schema/index state, credential/provider/model identities, CDN/service-worker caches and
observation capability. Secret values are not copied into that table. Classify each delta
as equivalent with evidence, intentionally different with mapped production checks, or
unqualified. Matching source commits alone is insufficient.

An allowlisted test origin or test-only auth bypass does not prove the public origin.
Use actual identity redirects and deployed assets. Capture target identity at start/end
and relevant navigation/service responses; a mid-run deployment/config/model change
invalidates the affected evidence. Unknown serving identity is not presumed compatible.

Exercise the rollout's real mixed-version states: old frontend/new API, new frontend/new
API, stale cached assets, in-flight jobs and the retained rollback combination. Before
any mutation, prove the retained code can read current records and honour current consent,
exclusions and worker fencing. A "code-only rollback" is unsafe if old code cannot handle
new data fields, jobs or permission semantics. Such incompatibility blocks promotion until
an authorized compatible expand/contract or recovery plan is qualified; never restore old
data, remove exclusions or bypass checks to make rollback work.

Full required real-deployment evidence remains mandatory. A cheaper production canary is
an additional rollout safety check, not a replacement for the full gate or permission to
ignore production-only gaps. Service/model drift after a pass requires bounded relevant
requalification; it is not covered forever by yesterday's green report.

## Enforcement, Not Documentation Alone

The proposed release verifier must check the locked coverage matrix, artifact/config
digests, account roles, recorder capability/calibration, capture completeness, DS/rubric
versions, all findings and independently authenticated evidence provenance. Local reports
and SHA-256 values alone do not establish that provenance.

Use the existing [DoD authority and hard gates](../implementation/2026-09-10-autonomous-delivery/02-definition-of-done.md).
This specification adds real-experience requirements, never replaces G00-G12 or grants
the builder authority to sign its own pass. The evaluator registry must distinguish
local deterministic, recorder calibration, real candidate and real production evidence.

All production mutation entry points must require the admitted, exact-candidate release
permit. If operators or scripts can publish without checking it, enforcement is not
complete. Changes to those credentials/permissions require separate authorized work.
Current documentation does not claim that such external enforcement already exists.

Reject changed source/config/artifacts, stale evidence, missing required cases, unresolved
warnings, unreviewed semantics, unknown capture loss and hidden retries. Changed test or
capture policies require matching evidence. Do not silently reduce the denominator or
update visual baselines to match a failing product.

## Recovery and Release Receipt

On a failed post-promotion critical check, stop rollout and perform the declared
conditional code-only rollback. Check that expected deployment identities still match;
never force over concurrent changes. Preserve consent, deletion, privacy, data and index
ledgers. Previously identified secret-bearing backend archives are not eligible rollback
artifacts; use only verified sanitized, compatible packages.

Receipts record frontend/API source and artifact identities, configuration, provider
identity, exact publication/activation/observation times separately, test accounts by
alias, case/evidence versions, failed attempts, rollback target and manual limits.
Settings > About must describe actual shipped benefits and verified deployment times,
not a proposed future release. Monitor-only watchdog status is not delivery progress.

## Current Blockers

- Current production breakage has not been reproduced in this planning task.
- Dedicated legitimate test accounts, protected auth state and provider budgets are not provisioned here.
- The live flow denominator and approved visual reference set are not verified complete.
- The recorder, multi-layer evaluators and enforced production permit are not implemented by these documents.
- Private environment equivalence, authenticated workflow and physical-device evidence remain required.