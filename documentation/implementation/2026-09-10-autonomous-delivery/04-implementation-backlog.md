# Implementation backlog and delivery sequencing

**56 execution slices, 52 audited findings, zero implemented product fixes in
this planning task.** `contracts/backlog.json` is authoritative for exact
dependencies, scope, owner agent, acceptance/check IDs, risk, rollout, rollback,
visible outcome, finding closure and evidence/gate mappings. The table below is
mechanically reconciled to its slice IDs and titles.

## Scheduling rules

H01-H06 establish actual machine authority, evaluator integrity, durable execution,
an isolated release plane and a first admissible LKG. They are implementation
work, not things this design claims already exist. Sxx entries are product slices;
E01 freezes evaluation before tuning. Milestones are priority groups, **not**
barriers forcing independent work to wait for every earlier row.

The controller takes the transitive dependency closure of a requested slice,
orders its ready nodes by safety hotfix, critical trust risk, immediate memory
trust benefit, then visible user benefit. Tie-break by longest blocked downstream
critical path and oldest ready time. One builder; at most one additional candidate
awaiting independent validation. Validate and release the smallest compatible
slice, never an arbitrary weekly bundle. Runtime changes and dependency majors,
memory schemas and UI redesigns are not bundled.

S36 voice privacy, S37 onboarding labels, S38 request races, S41 keyboard semantics
and S42 contrast can be prepared immediately after H04 without waiting for worker,
key-rotation or memory retrieval redesigns. S15 management inventory depends on
owner/settings authority, not a functioning inference pipeline; S39 honest local
export/clear behavior does not wait for provider-asset cleanup. FE-10 still needs
both S32 and S39 for full closure, so partial delivery cannot hide its remaining
cross-surface work.

### Capability envelope progression

**R0**: H06 depends on H05 + S01/S02/S04/S06. This irreducible initial safety
envelope supports owner-isolated history, local draft recovery and truthful
controls. Server generation, asset grants, destructive operations, background
learning/memory use and outbox transmission are contained until their gates pass.
Disabling is enforced server-side and at worker admission, not merely UI.
The independent evaluator asserts rejection/no side effects for each disabled
path; this is not an N/A or test skip.

**R1 ordinary chat**: H06 + S03/S05/S07/S08/S09/S10 permits canonical assets,
transactional sync and durably accepted generation. These can deploy as individual
flag-off compatible slices, then a separately evidenced envelope activation.
**R2 Saved-only**: R1 + S12/S13/S14 permits approved saved memory; S11 preserves
drafts and is high-priority but is not an artificial dependency of capture fixes.
**R3 hybrid/learning**: S47's dependency closure and G06, never just the existence
of a vector index. **Temporary mode**: S49 restores the actual capability; S01's
disabled control is containment only. S48 is the final all-finding goal and
depends on every other slice, including S49.

The closed `policy.capabilityEnvelopes` allowlists and inherited dependencies
are part of the signed policy/evaluator pack, bound by ID/digest to configuration
and phase-scoped permits. RT independently adds temporary mode to R1; R4 combines
RT and R3. R0 has a narrowly specified bootstrap candidate-receipt substitution
for its first product safety batch, not for missing control-plane authority. A missing implementation
capability blocks that envelope, not unrelated safe visible improvements. R0's
reduced functionality is disclosed explicitly; it is not advertised as completed
ordinary chat. If even R0 cannot be made safe under preauthorization, do not
overwrite the observed product or claim a validated release exists.

## Bounded vertical slices

