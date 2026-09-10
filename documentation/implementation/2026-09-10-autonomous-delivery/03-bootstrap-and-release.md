# Bootstrap, staged release and unattended failure policy

**Design only.** Nothing here was provisioned, enabled or deployed. RR source IDs
come from parent-owned release research, preserved in the research ledger.

## 1. Bootstrap has an honest starting point

The audit did not query production runtime/configuration, prove deployment
identity, establish restore, or pass a full browser release gate. GitHub Pages
serves `master/docs`; Functions deployment is manual; no tracked workflows were
found. Do not turn that into "production is validated" by renaming a manifest.

H01 produces an **observed-baseline record**, not a promotion permit: source
identity if recoverable, deployed byte hashes, Pages source/build type, runtime,
region, capability/config revision, dependency/infra revisions, data/key versions,
routes, queue ownership, known risks, unavailable observations and safe containment
options. Unknown fields stay unknown. Preserve the serving baseline and immutable
backup artifacts before changing the publishing path. If it cannot be recovered,
record this as a bootstrap blocker, not a fabricated LKG.

No production access is needed to write this design. Future H01 can inspect only
through preauthorized read-only machine authority. It must not enumerate secret
values; secret version IDs/config references suffice.

### Explicit first-release contract R0

H06 establishes the first minimally validated LKG after H02-H05 and
S01/S02/S04/S06. R0 is deliberately **restricted read-only history, local draft
recovery and truthful controls**, not ordinary generation. Server generation,
asset grants, destructive operations, outbox transmission and memory use/learning
are disabled at server and worker boundaries until their own dependency closure
passes. Account settings preserve the stricter authoritative revision. The UI
explicitly explains reduced capability and retained-data scope.

This initial owner/policy/authority batch is irreducible: the current unproved
release cannot provide a safe foundation by assumption. It no longer holds the
first safe release behind all ten chat repairs. Independently safe contrast,
voice cancellation, inventory, onboarding and request-race improvements can ship
as soon as R0 exists. R1 normal chat requires S03/S05/S07/S08/S09/S10 in addition;
R2 Saved-only requires S12/S13/S14. Compatible flag-off slices ship individually,
then a separately evidenced capability-envelope activation restores service.
S01 only contains temporary mode; S49 delivers the actual final capability.

`policy.capabilityEnvelopes` is the closed machine registry: R0 restricted,
R1 ordinary chat, R2 Saved-only, R3 hybrid/learning, RT temporary over R1, R4
combined final capability. Every known capability is allowed or denied; unknown
capabilities deny. An envelope's requirements are the union of its own slices/
gates, inherited envelopes, and transitive slice dependencies. Its digest binds
the full inherited registry material, not just a mutable ID. Deployment config
observations and each cohort/full permit bind that ID/digest; gate selection unions
envelope gates, common gates, productMandatoryGates and impact/slice gates.

For initial R0 only, its four explicitly named product prerequisites may substitute
independent candidate-valid receipts for prior shipped receipts in the **same
atomic bootstrap activation**. Control-plane prerequisites must already be active.
H06 publishes their first release receipts together after observation; no other
envelope can use this substitution. This avoids requiring a shipped R0 before
creating the first R0 without removing safety evidence. The synthetic example
models the receipt identities, not actual verified deployment receipts.

Envelope allowance never grants account consent or tool permission: effective
capability is the intersection with current account policy, runtime provider
capability, revocations and budget. A rollback envelope cannot re-enable a revoked
capability even if its bytes were previously validated. Fresh provider/version
and configuration observations must prove disabled paths cannot execute.

G00-G05, G07-G10 must pass for the exposed R0 envelope; a disabled path must reject
at the server/worker too, not merely disappear in UI. Full deterministic/browser
inventory still executes: disabled capabilities assert honest unavailability,
not a silently skipped test. Relevant old regression expectations are updated
through the independent evaluator workflow **before** product evaluation, with
fixed disabled-state assertions and retained future-capability tests. Containment
must not overwrite target labels or close the underlying findings.

