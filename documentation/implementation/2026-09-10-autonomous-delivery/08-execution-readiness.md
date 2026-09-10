# Execution readiness against the Definition of Done

**Current machine result:** `BLOCKED_SAFE` pending external authority/provenance.
**Next canonical slice:** H01.
**Safe today:** plan validation, local preflight, deterministic workflow rehearsal,
cryptographic verification, transactional same-host SQLite CAS/outbox/budgets,
external worktree creation, structured gateway tests, bounded Copilot lifecycle
tests, watchdog reconciliation, fixed local evaluation and isolated-stage tests.
**Not safe today:** unattended model dispatch, candidate mutation, independent
acceptance, cloud staging, deployment or release.

API dependency audit is now zero after stable Vitest 4.1.11/esbuild 0.28.2
upgrades. Root compatible updates reduce the audit to 1 critical/1 high/5
moderate; production-only audit is 2 moderate React Router advisories. Stable
root remediation is blocked by malformed/missing approved-feed artifacts:
`@oxc-project/types@0.148.0` for the Vitest/Vite path and all tested `cookie`
1.x plus `@remix-run/router` 1.23.x tarballs for fixed/router-clean-install paths.
No public-registry fallback is permitted. Existing Vitest runs without UI/server
and browser Vite binds loopback, which limits exposure but is not a feed repair or
independent `trusted-build` attestation.

## Value per effort without safety debt

Dependency closure, safety tier, protected paths, required gates and capacity are
absolute. Within the same safety tier, the scheduler may use complete signed
assessments of user value, risk reduction, effort and confidence. Missing,
invalid or conflicting assessments cannot steer work. A lower-effort feature can
never outrank H01-H05 bootstrap or a critical containment/isolation slice merely
because its visible payoff is larger.

This permits useful independent UI work after H04 and favors high-confidence
risk reduction or user value per effort among equally safe ready slices, while
preserving the architecture and DoD.

## Current local evidence

- Frontend: live Pages index, primary JS and CSS match `origin/master`
  `f7dc195300c4039aae5b9a7a8fb1691327864ea1` byte-for-byte.
- Backend: running Node 20 in East US 2; exact Flex package SHA-256
  `7519a39a0c191d2a6cee8d12cccd7cb8f9bfdef345881080be4b59e76bb65e42`.
  Historical Git source is explicitly unknown because sampled deployed blobs
  match no reachable commit. See `evidence/h01-observed-baseline.json`.
- Docker: Linux engine available; probe proves UID/GID 1000, read-only root,
  network none, no-new-privileges, zero effective capabilities, PID 64, memory
  256 MiB and CPU 0.5. No approved Watai base image/registry exists yet.
- Harness: 21 files / 138 tests pass.
- Root: 53 files / 369 tests pass.
- API: 76 files / 557 unit tests pass with zero skips; typecheck/build pass.
- Browser: three consecutive complete runs, each 44/44 with zero skips/retries.
- Isolated cloud integration: 5 files / 11 tests pass against
  `watai-harness-stage` and `harness-media-integration` only.
- Fixed local evaluator: every inventory command passes and raw stdout/stderr
  hashes are captured; the report remains builder-visible and non-attested.

Run the authoritative local report:

```powershell
npm run validate:harness
npm run harness:preflight
npm run harness:doctor
npm run harness:status -- implementation
npm run harness:status -- evaluation
npm run harness:status -- release
```

Generated reports live under `.harness-state/` and are local observations, never
signed release evidence.

## Decisions now encoded

1. The canonical backlog scheduler starts at H01 and counts only independently
   verified `SHIPPED` dependency receipts.
2. TaskSpecs bind exact source/tree/diff, complete trust-root digests, dependency
   closure, signed execution domain/path impact, tools, separate model/tool
   egress, budgets, acceptance checks, evidence kinds and negative controls.
3. `policy-maintainer` is not treated as one mutation class. Signed domains
   distinguish policy, controller and release-plane work. `harness/src` is a
   protected path and therefore pulls G12 into its TaskSpec.
4. Runtime authority comes only from an external Ed25519 public root and signed
   claims. The repository holds no active root, grant or private key.
5. Copilot uses SDK 1.0.13 and bundled CLI 1.0.83 in `empty` mode. Ambient login,
   host Git, session memory, skills, MCP, extensions, instructions, remote
   sessions and built-in tools are disabled. Only exact custom gateway tools can
   receive one-request permission.
6. Model credentials stay in a broker with no workspace mount. File/search/write/
   validation tools run in a separate non-root, read-only-root, no-network Docker
   sandbox with no credentials or Docker socket. SDK permission hooks are not
   accepted as the sandbox.
7. Worst-case tokens, requests and spend reserve before dispatch. Subscription
   execution may authorize zero incremental USD only with positive token/request
   ceilings and independent provider/budget attestations.
8. Candidate evidence must cover every applicable gate and acceptance ID with
   exact denominators, no skip/failure/timeout, trusted producers, immutable
   subject DAGs and every pinned negative control. Candidate-valid is still not
   released.

