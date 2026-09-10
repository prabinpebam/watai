# Executable harness critique and first implementation increment

**Candidate:** `candidate/H03/run-001`
**Status:** local rehearsal implementation; H03 is not accepted or release-ready.

## Review findings

| Severity | Gap in the planning baseline | Disposition in this candidate |
| --- | --- | --- |
| Blocker | The only executable was a structural plan linter; no workflow event could run | Added a deterministic controller driven by `contracts/workflow.json` |
| Blocker | Actor names and guard results could otherwise be caller assertions | Added source-bound, time-bounded actor/guard proofs behind injected verifier interfaces |
| Blocker | Public rollout had no executable one-use permit enforcement | Added typed cohort/full permits bound to run, epoch, source, policy and manifest; nonce reuse rejects |
| Blocker | An unrestricted persistence API could bypass the reducer | Ledger writes now occur only through validated dispatch |
| High | Restart/replay behavior existed only in prose | Added a locked atomic local ledger with append-only revision records and corruption checks |
| High | Synthetic traces were structurally checked but never executed | All ten declared success, repair, timeout, cancellation, quarantine and rollback traces execute in tests |
| High | Unsupported runtime schema versions were not rejected by an engine | Workflow and event schema versions now fail closed |
| High | The plan had no executable readiness distinction | Added separate rehearsal, implementation, evaluation and release readiness results |
| Blocker | Backlog entries could not become bounded execution contracts | Added dependency-closed TaskSpec compilation, signed execution domains, protected paths and independent locking |
| Blocker | Trust callbacks had no cryptographic implementation | Added external Ed25519 public-root loading, separate root pinning, issuer kind/role controls and root-derived bindings |
| Blocker | SDK permissions could be mistaken for isolation | Added a split broker/tool-sandbox launch contract and fixed manifest-bound proxy tools against SDK 1.0.13 |
| High | Exit zero could be mistaken for acceptance | Added signed per-check evidence admission with exact gates, acceptance IDs, denominators, DAGs and negative controls |
| High | Dispatch budgets and effects existed only in prose | Added worst-case reservation and fenced effect reducers with terminal unknown outcomes |
| High | Package sources could bypass the approved proxy through lock URLs | Added root/API npm policy, removed registry-resolved URLs and made layered source validation a hard harness check |
| Blocker | No runnable coding-worker lifecycle or gateway existed | Added bounded create/resume runner, manifest-bound gateway service and external exact-SHA worktrees |
| Blocker | Same-host restart/race state was a JSON rehearsal | Added SQLite WAL/FULL-sync CAS for candidate/event/outbox/lease/budget state and watchdog reconciliation |
| High | Browser/API inventory reported applicability as skips | Added static browser project filters and a fail-closed isolated-stage API inventory; three 44/44 browser runs and 11/11 integrations pass |
| High | Canonical ordering ignored value per effort | Added signed value/risk/effort scoring inside immutable safety/dependency tiers |

## What this earns

The candidate can compile a dependency-closed TaskSpec, rehearse the workflow,
verify signed authority artifacts, prepare a broker/sandbox worker manifest,
reserve/fence effects, admit independent evidence, schedule only dependency-ready
work, recover a local candidate after restart and report H01-H06/G00-G12 blockers.
State, event receipt and effect intent are produced as one reducer result and
persisted as one atomic local rehearsal document replacement.

This is meaningful executable evidence for part of H03. It is not completion of
H03 because H01 and H02 are dependencies and the production adapters do not yet
exist.

## Remaining blockers

1. No external signed authorization root, runtime grant or independently managed verifier keys exist.
2. Docker Linux is running and isolation controls pass, but no approved Watai image source or signed worker attestation exists.
3. The local file ledger is not distributed Cosmos CAS, immutable evidence or a production scheduler; an orphaned local lock fails closed and is not automatically reclaimed.
4. Durable local worktree/gateway/SQLite budget/watchdog/reconciler/agent components exist but are not independently attested; the credential broker remains external.
5. A complete local evaluator/browser/integration inventory passes, but no independently signed evaluator pack, trusted isolated build or immutable evidence service is attested.
6. No release broker, immutable stage, LKG routing, queue fencing or rollback adapter exists.
7. H01 has not observed deployed source/runtime/configuration through an authorized read-only identity.
8. API audit is zero. Root remains 1 critical/1 high/5 moderate (2 moderate production-only); approved-feed tarball gaps block the coherent stable root upgrades and clean-install proof.
9. API unit and browser inventories now have zero skips; all 11 isolated cloud integrations pass. Independent evidence authority is still required.

Consequently, implementation, evaluation and release statuses remain
`BLOCKED_SAFE`. Changing the doctor, capability list or tests is not a substitute
for supplying independently verified capability attestations.

## Validation

```powershell
npm run validate:harness
npm run harness:preflight
npm run harness:doctor
npm run harness:status -- rehearsal
npm run harness:status -- implementation
```

The combined validation runs the original plan validator, strict harness
typechecking, all harness tests, a standalone Node ESM build and approved package
source checks. Latest inventory: 138 harness tests and 369 root tests;
the API passed 557 unit and 11 isolated integration tests with zero skips, then
typecheck/build passed; three browser runs passed 44/44 each. These are local
observations, not independent gate attestations.