At the first-ever activation there is no previously validated public LKG. A
bootstrap-only permit therefore binds the observed baseline and an independently
staged, admissible **R0 standby tuple** as recovery target; it does not label the
old deployment safe. H05/H06 must prove standby routing/config and the same
restricted envelope before initial cutover. The `lkg-admissible` guard accepts
this explicitly marked bootstrap recovery target only under the preauthorized
bootstrap rule. If that fallback cannot be established, block initial cutover.
Later releases require the normal previously admissible LKG rule.

R0 is not final DoD, not proof of every legacy behavior, and not proof that all
existing user data is correctly migrated. Ambiguous ownership remains quarantined
with visible recovery status. This is the minimum gate for beginning safe ongoing
promotion, not permission to suppress future findings.

## 2. Preflight: no hidden human step

| Capability | Machine proof before dispatch | Unattended failure action |
| --- | --- | --- |
| Authorization root | Signed allowlist of repositories, environments, operations, models, budgets and identities | No mutation; `BLOCKED_SAFE` |
| GitHub operations | App installation/dispatch/check APIs, branch rules, Pages authority; negative forbidden-scope probe | Use already authorized explicit-dispatch fallback, otherwise block |
| Agent provider | Available pinned SDK/runtime/model, valid noninteractive auth and refresh, deny-by-default tools | Switch only to preauthorized adapter; otherwise block |
| CI execution | Fresh runner, lockfile install, toolchain hash, test inventory, no approval-required runs | Reconcile dispatch; never ask someone to click approval |
| Azure release | Existing federation and narrow roles; region/capability checks; independent app/data/queue endpoints | Block infra-dependent slice; never grant own role |
| Browser/device/auth | Deterministic synthetic identity and supported unattended browser/device API, actual auth-path probe | Unsupported matrix cell; restrict claims/features; block if required |
| Evidence | Immutable storage, signing/verification, clock, retention, restore and epoch checks | Freeze new acceptance/promotion |
| Budget | Available signed money/token/runtime/quota reservations plus rollback reserve | Defer until authorized reset or terminal block |
| LKG/rollback | Addressable valid previous tuple, schema compatibility, routing and job-drain rehearsal | No promotion; do not overwrite the only usable release |

No interactive `az login`, `gh auth login`, MSAL consent prompt, CAPTCHA, MFA
workaround, password collection or paid study is on the path. Token expiry gets
one authorized refresh attempt then a bounded infrastructure retry. Credential
revocation or missing scope never triggers permission escalation. Expiring
machine authority can cause indefinite safe blocking; zero-human control does
not imply guaranteed progress under absent authorization.

The repository appears personal (`prabinpebam/watai`); do not assume
organization-only Copilot Actions billing works. R03 documents that path's
organization policy and installation requirements. Prefer a separately
preauthorized BYOK provider proxy or eligible organization credential; current
SDK docs conflict about managed identity support, so select a tested
version-specific path. App credentials for repository operations are **not**
automatically valid Copilot model credentials. Standard `GITHUB_TOKEN` recursive
push/PR behavior cannot be the unattended scheduler (RR05).

### Budget contract

The distributed spend ledger atomically reserves worst-case **all** builder,
reviewer, adversary, evaluation, retry and tool cost before dispatch; subtracts
actuals only from trustworthy receipts; unknown usage retains the full reservation.
Proposed maximum caps, **not granted spend**:

| Pool | Hard cap and handling |
| --- | --- |
| Product candidate | USD 20, 1.2M input tokens, 120k output tokens, three attempts total |
| Engineering day | USD 100, no borrowing from future day; UTC calendar boundary |
| Held-out evaluation | USD 75/run, estimated from smoke usage before reservation; at most one expanded run/day |
| Infra/runners | USD 150/month incremental, 6 runner-hours/candidate; include warm capacity and routing/probes |
| Recovery | USD 20/month reserved separately for deterministic recovery/probes; no model activity required for rollback |

