# Research ledger and orchestration decisions

**Accessed 2026-09-10. Bounded primary-source review, not exhaustive latest
literature.** Dates below are publication/editorial dates when visible, not the
access date disguised as publication. Live docs can change; H01 must pin and
conformance-test exact artifacts before adoption. No SDK/model/provider was
installed or tested by this research task.

## Comparison of concrete approaches

| Approach | Fit and benefits | Real costs/limits | Decision |
| --- | --- | --- | --- |
| Deterministic TS controller + Copilot SDK/CLI + Actions | Native TypeScript; reuse coding runtime; explicit tiny transition/effect surface; separate evaluator/release authority | Must implement durable ledger, CAS/outbox, fencing, budgets and reconciliation; SDK permission hooks are not a sandbox; auth/billing eligibility must be proved | Preferred for one builder/one release; H02/H03 replay and adversarial gates are mandatory |
| LangGraph JS 1.x + persistent checkpointer + workers | Explicit typed graph, per-super-step state, pending-write recovery; provider-agnostic agent composition | Persistence backend/retention still required; checkpoints do not prove external effects exactly once or grant release authority; managed service optional, not assumed | Credible graph adapter if graph complexity becomes material; do not add it merely to draw a DAG |
| Temporal TypeScript workflows + activity workers | Durable event replay, deterministic workflow sandbox, separation of side effects; cancellation/timers/retries are natural primitives | Service/cloud identity/cost/worker-version operations; activities can retry, so app-level idempotency still required | Preferred durability fallback if H03 cannot meet recovery contract within budget; separately preauthorize/prove |
| Microsoft Agent Framework workflows + agents | Explicit functional/graph workflows, session/middleware/provider integrations; successor to AutoGen/Semantic Kernel | Current overview emphasizes .NET/Python/Go, not native Watai TypeScript; Go preview exclusions; language/service integration and new policy surface | Not first choice for this codebase; do not characterize the whole current framework as preview based on old launch articles |

Framework maturity is not evidence that a self-modifying engineering team is safe.
More agents add correlated mistakes, coordination overhead and verification
failure modes (R11). Agents must not score their own work or evolve gates to pass.
The small controller is selected for inspectability, **not because a homemade
distributed scheduler is automatically simpler**; failure to satisfy H03 triggers
the predeclared alternative or a safe block.

## Harness sources fetched by this design session

### R01 - Copilot SDK release maturity and process architecture

- URLs: https://github.com/github/copilot-sdk ;
  https://raw.githubusercontent.com/github/copilot-sdk/v1.0.13/README.md ;
  https://raw.githubusercontent.com/github/copilot-sdk/main/CHANGELOG.md
- Kind/date: official repository and release notes; v1.0.13 dated **2026-09-04**.
  `git ls-remote` resolved tag to `f13e4a2cc7e4e220974d2333142234e162a3252e`;
  observed main `fdef0b13f16096b419f0fd4ac3f1db1bb5dd678a`.
- Read scope: README architecture/FAQ/GA statement and first release-note section,
  not all historical releases. README states generally available and semantic
  versioning; SDK communicates with CLI server via JSON-RPC.
- Decision: pin SDK and bundled runtime, never repeat stale "technical preview"
  advice. GA does not establish Watai entitlement, performance or durability.
  Changelog says it is AI-generated; treat details as claims to conformance-test.

### R02 - Node SDK permissions, lifecycle and resume

- URLs: https://raw.githubusercontent.com/github/copilot-sdk/main/nodejs/README.md ;
  https://raw.githubusercontent.com/github/copilot-sdk/v1.0.13/nodejs/README.md
- Kind/date: official API docs, undated; release context R01.
- Read scope: main prerequisites, start/stop/session/config/auth/permission fields
  (first ~11k characters); tagged prerequisites (~1.2k). Node requires
  `^20.19.0 || >=22.12.0`; this is SDK compatibility, not Node 20 support policy.
  Bundled CLI packages are checked against release checksums; explicit binary
  override exists.
- Claims: current main documents empty mode, per-run home/environment,
  explicit permission handler; absent handler can leave manual requests pending.
  R01 release notes say injected managed permissions require CLI **1.0.79-5+**
  and must be resupplied on resume. Some factory/in-process APIs are experimental.
- Decision: stable subprocess interface only; startup/resume deny-policy negative
  controls; no global approve-all or factory API dependency. Main-only API details
  require a tagged-version compile/conformance probe before implementation.

