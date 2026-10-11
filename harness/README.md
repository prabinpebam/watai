# Watai harness

This directory contains the executable **local rehearsal** foundation for the
autonomous delivery design. It does not authorize unattended code changes,
network access, spending, staging, deployment, or release.

## Implemented

- A data-driven workflow compiler and deterministic transition reducer.
- Runtime binding of events to run, revision, fencing epoch, source and policy.
- Independently verified actor and guard proof interfaces with bounded lifetimes.
- Typed, phase-specific, single-use cohort and full-release permits.
- Idempotent event replay and fail-closed quarantine on conflicting reuse.
- Atomic creation of state, event receipt and effect intent.
- An in-memory ledger for unit rehearsal.
- A file-backed local ledger with exclusive writer locking, append-only records,
  atomic replacement and hash-chain corruption detection.
- Executable coverage for every synthetic workflow trace in the plan.
- Readiness assessment that separates rehearsal, implementation, evaluation and release.
- Local H01 preflight and an H01-H06/G00-G12 doctor report.
- External Ed25519 trust-root loading and root-derived TaskSpec bindings.
- Deterministic dependency/WIP scheduling and signed execution domains.
- Pinned Copilot SDK empty-mode worker policy with split credential broker/tool sandbox.
- Worst-case budget and fenced-effect reducers.
- Independent candidate evidence admission.
- Transactional SQLite candidate/outbox/lease/budget storage for same-host execution.
- Atomic SQLite reserve/claim, session binding, lease renewal, gateway write-ahead
    receipts, outcome-unknown recovery and effect/usage settlement.
- External exact-SHA candidate worktree preparation.
- Manifest-bound gateway with rollback-safe patches, no-network Docker validation,
    current-diff validation receipts and mandatory durable submission.
- Runnable signed-event controller and durable implementation executor CLIs.
- Watchdog and provider-receipt reconciliation.
- Fixed local evaluator inventory with three browser runs and isolated cloud integration.
- A reserve-dispatch-execute-settle coordinator that retains worst-case charges
    when provider outcomes or usage receipts are missing or untrusted.
- Exact Copilot SDK session usage capture for requests and input/output tokens;
    explicit AI-credit limits, streaming overage termination and missing usage fail closed.
- Frozen path-applicable live-model evaluation contracts with repeated runs,
    concrete hashed cases/oracles, observed model identity, semantic/error/latency
    thresholds, durable pre-call reservations and portable signed JSONL evidence.
- Real Copilot fixture and shipped Azure router/Responses adapters behind guarded
    commands; no live model run is claimed merely because the adapters exist.
- Exact live-model evaluation IDs in TaskSpecs and evidence admission, preventing
    one model result from substituting for a different required evaluation.
- Signed value-per-effort scheduling within immutable safety tiers.

## Commands

### Candidate Chronology And Workflow Gate

Run `npm run test:chronology` from the exact isolated candidate before promotion.
It starts and closes its own local Vite/Chromium instances, uses real chat UI and
run code with synthetic data transport, blocks external requests, and writes raw
DOM/frame samples and screenshots to `test-results/chronology/`. Desktop/mobile
checks cover delayed append, stale reload, clock skew, old realtime messages,
first/growing reply, completion handoff, peer placement and history scroll anchoring.
The old-order negative control must detect inversion; a final-state-only pass is
not sufficient. Run the corresponding every-commit hook tests as well.

This local canary is not authenticated production or independent release evidence.
Each release also requires the affected authenticated workflow on the exact staged
frontend/API/config combination, source-bound regression evidence and rollback
artifacts. Missing workflow evidence blocks promotion, not unrelated local work.
Health and public-shell checks cannot substitute for that gate. Never deploy the
accumulated dirty worktree or resume promotion over an unresolved regression.

### Windows Continuation Watchdog

All automation is background-only. Use the versioned `Automation: Quiet ...` VS Code
tasks: presentation never reveals/focuses the terminal or Problems panel, shell profiles
are disabled, and native checks use `CreateNoWindow` with redirected output and closed
stdin. No foreground fallback, elevation/authentication prompt, or user-window takeover
is permitted. One-shot checks may be awaited; asynchronous execution alone is not proof
of hidden execution.

The scheduled action uses GUI `wscript.exe //B //Nologo` and the fixed
`continuation-watchdog-hidden.vbs` launcher. It can invoke only the compiled `check`
command, with window style zero and exit-code propagation. `RefreshAction` verifies the
existing action, owner SID, privilege, interval and limits before changing only the
action; it retains the old XML and leaves the task disabled until the canary passes.
The 2026-09-11 runtime canary observed no automation-owned window-show/foreground events,
unchanged foreground window, exit code zero and `dispatched=false`. Evidence is local
at `.harness-state/background-only-evidence.json`. This does not grant dispatch authority.

The minimal current-user monitor is **log-only**: zero model requests, zero spend,
no agent dispatch, and no remote actions. It does not resume the editor agent.
The installed `check` command cannot dispatch, regardless of configuration.
A separate operator-owned foreground command, `npm run harness:watchdog -- dispatch`,
implements the guarded adapter but currently remains blocked by missing attested
cloud observations and external signed authority. Do not schedule this command:
the installed task's two-minute termination limit cannot own a long-running worker.
Dispatch validates signed/budgeted authority, all executor environment inputs,
fresh cloud/process/lease telemetry, and exactly one current task-bound pending
worker effect before invoking only `.harness-dist/durableExecutorCli.js`.
Claimed, reconciling, and unknown effects must never be redispatched.