All caps are ceilings subordinate to an actual preauthorization document; the
checked-in policy has `authorizationGranted: false`, effective spend **zero**.
Provider pricing must be timestamped and worst-case reservations include output,
cache misses, failed requests, tool/embedding/judge calls, Azure RU/storage,
network and runner costs. Unknown pricing => no paid dispatch. Infrastructure
cost cannot be perfectly capped with a software counter after allocation; resource
quotas, max instances, expiration and preallocation bounds are also required.
If unavoidable fixed costs exceed the authorized pool, block that topology.
Reserve rollback capacity before a release; never turn off the current product
just to pay for an agent experiment.

## 3. Retained-platform deployment design

Use separate staging auth, data, queues and keys; synthetic users only. Candidate
builds never connect to production. Use independently addressable Function apps
or equivalent verified immutable versions for active and next production releases.
The preferred production HTTP boundary is a small deterministic authenticated
release router with a versioned allowlist/route manifest; Azure Front Door
Standard/Premium is an optional edge in front, not the policy engine.
Provisioning either requires preexisting authority and budget.

Flex **does not support deployment slots** (RR01). Rolling site updates (RR02)
are not a substitute for independent LKG: eastus2 support is not established by
the current GA-region list, single-instance rolling can interrupt, old/new code
overlap and there is no documented completion signal. Never update the only
LKG app in place to stage a candidate.

Public routers include only admissible validated releases. Candidate origins
remain disabled or outside public origin groups until authorized. Front Door
routes round-robin across all origins if all are unhealthy (RR08); "unhealthy"
is not a quarantine boundary. Deterministic account cohorts at the router fit
low traffic better than percentage weights. A header supplied by a public client
is not authorization to reach a candidate: route choices are server-derived and
checked against the signed release allowlist.

### Pages and frontend identity

Keep the current Pages URL as the entry point. First preserve the existing
frontend snapshot, then add immutable release directories such as
`releases/<release-id>/` and a small stable bootstrap/manifest path. Each release
URL remains independently addressable. GitHub Pages has one publishing source,
not a native canary slot or globally atomic swap (RR03/RR04). A candidate preview
lives in isolated staging hosting, not the public Pages origin.

Publishing the Pages archive includes retained LKG release directories unchanged;
never delete old hashed chunks on the next deploy. Validate archive shape,
size limits, symlink/hardlink prohibition and public-content safety. Retain at
least current + two previous compatible release assets for 30 days; keep any
version still referenced by the supported-client window longer. Storage limit
pressure blocks promotion until a preauthorized archival policy can preserve
addressability; do not silently remove fallback files.

The bootstrap can see an old cached manifest or a new one. Both must name complete
compatible release sets, never a mix. Unknown/missing manifest => retain cached
admissible release or show explicit safe error with a retained LKG URL, not load
candidate `main.js`. A malicious/invalid manifest is rejected. Manifest signing
and trust-key rotation are independently managed; frontend code cannot be the
sole authority for backend routing.

Vite embeds build-time environment values. Choose a small separately fetched,
schema-validated **attested runtime config** for environment endpoints/auth/public
capabilities so the identical frontend bytes can pass stage and promote. The
config is a separate tuple subject; no secrets. If runtime config is not yet
implemented, build the production-configured artifact once and validate those
exact bytes in isolated routing; an environment-specific rebuild invalidates
stage evidence. API URL, auth client/audience, redirects/base path, CSP/CORS,
service-worker scope (if introduced later) and cache policy all belong to the
compatibility contract. No unvalidated public Pages publication "just for preview."

### Queue and data release pinning

HTTP pinning is insufficient. Admission stamps each job with release/protocol
version, owner, idempotency key, policy/exclusion epoch and queue generation.
Separate version-specific queues/worker pools prevent a candidate consuming live
LKG jobs. Workers verify release eligibility and fenced claim before effects.
After promotion old accepted work drains on its eligible worker version; new
admissions target the new queue. Replays retain original idempotency receipts.

