# Design validation and adversarial disposition

**Scope:** review and local mechanical validation of this planning package, not
execution of the proposed harness, product tests, cloud provisioning or release.
The application findings remain open. All JSON policy examples default to no
authorization and zero effective spend.

## Local mechanical evidence

Run on 2026-09-10 in the dedicated
`prabinpebam-autonomous-implementation-plan` worktree, Windows, Node **v22.19.0**:

```powershell
node documentation\implementation\2026-09-10-autonomous-delivery\validate-plan.mjs
git --no-pager diff --check
```

Observed: **56 slices, 52 exact committed-audit finding IDs, 114 acceptance
checks, 23 workflow states, 20 synthetic evidence subjects; 56/56 in-memory
negative controls rejected; Markdown table matches JSON.**

The validator obtains the finding register from the fixed audit commit
`9b4314ddd537401667d68642c3eeee85e7fabca7`, not a candidate-controlled path or
modified working-tree file. It reads only local files/Git objects. Input paths
use platform path segments, not Windows-only backslash strings interpreted as
Linux filenames. Execution was on Windows; a Linux runtime was not exercised
here, so portability is a code property reviewed, not an executed OS-matrix claim.

Schema checking supports exactly the keywords used by the closed schema and
fails on unknown keywords. It is a small local subset validator, not a complete
JSON Schema implementation or a future cryptographic trust root. Semantic checks
include reciprocal closure references, acyclic dependency/evidence graphs,
bounded workflow cycles, nonterminal reachability, source/digest binding,
independent roles, mandatory product gates, permit phase/freshness/uniqueness,
exposure-bank limits and synthetic trace structure. Nonblank text is enforced
in addition to schema string length.

Known-good control is the unmodified package. Negative controls cover duplicated
IDs, missing/changed audit IDs and path/SHA, unknown/cyclic dependencies, incomplete
acceptance/visible outcomes, missing gates, builder self-attestation/promotion,
unbounded retries, terminal reopening, graph ambiguity, forged/different artifacts,
wrong producers/denominators, surviving behavior controls, epoch/expiry mismatch,
example release claims, fourth validation exposure, reused final bank, counter
reset, forged reservation, aborted-exposure refund, reused/stale/wrong-phase permit,
missing expansion permit and missing rollback.

These checks establish **structural rejection of those mutations only**. They do
not execute guard predicates, authenticate a real evaluator ledger, sign artifacts,
reproduce cloud fencing, prove semantic acceptance checks, or measure statistical
memory quality. The complete future harness must implement and independently test
those controls in H02-H06. Synthetic SHA-256 values hash toy payload strings; they
are explicitly not hashes of Watai release artifacts.

## Independent review record

The parent coordinator arranged a read-only adversarial review by a different
model family over the harness/DoD/release design, and independently reviewed
backlog/traceability. Initial findings and authored dispositions:

| ID | Initial severity / finding | Revision and evidence |
| --- | --- | --- |
| A1 | Blocker: live cohort could receive traffic before a permit, while RELEASE_READY failures assumed no public effects | Cohort routing now requires its own independently issued scoped one-use permit. Widening uses EXPANSION_READY/EXPANDING/FINAL_OBSERVING and a **new** full-scope permit; every public state has rollback/safe withdrawal. Examples cover post-cohort cancel/tamper, expansion failure, reused/stale/wrong-phase permits |
| A2 | Major: prose sticky G03-G05 not encoded in policy | `productMandatoryGates` is an unconditional product-release union; schema requires it and three missing-gate negative controls reject. Disabled paths still require no-effect/rejection assertions |
| A3 | Major: adaptive holdout limits lacked evidence/ledger binding | Added evaluator-owned bank IDs/digests/purposes/precommit IDs and monotonically spent reservations; validation max3/final max1; failures/aborts consume; packet binds ordinal/sequence and negative controls reject reset/reuse/forgery |
| P1 | Avoidable UI dependency chains delayed useful delivery | Removed worker/key/asset-lifecycle waits from independent voice/onboarding/request-race/inventory/local-export slices; retained cross-surface finding closure dependencies |
| P2 | Initial bootstrap risked a large all-chat first release | R0 is a smaller explicitly restricted owner/history/control envelope; R1 restores normal chat only after worker/assets/outbox closure; R2 restores Saved-only |
| P3 | Disabling temporary mode alone contracted the ambitious final goal | Added S49 real server-enforced temporary run/retention lifecycle; FE-04 requires S01 plus S49; final S48 depends on it |
| P4 | Local validator paths would fail on Linux | File loading now uses path segments; serialized audit path remains an exact fixed baseline constant, converted only for Git object syntax |
| P5 | Restricted R0 safety depended on prose-only capability allowlists | Closed R0/R1/R2/R3/RT/R4 registry, inherited dependencies/gates, scoped bootstrap substitution, config/permit ID+digest binding and negative controls for unauthorized generation, missing fence prerequisite, forged envelope and revoked rollback |
| P6 | BE-15 Library full-scan and artifact transport coverage needed explicit closure | Added S43 server-filter/pagination/resource acceptance and reciprocal BE-15 closure; S30 explicitly covers artifact/webImages append/projection/replay/fresh-device preservation |

The parent also reported a separate structural pass with six negative controls
(duplicate ID, unknown dependency, cycle, missing finding, invalid closure,
empty visible outcome) on the earlier 55-slice draft. Those results are historical
parent evidence, not the current 56-slice run or proof of runtime safety.

This record reports **implemented design revisions**, not an invented external
approval. Parent re-review/acceptance, if supplied, is a separate observation.
No human signoff is a dependency of the proposed operational harness.

### Second independent review

Parent reported the second reviewer marked A2/ADV02 and A3/ADV03 resolved, and
the original A1/ADV01 public-before-permit blocker resolved. One narrower major
remained: initial `permit_issued` lacked the `gates-passed` guard promised in prose,
although expansion already included it. The initial edge now includes it; the
validator requires a current gate recheck on **both** public authorization edges
and rejects its removal. A minor missing controller-role row was also added,
matching the canonical no-edit/no-attest/no-release/no-policy authority flags.

These are recorded authored repairs after that review, not a claim that the
reviewer already observed or approved the final bytes. The parent can independently
check the final commit and this validator result.

## Persistent boundary

Only this documentation directory and its audit-only Node validator are changed.
No product source, lockfile, cloud settings, production data, secrets, workflow
enablement, provider calls or dependencies were modified. The final local commit
is the durable source identity for this design package; release evidence must
bind its actual commit/tree hash rather than a self-referential placeholder.
