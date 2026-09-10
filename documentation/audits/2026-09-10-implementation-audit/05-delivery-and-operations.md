# Delivery, evaluation, operations, performance, and cost

Baseline and limitations: [methodology](00-methodology.md).
External evidence: [operations source register](research/operations-sources.md).
Execution results: [validation log](evidence/validation.md).

## Assessment

Watai is not an untested sketch. It has strict TypeScript, domain/service tests,
in-memory adapters, opt-in Azure integration tests, browser experience tests,
design-token checks, Bicep infrastructure and real latency investigation history.
Those are valuable foundations.

The weakness is the transition from **locally credible code to reproducibly
operated software**. A supported runtime, a complete environment declaration,
release gates, user-visible health signals, and rehearsed data recovery are not
established together. These matter more now than another architectural layer.

| Category | Rating | Confidence | Why not higher |
| --- | ---: | --- | --- |
| C11 Testing and evaluation | 5/10 | Medium | Substantial deterministic checks, but no checked-in CI gate and incomplete evidence for live system contracts and end-to-end model usefulness |
| C12 Delivery and operational readiness | 3/10 | High for repository evidence; low for deployed controls | EOL runtime in IaC, incomplete environment declaration, manual delivery, no repository-defined recovery/SLO system |
| C13 Performance and cost engineering | 4/10 | Medium | Sensible warm-worker and benchmark work, but historical small samples and no demonstrated per-success unit economics or enforced spend limits |

These ratings do not imply the deployed service is currently down, that no
backups exist, or that no Azure alerts have been configured manually.

## C11: testing is a foundation, not yet an assurance system

### What is present

The root `package.json:7-15` includes unit tests, a design-system guard and a
typechecked production build. `api\package.json:8-22` separates tests,
typechecking and bundling. Both TypeScript configurations use `strict`;
the backend additionally enables unused-variable/parameter checks.

`vitest.config.ts:5-13` uses jsdom for frontend tests;
`api\vitest.config.ts:3-9` uses Node and longer timeouts.
`playwright.config.ts:15-40` defines Chromium desktop/mobile and iPhone-like
WebKit projects, traces/screenshots on failure, and a locally managed Vite
server. There are three browser suites: library experience, viewport frame,
and authentication iframe behavior.

Azure integration tests are explicit, but enabled by the presence of cloud
environment variables, not a separate safe-test subscription assertion:

- `api\src\adapters\azure\sasMinter.integration.test.ts:7-11`;
- `api\src\adapters\cosmos\messageStore.integration.test.ts:7-23`;
- the settings, invite and thread store integration tests use the same pattern.

Their local skip status is not a failure. Conversely, a passing default suite
does not exercise Cosmos semantics or SAS authorization against a real account.

The actual baseline run is recorded separately so test counts and tooling
failures are not confused with a product-quality score.

The audit run passed **231 frontend tests** and **557 API tests**, with **11
live-service integration tests deliberately skipped**. Both builds and API
typechecking passed. The complete browser matrix recorded **36 passed, 16
skipped and 8 failed**. A targeted single-worker follow-up passed all previously
failing cases, but did not replace the failed full-matrix result. This is useful
evidence of substantial local coverage and an unstable browser gate, not a
production reliability measurement.

### Research-grounded improvements