Rollback stops new admission to the revoked queue, requests cancellation/fencing,
and reconciles its in-flight provider actions; it does not move raw old messages
to another queue and pay twice. A known incompatible/unsafe old worker cannot
drain indefinitely: terminally fail/cancel affected work with a visible reason,
preserving drafts/output already committed and privacy exclusions.

Schema changes expand first, read current/previous, backfill resumably with
owner-proof and dry-run counts, switch writers with fences, contract only after
the client/rollback window. Rollback restores **code**, never old consent,
revocations, corrections or deletion tombstones. No cross-container "atomic
migration." Use generation-head CAS or ledger/reconciliation per actual partition.
Two prior frontend versions must either work with current API/schema or receive
an explicit refresh-required state without dropping drafts.

## 4. Stage and promote the identical candidate

1. **Build/evaluate:** freeze source and all input subjects; clean trusted build,
   fixed deterministic/browser checks, independent review/adversarial evidence.
2. **Isolated stage:** deploy exact bytes plus stage config attestation; execute
   migration/cancel/replay/restore and actual identity/provider capability probes.
   Mocks are labeled and cannot satisfy required real-integration gates.
3. **Eligible production shadow:** after G00-G09 pass, release broker may provision
   an isolated production-ready app that still has **no public traffic or live
   queues**. Validate production config, bindings, endpoint health and disablement.
4. **Isolated synthetic canary:** synthetic accounts on an isolated authenticated
   production-configured endpoint, not a public route or organic users.
   At least 60 complete critical
   journeys over 30 minutes; zero safety/terminal/digest errors, no unexplained
   missing probes. Paid model probes are sparse budgeted jobs, not edge health.
5. **Authorize cohort routing:** independent verifier rechecks G00-G09, current
   epoch, LKG, all digests/config and migration head, then issues a new single-use
   `rolloutPhase=cohort` permit with exact authenticated account scope, manifest
   digest, nonce, expiry and expected route revision. Broker records intent and
   consumes the permit before the first public effect. State moves
   `RELEASE_READY -> PROMOTING -> OBSERVING`; failures now roll back, never use
   the earlier `no-public-effects` repair path. Only if preauthorization includes
   live canary routing may this scope contain real accounts.
   Observe >=60 minutes and >=20 eligible
   user journeys; sparse traffic cannot meet this by relabeling requests.
   If no live cohort is authorized/available, use the predeclared synthetic-only
   path: the first permit scopes **synthetic accounts only**, followed by 240
   critical journeys across 2 hours and explicit `no_live_canary` evidence.
   This is a narrower evidence class, not proof of real-user performance.
6. **Authorize expansion:** cohort observation produces
   `OBSERVING -> EXPANSION_READY`. The verifier rechecks evidence freshness,
   source/config/policy, LKG eligibility, cohort receipt and routing epoch, and
   issues a **different** single-use `rolloutPhase=full` permit. It names the prior
   cohort permit/receipt, full authorized scope and a fresh nonce; the consumed
   cohort permit cannot authorize widening. Broker transitions
   `EXPANSION_READY -> EXPANDING -> FINAL_OBSERVING`, records intent before routing,
   and query-reconciles the receipt. Each public phase has rollback/cancel/tamper/
   timeout paths. Keep old release/queues/drain state; never rebuild.
7. **Final observation:** >=120 scheduled critical probes across >=60 minutes, zero critical
   invariant events, success >=99% and p95 latency no more than 20% above paired
   LKG synthetic baseline. Insufficient observations block `SHIPPED`. Final
   28-day SLO remains separate. Synthetic-only releases retain their evidence label.