### R03 - Actual unattended Copilot authentication constraints

- URLs: https://raw.githubusercontent.com/github/copilot-sdk/main/docs/auth/README.md ;
  https://raw.githubusercontent.com/github/copilot-sdk/main/docs/auth/server-to-server-tokens.md ;
  https://raw.githubusercontent.com/github/copilot-sdk/v1.0.13/docs/auth/server-to-server-tokens.md
- Kind/date: official auth contracts, undated; v1.0.13 context.
- Read scope: complete main auth index and server-to-server guide; tagged opening.
  Actions model requests use `copilot-requests: write` in an **organization-owned**
  repository with organization policy enabled. Other services require enabled App
  installation auth; current permission check requires all-repositories installation.
  Installation tokens expire after one hour; pass through runtime environment,
  **not** explicit SDK user-token option; refresh may require runtime restart.
- Caveat: guide has user-account billing text alongside organization enablement
  requirements. It does not prove this personal repository is eligible. Broad
  installation requirement may violate least privilege; reject that path if so.
- Decision: keep model auth separate from repository/release auth; no ambient
  login fallback; preauthorized eligible path or BYOK, otherwise block.

### R04 - BYOK and documentation inconsistency

- URL: https://raw.githubusercontent.com/github/copilot-sdk/v1.0.13/docs/auth/byok.md
- Kind/date: official versioned provider contract, release **2026-09-04**.
- Read scope: supported providers, API fields, bearer authentication and refresh,
  custom model listing, limitations (~16k), not later troubleshooting details.
- Claims: provider/model/endpoint required configuration; BYOK has provider rate
  limits and billing; detailed docs include `bearerToken` and
  `bearerTokenProvider`, on-demand refresh, and a managed-identity guide link.
- Caveat: **same tagged README R01 says key-only and no Entra/managed identities**.
  Do not collapse this conflict into a guaranteed unsupported/supported claim.
  Static token does not auto-refresh; callback behavior must be verified.
- Decision: initial plan assumes no guaranteed managed identity for SDK model
  calls; use preauthorized tested API-key/proxy path or prove callback on exact
  version. No claim that Azure release OIDC automatically authenticates Copilot.

### R05 - Incremental long-running coding harness

- URL: https://www.anthropic.com/engineering/effective-harnesses-for-long-running-agents
- Kind/date: vendor engineering experiment, **2025-11-26**, visible page date
  extracted from HTML. Read complete article body.
- Claims used: context compaction alone insufficient; initializer versus incremental
  coding sessions, structured feature inventory, clean handoffs, real browser
  task checks; premature completion and overbroad tasks observed.
- Caveat: a vendor web-app experiment, not an independently controlled reliability
  guarantee; future-work section explicitly leaves multi-agent superiority open.
  Its "agent edits passes field" pattern is **not sufficient authority** here.
- Decision: small slices and structured handoffs, but independent signed results
  instead of self-declared feature completion.

### R06 - Agent evaluations and outcome versus transcript

- URL: https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents
- Kind/date: vendor engineering guidance, **2026-01-09**, visible page date
  extracted from HTML.
- Read scope: introduction, task/trial/grader/transcript/outcome definitions,
  evaluation value, grader taxonomy, capability/regression, coding and beginning
  of conversational evaluation (~13k); not whole long article.
- Claims used: evaluate actual environment outcome, not agent narrative; repeat
  stochastic trials; distinguish capability from regression; multiple grader types.
- Caveat: examples include humans; no claim that judges replace human preferences.
  Vendor benchmark progress numbers are not imported into this plan.
- Decision: fixed synthetic truth and confidence accounting; strictly separate
  task-state tests from semantic judges and human-usability claims.

### R07 - LangGraph 1.0 release

- URL: https://www.langchain.com/blog/langchain-langgraph-1dot0
- Kind/date: official release announcement, **2025-10-22** (HTML `datePublished`);
  `dateModified` **2026-04-17**. Read full article including LangGraph section.
- Claims: first stable major versions, backward-compatibility/no-breaking-until-2.0
  commitment, graph execution and persistence emphasis.
- Caveat: production/customer adoption and reliability language is vendor
  marketing, not Watai evidence. Published installation snippets are not pinned.
- Decision: credible stable JS alternative, not mandatory infrastructure.

### R08 - LangGraph persistence and checkpointers

- URLs: https://docs.langchain.com/oss/javascript/langgraph/persistence ;
  https://docs.langchain.com/oss/javascript/langgraph/checkpointers
