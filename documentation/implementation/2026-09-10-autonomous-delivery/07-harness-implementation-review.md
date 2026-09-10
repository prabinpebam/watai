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
| High | Package sources could bypass the approved proxy through lock URLs | Added project npm policy, removed registry-resolved URLs and made source validation a hard harness check |

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
2. Docker client is installed but the configured Linux server is stopped; no worker isolation attestation exists.
3. The local file ledger is not distributed Cosmos CAS, immutable evidence or a production scheduler; an orphaned local lock fails closed and is not automatically reclaimed.
4. No durable worktree/tool-gateway/budget/watchdog/effect-reconciler/credential-broker implementations are attested.
5. No trusted evaluator pack, complete browser runner, trusted build or immutable evidence service is attested.
6. No release broker, immutable stage, LKG routing, queue fencing or rollback adapter exists.
7. H01 has not observed deployed source/runtime/configuration through an authorized read-only identity.
8. Root npm audit reports 1 critical, 4 high and 6 moderate advisories; API reports 1 critical, 4 high and 3 moderate. Direct test/build fixes require major toolchain changes and must be independently evaluated before `trusted-build` can pass.
9. The API suite has 11 skipped cloud integration tests; G02 requires zero required skips in the trusted inventory.

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
source checks. Latest local results: 107 harness tests passed; the full root suite
passed 338 tests and production build; the API passed 557 tests with 11 integration
tests skipped, then typecheck/build passed. These are local observations, not
independent gate attestations.