| ID | Slice | Intended delivered increment |
| --- | --- | --- |
| H01 | Observed baseline and unattended preflight | Known versus unknown deployment/capability record |
| H02 | Independent policy and evidence trust root | Non-self-approving verifier/evaluator authority |
| H03 | Durable bounded controller and isolated workers | Restart-safe bounded engineering execution |
| H04 | Trusted CI and complete browser baseline | Full independent browser and deterministic gates |
| H05 | Supported runtime and immutable release plane | Version-addressable supported staged environments |
| H06 | First minimally validated last-known-good release | Restricted R0 first, not an unproved full-product claim |
| E01 | Freeze memory baselines and synthetic truth | Untuned A/B/C/D contract and sealed evaluation banks |
| S01 | Truthful privacy and unsafe-control containment | No false temporary/retention/rebuild/raw-edit promises |
| S02 | Owner-qualified threads and child records | Cross-account server isolation |
| S03 | Canonical owner-verified asset grants | Safe same-owner attachment reuse |
| S04 | Account-scoped local data and drafts | No cross-account local disclosure or dispatch |
| S05 | Transactional offline outbox | Concurrent offline edits do not disappear |
| S06 | Authoritative revisioned account settings | Fresh devices preserve consent |
| S07 | Atomic idempotent run acceptance | One logical run per accepted submission |
| S08 | Recoverable dispatch and worker fencing | Accepted work survives crash/duplicate delivery |
| S09 | Cancellation and deletion preserve intent | No stale worker resurrection |
| S10 | Bounded truthful streaming completion | Hung/truncated replies fail honestly |
| S11 | Drafts clear only after durable acceptance | Failed send retains work |
| S12 | Independent memory use and learning policy | Off, saved use and learning mean different things |
| S13 | Immediate forget and replay exclusion | Forgotten context becomes ineligible immediately |
| S14 | Accurate approved Saved-only profile | Explicit saves/corrections work without learning |
| S15 | Complete lossless saved-memory inventory | All states/items remain findable |
| S16 | Revision-safe memory edits and batch preview | No destructive stale-inventory replacement |
| S17 | Versioned memory transfer and honest rebuild jobs | Portable semantics and real job receipts |
| S18 | Durable idempotent memory extraction | Recoverable, policy-fenced learning jobs |
| S19 | Verified evidence and conservative attribution | Supported source/subject/sensitivity claims |
| S20 | Atomic memory reconciliation and deduplication | Failure cannot destroy valid prior memory |
| S21 | Temporal and subject-aware memory semantics | Past versus present and people remain distinct |
| S22 | Revisioned vectors and independent indexing | Saves index without another learning event |
| S23 | Whole-inventory bounded recall and disclosure | Old relevant items, combined budget, full manifest |
| S24 | Calibrated shipped-pipeline memory evaluation | Honest complete comparison and evaluator calibration |
| S25 | Immutable authorization identity | Email changes cannot grant privilege |
| S26 | Approved endpoints and bound credentials | No key forwarded on unapproved origin change |
| S27 | Owner-scoped provider resources and skills | No foreign provider delete or skill-cache collision |
| S28 | Credential clearing and wrapping-key refresh | Integration removal and key rotation converge |
| S29 | Unified asset references and deletion ledger | Clear ownership, erasure and in-flight deletion |
| S30 | Resumable document and artifact ingestion | Interrupted ingestion converges visibly |
| S31 | Early byte limits and content verification | Bound allocation before trusting file content |
| S32 | Reliable grants and legacy asset addressing | Fresh-device and verified legacy asset round-trips |
| S33 | Durable replay cursor and history order | Reconnect handles collisions/out-of-order events |
| S34 | Coherent restore without forgotten-data revival | Recover keys/assets while preserving latest revocations |
| S35 | Bounded tool capabilities and worker seams | Authorized capabilities and bounded orchestration |
| S36 | Voice mute and delayed-capture cancellation | Mute/exit actually cancel capture |
| S37 | Honest onboarding capability tests | Only performed tests are called tested |
| S38 | Race-safe collections and exact search targets | Correct filter results and matched-message destinations |
| S39 | Truthful offline export and clear-device behavior | Local promises match actual included/cleared data |
| S40 | Bounded loading error and completion states | Actionable failures and completion announcements |
| S41 | Shared keyboard focus and accessible names | Named, keyboard-operable dialogs/navigation |
| S42 | Readable contrast and narrow-screen controls | Readable information and reachable controls |
| S43 | Bounded history rendering and asset growth | Measured responsive large-history behavior |
| S44 | Content-safe health and complete usage telemetry | Detect degradation without leaking content |
| S45 | Atomic user and system spending limits | Concurrent requests cannot double-spend reservations |
| S46 | Current architecture and capability documentation | Documentation matches deployed evidence |
| S47 | Earned hybrid and review-learning promotion | Better memory only after strict benefit/safety gates |
| S49 | Server-enforced temporary-run lifecycle | Real temporary mode, no history/memory, bounded retention |
| S48 | All-finding closure and sustained operational goal | All conditions together plus operational window |