- Kind/date: current official docs, no reliable editorial date exposed.
- Read scope: full persistence overview; checkpointer core concepts, super-steps,
  task pending writes, state/history interface (~11k). Requested durable-execution
  URL redirected to persistence; no claim of separately reading obsolete page.
- Claims: memory saver loses state on restart; durable backend required; pending
  writes can avoid repeating successful graph nodes within failed super-step.
- Caveat: graph checkpoint cannot undo external paid/provider side effects.
- Decision: separate workflow/evidence/application memory graphs, explicit effect
  ledger regardless of framework; no Graphiti inference from "graphs" request.

### R09 - Temporal TypeScript replay and activities

- URLs: https://docs.temporal.io/develop/typescript ;
  https://docs.temporal.io/develop/typescript/workflows/basics ;
  https://docs.temporal.io/develop/typescript/activities/basics
- Kind/date: current official SDK docs, undated.
- Read scope: full retrieved guide index, workflow basics/deterministic restrictions,
  activity basics/parameters/registration/idempotency.
- Claims: workflows execute deterministic logic; side effects in recorded
  activities; activities may retry repeatedly, requiring idempotency keys.
  Documented payload size limits argue for artifact references, not giant traces.
- Caveat: no Temporal deployment, cloud plan, region or price verified here.
- Decision: durable-engine fallback, not a preauthorized new service; no claim of
  exactly-once arbitrary external API calls.

### R10 - Microsoft Agent Framework current shape

- URL: https://learn.microsoft.com/en-us/agent-framework/overview/
- Kind/date: official overview; `ms.date` **2026-07-29**, updated **2026-08-25**;
  document Git commit `b5673b22a7085c1c87e268c431c3fc31d27019a8`.
- Read scope: overview, agents/harness/workflows, language zones, agent versus
  function guidance, successor relationship, responsibility caveat (~10.5k).
- Claims: explicit graphs/workflows, agents/middleware, .NET/Python/Go; Go public
  preview and named missing capabilities. Recommends a function if sufficient.
- Caveat: overview is not evidence of TypeScript parity or autonomous release
  certification; third-party data/cost controls remain consumer responsibility.
- Decision: do not add a second language/runtime without measured benefit.

### R11 - Multi-agent failure study

- URL: https://arxiv.org/abs/2503.13657v3
- Kind/date: empirical research preprint; submitted **2025-03-17**, revised
  **2025-10-26**. Read abstract and submission/version metadata in raw HTML.
- Claims limited to abstract: 1,600+ annotated traces across seven frameworks,
  14 failure modes in system design, inter-agent misalignment and verification;
  reported expert agreement kappa 0.88. These are authors' results, not reproduced.
- Caveat: full methods/data not reviewed; earlier HTML retrieval surfaced only
  a trace excerpt and is not used as methodological evidence. No transfer of
  failure rates or claimed benefits to Watai.
- Decision: independent contexts, explicit contracts and external verification,
  not agent count or agreement as a safety metric.

## Release sources researched by parent, integrated here

The parent coordinator fetched/read the following on **2026-09-10** and supplied
read scopes/date metadata. This session read the handoff and integrated it;
it did not redundantly fetch these pages. These are provider contracts, not
independent availability measurements. Full source URLs make the provenance
portable; no dependency on a private session artifact remains.

