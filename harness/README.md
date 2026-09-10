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
- External exact-SHA candidate worktree preparation.
- Manifest-bound gateway service and bounded Copilot create/resume runner.
- Watchdog and provider-receipt reconciliation.
- Fixed local evaluator inventory with three browser runs and isolated cloud integration.
- Signed value-per-effort scheduling within immutable safety tiers.

## Commands

Run the complete local harness validation:

```powershell
npm run validate:harness
npm run harness:preflight
npm run harness:doctor
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

## Trust boundary

The file ledger is deliberately labeled `1.0-local-rehearsal` and
`releaseEligible: false`. Its hash chain detects accidental corruption; because
the hashes and data share one mutable local file, it is not an immutable or
cryptographically independent evidence store. Any existing writer lock blocks;
the local implementation never deletes a stale-looking lock automatically because
that creates a split-brain race. Unattended stale-lock recovery requires the
future durable lease/CAS adapter.

The controller accepts proofs only through injected verifier interfaces. Test
verifiers are synthetic and must never be assembled into an implementation or
release process. A future production composition must provide independently
managed identity verification, trusted time, durable distributed CAS, immutable
evidence, isolated workers, budget reservations and a narrowly scoped release
broker. The readiness gate requires attestations for those capabilities and the
checked-in policy remains fail-closed. A separately pinned external runtime grant
must authorize a metered or subscription quota without modifying candidate-owned
policy bytes.