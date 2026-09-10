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