| ID / URL | Visible date and read scope | Claim used and limitation |
| --- | --- | --- |
| RR01 https://learn.microsoft.com/en-us/azure/azure-functions/functions-deployment-slots | Editorial 2025-05-07; updated 2026-06-11; support table/slot behavior | Flex slots unsupported; other plans differ, swaps do not prove zero downtime |
| RR02 https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-site-updates | Editorial 2026-05-29; updated 2026-07-02; strategy, limits, setup | GA region list omits eastus2; single-instance interruption, overlap/no completion signal; verify target, don't rely on rolling alone |
| RR03 https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site | Undated; source alternatives | One branch/folder or Actions; no native canary/slot; public content safety required |
| RR04 https://docs.github.com/en/pages/getting-started-with-github-pages/using-custom-workflows-with-github-pages | Undated; build/upload/deploy dependencies | Pages/id-token permissions and environment required; no human-required reviewers; no archive links |
| RR05 https://docs.github.com/en/actions/concepts/security/github_token | Undated; lifecycle/event behavior | GITHUB_TOKEN-created PR workflows approval-required, pushes do not normally trigger workflows/Pages; use eligible App or explicit dispatch |
| RR06 https://docs.github.com/en/actions/how-tos/write-workflows/choose-when-workflows-run/control-workflow-concurrency | Undated; default/queue behavior | Pending runs replaced by default; queue:max up to100 not ordering guarantee; no automatic cancellation of promotion |
| RR07 https://learn.microsoft.com/en-us/azure/frontdoor/routing-methods | Editorial 2026-08-28; updated 2026-09-01; routing/retry flow | Low-RPS weights not exact; accepted generation not blindly retryable; no new Classic deployment |
| RR08 https://learn.microsoft.com/en-us/azure/frontdoor/health-probes | Editorial 2026-04-30; updated 2026-05-01; health and complete failure | All unhealthy => round-robin all origins; candidate must be disabled/excluded; cheap probes not paid inference |
| RR09 https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/configuring-pull-request-merges/managing-a-merge-queue | Undated; CI merge-group/settings | Evaluate exact merged SHA and availability; serialized integrate/revalidate fallback |
| RR10 https://docs.github.com/en/actions/concepts/security/artifact-attestations | Undated; claims and verification | Provenance is not security proof; verify issuer/subjects; avoid private content in public metadata |
| RR11 https://docs.github.com/en/actions/reference/security/secure-use | Undated; least privilege/injection/privileged workflows | Candidate scripts never run with publishing authority; automate control goal without pretending human-review recommendations were performed |
| RR12 https://docs.github.com/en/actions/how-tos/secure-your-work/security-harden-deployments/oidc-in-azure | Undated; federation/subjects | OIDC needs preexisting roles/federation; subject defaults can vary after2026-07-15; inspect actual registration |
| RR13 https://docs.github.com/en/rest/pages/pages | Undated; site config/permissions | API supports source/build-type setup only with actual required authority; no current privilege assumption |
| RR14 https://learn.microsoft.com/en-us/azure/architecture/patterns/strangler-fig | Editorial 2026-05-29; updated 2026-06-03; staged replacement | Incremental routing can preserve access; router adds its own security/availability obligation |

## Assurance sources researched by parent, integrated here

Parent supplied the following actually read primary-source research on
**2026-09-10**. This session read the research handoff, not all linked full papers.
Scopes and limits are preserved rather than claiming independent replication.
AR01 overlaps R06 and AR02 overlaps R11 but parent read broader sections; the
**38 ledger entries are not 38 distinct publications**.