[O04](research/operations-sources.md#o04) supports the existing use of isolated
browser fixtures and user-facing interactions. Extend this rather than replacing
it with a large new testing framework. The missing layers are:

| Layer | What it should establish | Appropriate execution |
| --- | --- | --- |
| Domain and service tests | Deterministic invariants, consent decisions, merge semantics | Every relevant PR |
| Adapter contract tests | Real optimistic concurrency, partition keys, conditional writes and blob authorization | Disposable, explicitly named test resources |
| Resilience scenarios | Duplicate delivery, accepted-but-not-enqueued runs, process interruption, late events, deletion races | Controlled queue/storage fixtures plus isolated cloud exercises |
| End-to-end product journeys | Login/account switching, send-close-reopen, memory correction, offline conflicts, file lifecycle | Deterministic browser network fixtures; complementary staging smoke runs |
| Model evaluations | Relevant recall, false memory, temporal reasoning, abstention, task completion and tool selection | Versioned data and provider settings, repeated paired comparisons |
| Release smoke checks | Exact built artifacts can load, authenticate, create a run and recover state | The promoted artifact, not only Vite development mode |

Model evaluation guidance [O05](research/operations-sources.md#o05) emphasizes
distribution-specific data, human calibration and continuous comparisons.
That means evaluating *answer usefulness with and without memory*, not only
JSON parsing, extraction counts or retrieval ranking. Details belong in
[the memory proposal](06-memory-redesign.md).

Do **not** introduce a dependency on the hosted OpenAI Evals platform: its
2026-06-03 deprecation notice specifies a late-2026 transition
[O15](research/operations-sources.md#o15). Keep datasets and a runner interface
owned by Watai. A new evaluation service is optional, not the first dependency.
OpenAI platform notices do not establish Azure model retirement dates.

**To reach 7:** green reproducible deterministic gates, controlled adapter and
critical-journey coverage, an explicit failure inventory, and a held-out memory
comparison that is reviewed before promoting behavior changes. These are
proposed graduation conditions, not claims about current coverage.

## Findings and implementation proposals

### OPS-01 - Infrastructure still specifies an end-of-life Node runtime

**P1; observed configuration; high confidence.** `infra\main.bicep:287-290`
specifies Node `20`. `README.md:58-64` recommends Node 20 or 22.
`api\package.json:20` bundles for Node 20 (a compile target, not independently
proof of the host runtime).

Node's current release table marks Node 20 EOL
[O01](research/operations-sources.md#o01). Azure Functions now lists Node 22 and
24 as GA-supported [O02](research/operations-sources.md#o02); this is a concrete
date-sensitive issue, not a preference for new dependencies.

**Impact:** recreating an environment from the template selects a stale runtime;
if production matches it, upstream runtime maintenance is no longer assured.
The deployed version was not queried.

**Proposal:** migrate and pin local, test, build and Function runtime to a
verified Node 24 baseline. Use Node 22 only if a demonstrated compatibility
constraint requires a bridge. Update the bundled target only after deciding
whether older-runtime compatibility remains intentional. Add an `engines`
policy and documented local version selection.

**Tradeoff:** runtime upgrades can change dependency/platform behavior; do not
combine this with a memory rewrite or every dependency major upgrade.

**Acceptance:** clean installs and all required checks under the selected
version; deploy an isolated environment; verify native/module loading, auth,
queue execution and a complete run; compare artifact/runtime metadata before
production promotion. Rollback must use a supported compatible artifact/runtime,
not silently normalize continued EOL operation.

### OPS-02 - The declared environment does not reproduce all advertised capabilities

**P1; observed omission plus conditional deployment risk; high confidence.**
`README.md:18-39` describes SignalR and server-authoritative workers.
`infra\main.bicep:299-318` declares an entire app-settings array, but the template
contains no SignalR resource or SignalR connection setting. The shipped
SignalR adapter exists in `api\src\adapters\azure\signalr.ts`.

This is not evidence that the current service has no SignalR. It establishes
that the environment is not fully reproducible from this template. The root
README already warns of full-replacement settings at `README.md:145`.
Microsoft explicitly confirms ARM/REST app-setting replacement
[O03](research/operations-sources.md#o03).

**Impact:** a fresh environment can lack a feature, and a later full deployment
can erase externally configured settings. Polling fallback may conceal the
configuration regression while increasing latency/load.

**Proposal:** create a typed configuration inventory: required, optional, secret,
resource-owned, default and environment-specific values. Declare supported
feature dependencies or reference deliberately external resources. Validate
configuration before accepting traffic and make optional capability status
visible. Reconcile settings deliberately; use what-if, not a blind full deploy.

**Tradeoff:** consolidating settings increases deployment discipline but should
not import secret values into source control. Use references/federated identity
where supported, with scoped runtime access.

**Acceptance:** provision a disposable environment from documented inputs and
exercise chat, realtime/fallback, memory and file paths; apply the same template
again and prove required settings survive. Record expected intentional
differences between environments.

### OPS-03 - Release correctness depends on a manual build-and-publish procedure

**P1 before widening use; observed repository gap; high confidence.**
`git ls-files .github` returns no tracked workflow files.
`vite.config.ts:11-15` builds directly into tracked `docs`, and
`README.md:104-126` describes committing that output and separately publishing
the Function app.

A GitHub Pages platform deployment may exist; no claim is made that there is
no external automation or branch protection. The source tree itself does not
tie frontend/backend artifacts to one validated revision.

**Impact:** stale bundles, mismatched API/client versions, local toolchain
differences and omitted checks can reach deployment.

**Proposal:** add a modest CI pipeline with locked installs, frontend/backend
validation, deterministic model-independent fixtures and artifact production.
Promote those exact artifacts with source SHA/build metadata. Keep API changes
backward-compatible across the frontend service-worker update window.
Use narrowly scoped GitHub-to-Azure OIDC rather than a long-lived publish secret
[O10](research/operations-sources.md#o10). Add provenance incrementally
[O11](research/operations-sources.md#o11).

**Alternatives:** GitHub Pages Actions artifacts avoid routine committed bundle
churn; retaining branch-based Pages is acceptable if CI rebuilds/verifies it.
Neither choice requires moving the frontend to a new platform.

**Acceptance:** a failing gate prevents promotion; one source revision identifies
both artifacts; a staging smoke check runs against built output; previous
artifacts can be restored without rebuilding. Validate actual OIDC claims rather
than copying an outdated subject format.

### OPS-04 - Infrastructure monitoring is not the same as application health

**P2; observed repository gap; high confidence in scope, unknown production
coverage.** `infra\main.bicep:90-109` creates Log Analytics and Application
Insights; `api\host.json:3-6` enables sampling with requests excluded from
sampling. `api\src\functions\health.ts:3-20` deliberately provides liveness only.
The template contains no alert rules, action group, SLO workbook, or recovery
runbook. Application diagnostics include ad hoc console messages rather than
a demonstrated correlated, content-free run/cost measurement system.

The liveness endpoint is correctly simple; making every liveness call query
every dependency would be a poor fix. The gap is separate readiness, completion,
queue-age and feature-health evidence.

**Proposal:** record a run correlation identifier and structured stages:
accepted, queued, claimed, context-ready, provider-started, first-token,
persisted, notified, terminal. Expose safe aggregate capability/readiness
information; distinguish realtime degraded from generation failed.
Use latency, traffic, errors and saturation [O06](research/operations-sources.md#o06).

**Privacy constraint:** never record prompts, decrypted keys, SAS tokens,
raw memory, user file names or provider response bodies by default. Redacted
operational telemetry and consented evaluation datasets are different systems.

**Acceptance:** deliberately disable notification delivery in staging and
observe a degraded-mode signal while polling still completes; interrupt a
worker and observe age/recovery signals; trace one synthetic run across
HTTP/queue/provider/persistence without content exposure. An actionable alert
must identify an owner and a recovery procedure.

### OPS-05 - Recoverability and privacy-preserving restore are not demonstrated

**P1 before claiming durable personal knowledge; observed policy omissions,
inferred recovery risk; medium-high confidence.**
`infra\main.bicep:113-127` selects one Cosmos region without an explicit backup
policy. Storage is `Standard_LRS` at `169-180`; the blob service at `184-203`
declares CORS but not soft-delete/version-retention policies. Key Vault enables
soft delete for seven days at `218-229`, but this is not a complete credential
recovery/rotation drill.

Cosmos has platform backup behavior; **absence of a declared continuous policy
does not mean no backups exist**. Neither platform replication nor an available
backup proves that the application can recover coherent threads, media,
credentials and memory.

**Proposal:** define recovery point/time objectives proportionate to a private
app. Specify retention and restoration across Cosmos, Blob, credential wrapping
keys, settings, skills and external provider resources. Evaluate continuous
backup [O12](research/operations-sources.md#o12) and Blob soft delete
[O13](research/operations-sources.md#o13), then rehearse a restore into an
isolated account.

**Essential memory condition:** deletion tombstones and consent state must
survive restoration. Before serving restored data, reapply erasure records,
rebuild derived indexes and prevent old jobs from recreating forgotten memory.
A deleted item may remain in an explicitly disclosed backup retention window;
it must not become active knowledge again.

**Tradeoff:** more retention aids recovery but costs money and lengthens erasure
timelines. Do not enable indefinite versioning or silently promise instant
physical erasure.

**Acceptance:** timed restore of a synthetic account with a thread, image,
credential and subsequently deleted memory; answer retrieval must not recover
the forgotten fact. Document measured recovery times, residual retention and
who can authorize restore.

### OPS-06 - Performance evidence is useful but too narrow for current SLOs

**P2; observed evidence limitation; high confidence.**
`documentation\ttft-browser-bench.md:3-10` records a June 30, 2026 browser run
with five repetitions each of four text prompts. Recorded median TTFT ranges
from 4,076 to 5,762 ms. These are historical observations, not measurements
made during this audit.

`scripts\ttft-bench.mjs:54-66` computes the reported p95 from sorted samples.
At five samples, that statistic is simply the maximum sample. This is fine for
a small diagnostic, not a stable production tail-latency estimate.
`api\scripts\pipeline-bench.ts:47-70` supports repeated provider timing and
reports sample counts, but remains a manually run, provider-dependent probe.

**Proposal:** separate acknowledgement, queue delay, context/memory latency,
provider TTFT, inter-token delay, persistence and client rendering. Compare
memory off/profile-only/hybrid on identical workloads. Segment cold/warm,
history size, file/tool use, failures and deployment/model versions. Never
exclude failures from usefulness or cost denominators.

Reduce avoidable sequential model calls before introducing faster infrastructure;
parallelize only independent, policy-safe work. Do not speculatively execute
irreversible tools or memory mutations. This applies the request-count and
deterministic-alternative principles in
[O17](research/operations-sources.md#o17), without importing provider-specific
speedup percentages.

**Research:** Azure differentiates quota, actual throughput and per-call
latency [O09](research/operations-sources.md#o09); SRE warns against averages
concealing tail failures [O06](research/operations-sources.md#o06).

**Acceptance:** a versioned synthetic workload with at least 100 completed-or-
failed attempts per important variant as an initial engineering sample; report
counts, medians, tails, errors and uncertainty. This sample size is a proposed
starting point, not a proof of statistical sufficiency. Set the final latency
budget from measured user needs and a stable baseline, not the June maximum.

### OPS-07 - Scaling and warm capacity are not spending controls

**P2; observed configuration and absent demonstrated budget enforcement;
medium-high confidence.**
`infra\main.bicep:51-59,274-285` parameterizes warm HTTP/run workers.
`infra\main.dev.bicepparam:14-15` chooses HTTP=0 and runWorker=1; the template
defaults differ. This is a sensible latency/cost tradeoff and must not be
misreported as two warm groups in the dev parameter set.

The template's maximum instance count, one-second polling, 16-message queue
batches and warm instances do not cap a user's model/tool bill.
Current Flex guidance explicitly separates group scaling, always-ready
baseline billing and regional capacity [O07](research/operations-sources.md#o07).

**Proposal:** measure and budget the cost of a *successful useful turn*:

```text
total period cost =
  shared warm capacity + on-demand execution + storage + database + telemetry
  + model input/output + extraction/embedding + provider tools/files

cost per useful turn =
  total attributable cost / turns meeting the agreed success criteria
```

Record provider token usage and tool fees separately from estimates; collect
Cosmos request charges [O08](research/operations-sources.md#o08).
Allocate shared fixed cost explicitly rather than hiding it in request metrics.
Add per-user reservations/concurrency/token/tool budgets with a documented
overshoot bound, plus subscription alerts. An alert is not a hard cap; cancellation
does not guarantee a provider reverses charges.

**Alternatives:** retain worker-only warm capacity, make fully warm mode an
explicit choice, or tune memory/instance size only after load measurement.
Do not jump directly to a new queue platform, provisioned model capacity or a
separate vector database without measured bottlenecks.

**Acceptance:** dashboard reconciles modeled costs with billed totals within an
agreed tolerance; a synthetic runaway tool loop is stopped by policy; two
concurrent requests cannot both spend the same remaining reservation; failures
and retries remain charged to the accounting ledger.

### OPS-08 - Documentation mixes current contracts, old assumptions and historical decisions

**P2; observed inconsistency; high confidence.**
The root README describes encrypted server-side credentials.
`documentation\README.md:12-18` explains that pivot, but its
`118-150` architecture section still says secrets remain on the client.
`infra\main.bicep:1-3` also retains the old persistence-only/key-never-touches-
server statement. The cold-start plan's pending status at `:3` and later
deployed/worker-only statements at `:132-140` conflict.

**Impact:** future contributors can make changes against the wrong trust model,
misunderstand resource requirements or mistake historical measurements for
current operational guarantees.

**Proposal:** mark documents as normative/current, implemented-but-not-deployed,
proposal, or historical; include owner, reviewed revision and superseding link.
Keep one current architecture and environment contract. Archive old decisions
without deleting their rationale. Repair directly contradicted summaries before
expanding documentation further.

**Acceptance:** a new contributor can identify credential location, authority
for each entity, current deployment path and known limitations without
reconciling conflicting prose. Link and source-contract checks should catch
stale references. This audit itself uses the pinned revision to avoid becoming
an unqualified claim about future behavior.

### OPS-09 - Toolchain maintenance and checks need an explicit policy

**P2; observed maintenance gap; high confidence; no advisory assertion.**
The lockfiles pin Vite 5.4.21 and Vitest 2.1.9; root esbuild is 0.21.5 and backend
direct esbuild is 0.24.2. No runtime-version selector or package `engines`
constraint is tracked. `scripts\check-design-system.mjs:1-22` checks particular
color literals and native selects; it is not a general code, semantic HTML or
accessibility linter.

**Proposal:** document the supported Node/package-manager versions and adopt a
monthly dependency triage with supported-range/advisory review
[O14](research/operations-sources.md#o14). Upgrade in separately reviewable
steps. Preserve the useful design check while being precise about what it proves.
Decide separately whether additional static checks would prevent demonstrated
errors; do not install a large lint stack merely to improve a score.

**Acceptance:** clean lockfile installs are repeatable; release notes and
applicability determine upgrades; any known applicable advisory has a disposition
and owner. Older React or Vite alone is not proof of an exploitable vulnerability.
No full dependency security scan was performed in this audit.

### OPS-10 - The full browser gate is not repeatably green

**P2; observed execution; high confidence in outcomes, medium in cause.**
The post-install full run used the existing three-project Playwright matrix.
Seven failures stopped at initial loading/readiness deadlines, before their
viewport or empty-state assertions. The other failed at
`tests\e2e\library-experience.spec.ts:254`: a non-exact Upload locator matched
four buttons once catalog rows loaded. Full details and screenshots/traces are
identified in [validation evidence](evidence/validation.md).

**Interpretation:** all eight failed cases passed in one targeted serial run.
That supports timing/harness sensitivity, not a proven upload or viewport
implementation regression. Worker count, development-server warm state and
timing changed together; the unique cause was not isolated.

**Proposal:** make intended action locators exact/scoped, establish explicit
fixture readiness, control worker resources, and run a repeated cold-start
matrix. Consider built-preview smoke tests alongside development fixtures.
Follow user-visible test contracts and isolation guidance
[O04](research/operations-sources.md#o04); do not merely hide the failures with
more retries.

**Acceptance:** the complete matrix passes in three clean isolated runs under
the intended CI worker configuration; intentional skips are listed; a deliberately
broken viewport/upload assertion still fails. The three-run gate is a proposed
initial confidence check, not a statistical flake-rate guarantee.

## A proportionate operating model

The following are **proposed initial targets**, to be calibrated after
measurement. They are not provider guarantees or current achievements.
Use them as an owned decision process, not an unachievable 100% availability
promise; that distinction follows
[O16](research/operations-sources.md#o16).

| Signal | Initial operating question / gate | Owner |
| --- | --- | --- |
| Accepted runs | Does every accepted run reach a terminal state or visible recoverable error? | Backend |
| Queue age | Are jobs waiting beyond the documented run budget, and is recovery working? | Backend/operations |
| Memory safety | Can disabled/deleted memory be used or resurrected under retries/restores? Zero violations in the adversarial release suite | Memory/backend |
| Realtime delivery | Does notification failure produce a visible degraded mode with correct polling? | Backend/frontend |
| Useful-answer latency | Paired memory-on/off stage timing, not only model duration | AI/frontend |
| Spend | Per-user reservation, retry/tool accounting, fixed-cost visibility | Backend/operations |
| Recovery | One isolated restore rehearsal before claiming a recovery objective | Operations |
| Release | Same source revision, validated artifacts, documented rollback | Maintainer |

One owner can fill several roles. A small dashboard, a short runbook and a
reliable pipeline are sufficient initially; a separate SRE platform is not.

## Sequencing and alternatives

Start with the runtime, broken gates (if any), environment reconciliation and
trust-critical worker/memory contracts. Then add reproducible promotion and
minimal stage telemetry. Run controlled evaluations before optimizing retrieval
or warm capacity. Rehearse recovery before expanding to more users.

Keep the current React/Azure Functions/Cosmos architecture unless measurements
show it cannot meet the required contracts. The research supports better
discipline and evidence; it does not establish that Kubernetes, a graph database,
microservices, a new frontend framework or a hosted evaluation platform is
required.