## Execution card and evidence conventions

Each JSON slice is an execution card. `scope` identifies allowed product surfaces;
future exact file allowlists are resolved against its input SHA and signed into
TaskSpec before worker launch. New paths are explicit proposals, not permission
to edit evaluator/policy roots. `ownerAgent` names accountable execution role,
not someone permitted to accept their own changes. Builder, test-author and
evaluator are separate principals even when a provider/model family is shared.

Every acceptance check has a stable ID and gate. Mandatory common gates plus
`productMandatoryGates` (G03-G05 for product releases) plus slice/impact gates are
unioned, never intersected. Every evidence kind in the card becomes a required
artifact checklist entry, not a decorative tag. `rollout.profile` selects the
declared sequence; `rollout.steps` and `rollback` supply slice-specific conditions.
An evaluator must reject an otherwise parseable card with vague/unobservable
acceptance before `SPEC_LOCKED`. This validator does not implement semantic judgment.

Output convention, in a separate governed artifact store:
`runs/<run-id>/<source-sha>/<kind>/<sha256>`. Each slice produces a manifest of
contract/regression/adversarial/browser/migration/model-eval/release/observability/
traceability artifacts as applicable. Include expected and actual checks, raw
results, failed attempts, cost reservations and independent signatures. Builder
logs are supplemental, never required-evidence substitutes.

Finding closure is conjunction: for MEM-02, S13 immediate serving exclusion **and**
S29 full governed lifecycle **and** S34 restore protection must all ship. For
FE-04, S01 removes the unsafe promise but S49 delivers real server semantics.
BE-15 also requires S43's bounded server-side Library filtering/pagination and
measured per-page resource use; tool/notifier separation alone is insufficient.
S30/S32 preserve artifact and web-image fields through append, projection,
replay and fresh-device round-trips. OPS-03 needs the trust root, durable harness,
CI, release topology **and** first
LKG. The optional product graph experiment in the audit is not on the critical
path and is not included in the 56-slice commitment. No graph DB is authorized.

## Milestone exit and failure economics

M0 earns a restricted baseline and trust boundaries. M1 makes Saved-only useful
and controls trustworthy while independent UX/accessibility fixes ship. M2 earns
better evidence/retrieval and a real evaluator. M3 completes provider/assets,
temporary mode, synchronization, restoration and product hardening. M4 performs
bounded optimization, earned hybrid promotion and all-finding sustained closure.

Do not translate the audit's 66-116 human engineer-days into a fictional autonomous
completion date. Proposed dispatch units target one 45-minute attempt and up to
three bounded attempts. Split any discovered large slice into child cards retaining
all checks/dependencies and visible parent outcome; splitting does not reset the
parent's spend/exposure budget. If a reliable schema migration needs more work,
record the measured expansion rather than bypass validation.

Candidate/infra/evaluation/recovery ceilings and stop conditions are defined in
03. Measure actual active hours, elapsed blocked time, useful released outcomes
and total cost. Cosmetic commits, generated tests with no defect detection,
disabled capabilities and transient green retries do not count as completed
visible slices. Failed experiments remain useful evidence but not shipped value.