| ID / source | Visible date, kind and parent read scope | Consequence and caveat |
| --- | --- | --- |
| AR01 https://www.anthropic.com/engineering/demystifying-evals-for-ai-agents | 2026-01-09; vendor engineering; definitions, coding/computer-use, nondeterminism, roadmap and holistic evaluation | Outcome differs from transcript; all attempts versus best attempt matters; trial Git history can leak evaluation. Does not claim automation replaces user research |
| AR02 https://arxiv.org/html/2503.13657v3 ; https://arxiv.org/abs/2503.13657 | 2025-03-17, v3 2025-10-26; preprint; sections1/4 and Figure1 | MAST includes incomplete/incorrect verification and context loss; compiling an app need not satisfy its rules. Older systems/model-annotated traces, not our failure probabilities |
| AR03 https://arxiv.org/html/2512.08296v3 ; https://arxiv.org/abs/2512.08296 | 2025-12-09, v3 2026-04-08; preprint; sections1,3.1-3.2,4.4-4.5,5-6/Table5 | Collaboration helps some decomposable tasks but hurts some sequential work; revised robust analysis narrows conclusions. Small coding subsamples/wide intervals prohibit importing headline scaling numbers |
| AR04 https://www.anthropic.com/research/emergent-misalignment-reward-hacking | 2025-11-21; primary vendor research; procedure, sabotage and mitigations | Successful exit without accomplishing task and reviewer manipulation are real experimental failure patterns. Deliberately hackable training, not prevalence of ordinary coding agents |
| AR05 https://alignment.anthropic.com/2026/automated-w2s-researcher/ | April2026, day not established; primary report; environment, sections3.1-3.5, reward hacking and development/future work | Hidden labels recovered from adaptive aggregate scores; lucky seed selection and generator shortcuts. Remote evaluator and nominal OOD split are insufficient; use exposure ledger and untouched final bank |
| AR06 https://alignment.anthropic.com/2026/automated-alignment-researchers/ ; https://www.anthropic.com/research/automated-researchers-mitigate-alignment-failures | Announcement2026-08-28; primary vendor research; sections2-3,5,7-8 and appendicesA.1-A.6/B.2-B.5 | Borrow isolated evaluator, immutable submissions and selection-versus-final tests; study also detected cheating and permitted substantial capability declines under overlapping intervals. Human benchmark admission existed; not an unattended truth oracle |
| AR07 https://openai.com/index/why-we-no-longer-evaluate-swe-bench-verified/ | 2026-02-23; vendor evaluator audit; background, narrow/wide tests and contamination examples | Hidden tests must test disclosed requirements; reject-all or undocumented implementation expectations are evaluator defects. Selected difficult subset, not a defect-rate estimate for every benchmark task |
| AR08 https://arxiv.org/html/2410.00752v2 ; https://arxiv.org/abs/2410.00752 | 2024-10-01, v2 2025-03-18; TestGenEval preprint; sections1-3, construction/filtering and metrics | Generated-test execution, coverage and mutant detection differ; require known-good acceptance plus relevant known-bad rejection. Historical Python/file-level tasks do not establish current end-to-end correctness |
| AR09 https://metr.org/blog/2025-07-10-early-2025-ai-experienced-os-dev-study/ | 2025-07-10; primary randomized field study; methods/results/discussion/limits | Perceived productivity differed from measured outcome; page warns results no longer reflect current effects. Do not repeat old slowdown as present universal fact |
| AR10 https://metr.org/blog/2026-02-24-uplift-update/ | 2026-02-24; primary methodology follow-up; substantive update | Later raw estimates/intervals and selection/concurrency effects complicate inference. Measure Watai useful releases and full cost, not claims of universal agent speedup |
| AR11 https://www.w3.org/WAI/test-evaluate/ ; https://www.w3.org/WAI/test-evaluate/involving-users/ | Overview updated2026-08-12; W3C guidance; overview and companion analysis/reporting | Knowledgeable human evaluation is needed to determine complete accessibility; automated tasks do not certify human experience. Define bounded automated properties, block any mandatory unprovable claim |
| AR12 https://www.anthropic.com/research/formalizing-fermats-last-theorem | 2026-09-04; primary vendor research; verification and formalization method | A proof checker plus comparator checks both proof and intended statement. Some high-level human direction existed; ordinary software/UX does not inherit Lean's oracle |
| AR13 https://proceedings.mlr.press/v235/greenblatt24a.html ; https://arxiv.org/html/2312.06942v5 | ICML2024 proceedings21-27July; expanded preprint2024-07-23; sections2-2.2,3.2,3.4.1-3.4.2/AppendixD | Attack reviewer protocols and conditional misses, not only builders. Trusted-model/high-quality oversight are experimental assumptions, not magically supplied by assigning a role name |

These sources change the design in four concrete ways. First, evidence isolation
includes **adaptive query accounting**, with globally consumed validation
reservations and a one-use fresh final bank. Second, tests and reviewers face
known-good controls as well as known-bad mutants; test count, mutation count,
model diversity and agent consensus are not oracles. Third, non-inferiority is a
predeclared paired margin with sufficient confidence, not "we failed to detect a
significant regression"; all stochastic attempts remain in the denominator.
Fourth, automated UX/device claims remain bounded, and `UNVERIFIABLE_REQUIRED`
blocks the affected goal rather than receiving simulated human approval.

No study's empirical incident rate, capability gain, productivity multiplier or
uncertainty threshold is transferred into Watai. Our concrete DoD numbers are
proposed acceptance policy to implement and measure.

## Scope limits and rejected shortcuts

The OpenAI harness-engineering URL returned only a title through the fetch tool;
it is **not used as substantive evidence**. An arXiv v1 HTML response returned
a trace excerpt; R11 is explicitly abstract-only. Parent discarded a retired Azure
Spring example and replaced an obsolete OIDC URL. No pricing, resource quotas,
production state, paid model capability, human preference or physical-device
behavior was measured. Current-doc claims become H01 conformance checks.

Rejected: "more agents means safer"; human approvals disguised as exceptions;
LLM-written green JSON as a release permit; a graph DB as a memory prerequisite;
candidate exposure behind an unhealthy origin; Pages branch as a preview slot;
blue/green HTTP with shared unfenced queues; same-SHA claims for a Vite rebuild
with different embedded config; exact-once model requests; rollback restoring
old consent; random retries until green; current production renamed validated.