## Bootstrap order

### B0: make this candidate addressable

- Independently review and commit `candidate/H03/run-001`.
- Re-run all validation on the clean commit. A dirty tree can never be spec-locked.
- Record the commit, tree, complete harness build digest and lockfile digests.
- Do not merge to a Pages-publishing source as part of bootstrap.

### B1: H01 observed baseline

- Use a preauthorized read-only Azure/GitHub identity; do not use interactive
  login, inspect secret values, or modify remote state.
- Record deployed frontend/API byte hashes or explicit unknown, source commit,
  Pages mode, Functions runtime/region, config/infra revisions, secret version
  IDs, data schema/migration head, queue generation and current routes.
- Preserve the serving frontend/API artifacts before changing publishing.
- Resolve current local blockers: Docker Desktop server is stopped; deployed
  frontend and backend artifacts/runtime/config have now been observed read-only.
  Backend historical source commit, data-schema revision, queue generation and
  admissible rollback tuple remain explicit unknowns. The observation still
  requires an independent H01 signature.

### B2: H02 first-root ceremony

- An owner-controlled process creates Ed25519 issuer keys in an external key
  service and publishes only SPKI public keys in `trust-root.json`.
- Pin the canonical root digest as `WATAI_HARNESS_ROOT_SHA256` in separate
  owner-controlled configuration; never store the pin beside the mutable bundle.
- Root digest fields bind backlog, policy, workflow, schema, controller,
  evaluator pack, test inventory, fixture manifest, toolchain, dependency locks,
  impact map and negative-control IDs.
- Separate issuers by artifact kind. Builder/controller identities cannot sign
  evidence, TaskSpec locks, capability attestations, policy candidates or permits.
- The first root is a bootstrap exception record, not self-approval. Every later
  root/policy update is verified by the prior root and cannot remove floors,
  widen limits, increase authority or retroactively pass a candidate.

### B3: finish H03 execution adapters

- Implement the durable candidate/lease/budget/outbox aggregates in a separate
  Cosmos harness container and identity, using partition-local CAS transactions.
- Implement watchdog heartbeats, epoch fencing, effect reconciliation and
  terminal unknown-outcome handling. Run crash injection at every write/dispatch
  boundary, two-controller races, 100 fixed fault schedules and 1,000 seeded
  schedules before attesting the adapter.
- Start Docker and use an approved, content-addressed image source. Public image
  fallback is forbidden. Prove non-root user, read-only root/source, dropped ALL
  capabilities, no-new-privileges, PID/CPU/memory limits, no host home/socket,
  zero tool egress and empty credential environment.
- Docker is running and those controls pass on an unapproved local probe image;
  no ACR exists and the cached base images have public/project-specific provenance.
  Image provenance therefore remains blocked pending an approved source decision.
- Implement the six structured gateway tools. Validate canonical paths after
  symlink/junction resolution, enforce exact writable roots, bound bytes/results,
  execute only fixed validation command IDs, and re-check the resulting diff.
- Prove an unattended Copilot provider path for this personal repository. The
  installed logged-in CLI is not used. Organization-only S2S eligibility must not
  be assumed; a BYOK/subscription adapter needs explicit noninteractive refresh,
  quota and billing evidence.

### B4: H04 independent evaluator

- Freeze evaluator code, trusted build image, test IDs/counts, browser projects,
  fixtures, impact map and negative controls under an issuer unavailable to the
  builder.
- Run candidate code as an untrusted child. The supervisor observes termination,
  hashes raw JSONL/reports itself and signs the immutable packet.
- Establish an approved immutable evidence store and retention policy.
- Execute the full root/API/build/browser inventory three consecutive times with
  zero required skip/failure. Add the DoD fault/property denominators; current
  unit tests prove reducer examples, not those statistical schedules.

The current local inventory is now executable and passes, including the three
browser repetitions and isolated integrations. It still needs an independently
signed evaluator pack, immutable report storage and untrusted-runner isolation.

### B5: H05/H06 release plane

- Build this only after H01-H04 are independently evidenced. It requires isolated
  staging auth/data/queues, immutable frontend/API/config tuples, versioned worker
  queues, release broker, admissible LKG, routing reconciliation, canary and full
  permits, rollback and observation. It is not required to begin blocked-safe
  harness implementation, but it is required to call any product slice released.

## Execution-ready condition

Automated implementation is ready only when `harness:doctor` reports
`EXECUTION_READY`: H01 preflight has no unknown required fact; a valid external
grant and all implementation/evaluation capability attestations pass; Docker and
the structured gateway are independently attested; durable adapters pass their
fault corpus; evaluator/build/browser/evidence packs are pinned; and the scheduler
has a dependency-ready slice. Release remains a separate status.

The status must not be achieved by editing the doctor, removing a capability,
using synthetic test signatures, starting from a dirty tree, or labeling the
local file ledger as durable infrastructure.