Safety failure triggers immediate route withdrawal/rollback; general availability
failure triggers on three consecutive failing one-minute probes from both
locations, or >=5% failures in the last 100 critical probes (all scheduled attempts
in denominator), or stale monitoring >3 minutes. Provider-wide failure may affect
LKG too: run safe non-paid health probes, choose an admissible release, expose
degraded status rather than thrash versions. No promotion while telemetry is blind.

## 5. Branches, dependency closure and hotfixes

`master` remains protected stable source, never an ongoing-work branch. Candidate
work uses `candidate/<slice>/<run>`; controller prepares a serialized
`integration/<run>` from current stable plus exact dependency commits. Release
artifacts bind the **actual integrated commit**, not the PR head. If merge queues
are available, verify the `merge_group` result too; otherwise serialize integrate,
validate and fast-forward under a separate integration identity. No permission
to bypass branch rules.

Source merge and production activation are different events. Prevent the current
Pages source auto-publish from exposing code prematurely: H05 moves to explicit
artifact publication only after preserving existing serving content and verifying
unattended Pages authority. Until then, candidate code must not be merged into a
publishing source in a way that changes public assets.

At most two product candidates in flight (one builder, one awaiting validation);
one exclusive promotion. No stacked batch larger than one visible slice after R0
unless an inseparable API/schema compatibility change requires two. The controller
computes transitive closure and schedules only ready nodes; blocked dependencies
propagate. It can ship independent contrast/copy work without waiting for hybrid
memory. Splitting a slice requires all acceptance/coverage retained and an acyclic
DAG; no finding disappears.

Confirmed safety incidents preempt feature work: watchdog freezes ordinary
promotion, creates a bounded hotfix candidate from current admissible release,
invalidates conflicting permits, and drains/fences affected work. Hotfixes keep
all applicable gates; they do not get a "skip tests" lane. New feature candidates
rebase and regenerate source-bound evidence after the hotfix. A rollback target
marked security-revoked is **ineligible** even if it was previously LKG; preserve
safe functions/read-only access and block harmful operations if none are safe.

## 6. Exception decision table

| Event | Automatic decision |
| --- | --- |
| Deterministic/product gate fails | Counterexample -> bounded repair attempt -> full affected validation; budget exhausted => `REJECTED` |
| Infra timeout/rate limit | Classified evidence, cancel/fence, recorded backoff, max two clean reruns; never rerun only lucky tests |
| Review conflict or unexplained safety risk | Independent reproduction, then `QUARANTINED` if unresolved |
| Candidate code/policy/artifact altered after evidence | Invalidate permit/evidence, new subject; forged event => quarantine |
| Auth denied/MFA/CAPTCHA/missing preauthorization | One authorized refresh/alternative; otherwise `BLOCKED_SAFE` |
| Required physical/device/provider capability absent | `UNSUPPORTED` capability plus blocked affected gate; do not simulate it and claim coverage |
| Spend/runtime exhausted | Stop new dispatch, reconcile costs/effects, terminal block; no cap increase |
| Publisher dies after route change | Higher fenced broker queries actual route/operation receipts; finish recording or rollback; never duplicate blind write |
| Both controllers active | Store CAS/epoch rejects loser; broker independently fences old epoch |
| Missing/corrupt ledger or evidence | Freeze acceptance/promotion; restore trusted snapshot and reconcile; keep admissible LKG |
| Old candidate still running after cancel | Kill only owned processes, revoke narrow run capabilities, fence writes, reconcile remote effects before reuse |
| No admissible rollback release | Reject unsafe operations, retain safe UI/data access, record `BLOCKED_SAFE`; no unsafe HTTP-200 fallback |

Terminal records include reason, owner role, failed gate, attempts, reservations,
affected features, last admissible release and automated next-check condition.
Transient blocked records can schedule at most three rechecks per 24 hours,
for seven days, only if a specific capability/expiry change is observable.
Thereafter remain terminal; externally changed authorized configuration can start
a new linked run. This is not a daily human triage queue or an endless retry loop.