The adapter rechecks activity, pause and authority under the exclusive mutex,
fsyncs a dispatch intent before launch, and waits for its single non-detached child.
It accepts no custom executable or command string, creates no task or budget, and
never kills a worker or retries an ambiguous exit. Completion requires both a
successful child exit and durable completed effect plus settled budget. An uncertain
exit retains `continuation-watchdog-dispatch.json` and blocks further dispatch,
including after restart. An operator must reconcile the provider and durable state
and establish that no child remains before removing this record or an abandoned
lock. Pause prevents new launches; it does not terminate an already running child.
Unsigned configuration such as `idle=true` cannot clear cloud/outcome checks.
Fake adapters are test-only; the CLI always uses production observations and authority.

```powershell
npm run build:harness
node node_modules/vitest/vitest.mjs run harness/src/watchdog.test.ts
.\scripts\continuation-watchdog-task.ps1 -Action Plan
.\scripts\continuation-watchdog-task.ps1 -Action Install -ActivityDirectory '<existing Copilot session debug-log directory>'
npm run harness:watchdog -- check
npm run harness:watchdog -- status
npm run harness:watchdog -- pause
npm run harness:watchdog -- resume
.\scripts\continuation-watchdog-task.ps1 -Action Status
Unregister-ScheduledTask -TaskName 'Watai Continuation Watchdog' -TaskPath '\' -Confirm:$false
```

Install runs a log-only canary before registration. No elevation, password,
credentials, authority generation, or package installation is performed. Stop on
access denied; do not retry with elevation. The task uses the resolved absolute
Node executable and compiled CLI, repository working directory, interactive
current user, limited privileges, ten-minute repetition, IgnoreNew concurrency,
and a two-minute execution limit. It runs only while that user is logged in.

Configuration is `.harness-state/continuation-watchdog.json`; decisions append
to `continuation-watchdog-decisions.jsonl` in the same directory. Pause persists
in `continuation-watchdog.paused` until explicit resume, including across task
removal/reinstallation. Status does not create progress. Check acquires an atomic
directory mutex `continuation-watchdog.lock`; an abandoned mutex blocks forever
until an operator verifies no checker is running and removes only that directory.
No automatic lock stealing, permit deletion, heartbeat, grant, or TaskSpec writing
is performed. Removal retains all state and audit records.

An optional observed session directory contributes only top-level `.jsonl` file
mtimes, never log contents; `models.json` and watchdog logs are not progress.
Twenty minutes without activity is stale. Missing telemetry fails closed; an
open editor alone is not evidence of active work. The selected session directory
does not cover new editor sessions automatically. Process observation is local
and conservative; cloud operation completion has no reliable local telemetry
contract yet, so it always reports a blocker. Unexpired cost decisions, including
consumed decisions in history, block; expiry never proves cloud completion.
SQLite is opened read-only, with no claims, reconciliation, or lease mutations.
The scheduled environment may lack variables present in an interactive terminal;
only missing variable names are logged, never their values or exception content.

Run the complete local harness validation:

```powershell
npm run validate:harness
npm run harness:preflight
npm run harness:doctor
npm run harness:model-eval-plan
npm run harness:work-decision -- <request.json>
npm run harness:evaluate-canary
npm run harness:authority-ceremony
npm run harness:controller-apply
npm run harness:probe-worker
npm run harness:evaluate-live -- <evaluation-id>
npm run harness:task-spec
npm run harness:execute
```

Inspect current readiness:

```powershell
npm run harness:status -- rehearsal
npm run harness:status -- implementation
npm run harness:status -- evaluation
npm run harness:status -- release
```

Without an external signed authority bundle, rehearsal is available and
implementation/evaluation/release must report `BLOCKED_SAFE`.

Operational public authority can be supplied only through an external directory
named by `WATAI_HARNESS_AUTHORITY_DIR`; see [contracts/README.md](contracts/README.md).
The repository does not provision or sign that authority.

After committing a validated bootstrap change, `harness:authority-ceremony`
revalidates the harness, checks the approved npm registry, GitHub CLI and Docker,
probes the exact smoke and full candidate-worker images, and writes an unsigned
owner-review package outside the repository. It never creates a private key,
signature or authority.

`Dockerfile.smoke-worker` is limited to the frozen implementation-agent fixture,
which validates with Node only. It is not the full candidate validation image.
`Dockerfile.worker` installs both lockfile dependency trees through the approved
Microsoft npm feed and remains the required image for real candidate execution.
The npm registry remains `packagefeedproxy.microsoft.io`; host replacement is
disabled so npm can follow the Microsoft Azure Artifacts tarball URLs returned
by that proxy instead of rewriting them into invalid proxy paths.

## Trust boundary

The file ledger is deliberately labeled `1.0-local-rehearsal` and
`releaseEligible: false`. Its hash chain detects accidental corruption; because
the hashes and data share one mutable local file, it is not an immutable or
cryptographically independent evidence store. Any existing writer lock blocks;
the local implementation never deletes a stale-looking lock automatically because
that creates a split-brain race. Unattended stale-lock recovery requires the
future durable lease/CAS adapter.

Implementation execution uses the SQLite store, not the file ledger. It remains
same-host only and cannot satisfy distributed release or immutable-evidence gates.

The controller accepts proofs only through injected verifier interfaces. Test
verifiers are synthetic and must never be assembled into an implementation or
release process. Checked-in commands invoke external signing and live-provider
adapters, but they remain blocked until owner-controlled authority, signer,
approved image provenance and credentials are supplied. Real paid calls must
return signed portable observations; deterministic tests and estimated costs
cannot replace them. Release additionally requires distributed CAS, immutable
evidence, staging and a narrowly scoped release broker.