# Operations, testing, performance, and delivery research

All entries were fetched and read on **2026-09-10**. Dates below are the dates
visible in the fetched source, not inferred publication dates. Microsoft Learn
often exposes both `ms.date` (editorial date) and `updated_at` (site update);
these are recorded separately when useful. Findings and proposed targets are
in [the operations assessment](../05-delivery-and-operations.md).

## O01

**Node.js Releases** - Node.js project.

URL: https://nodejs.org/en/about/previous-releases

Type: official lifecycle guidance. No page publication date shown. The fetched
table labels Node 20 EOL, Node 22/24 LTS; listed release updates include Node 24
on 2026-09-07 and Node 26 on 2026-09-09.

Supported claim: production should use Active or Maintenance LTS; Node 20 is no
longer a supported upstream baseline at this audit date. Applies to C12 and
`infra\main.bicep:287-290`. Does not prove the deployed runtime still matches IaC.

## O02

**Supported Languages in Azure Functions** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/azure-functions/supported-languages

Type: official platform support. Editorial date 2025-08-21; site update
2026-06-03. The Node table lists Node 24 GA through 2028-04-30 and Node 22 GA
through 2027-04-30.

Supported claim: a migration should target an Azure-supported runtime, not just
the newest local Node release. C12. Together with O01, supports preferring Node
24 for a tested migration, with Node 22 a shorter-lived compatibility bridge.
Availability still needs confirmation for the actual host and region.

## O03

**App settings reference for Azure Functions** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/azure-functions/functions-app-settings

Type: official deployment contract. Editorial date 2025-12-22; site update
2026-07-21. Read the introduction and "App setting considerations", including
the ARM/REST full-replacement warning.

Supported claim: ARM/REST app-setting updates replace the existing collection;
omitted settings can disappear. Changes also restart apps by default; rolling
updates have plan-specific support. C12. Supports an environment contract and
reviewed what-if before deployment, not a blanket ban on Bicep.

## O04

**Playwright best practices** - Playwright.

URL: https://playwright.dev/docs/best-practices

Type: official testing guidance; publication/update date not exposed.

Supported claim: test user-visible behavior with isolated state, resilient
locators, and controlled external dependencies. C11. Local fixture tests are
valuable but do not establish real authentication, multi-device consistency,
or deployed-provider correctness. Mocked external services are not inherently
a testing defect; missing complementary contract tests are the concern.

## O05

**Evaluation best practices** - OpenAI.

URL: https://developers.openai.com/api/docs/guides/evaluation-best-practices

Type: official AI evaluation guidance; publication/update date not exposed.
The older platform URL redirected here. The fetched page includes a current
Evals-platform deprecation notice; see O15.

Supported claim: model behavior needs task-specific datasets, held-out cases,
continuous comparisons, and human-calibrated grading. C11, C07. Evaluation
examples on the page are examples, not Watai acceptance thresholds. Its
"log everything" advice is deliberately narrowed here to redacted, consented
evaluation data and content-free operational telemetry.

## O06

**Monitoring Distributed Systems** - Google SRE book, Rob Ewaschuk.

URL: https://sre.google/sre-book/monitoring-distributed-systems/

Type: primary engineering reference; page update date not exposed. Read the
monitoring principles and golden-signals/tail-latency sections.

Supported claim: instrument user-visible latency, traffic, errors and saturation;
combine black-box and white-box signals and keep alerts actionable. C12, C13.
This is a durable principle, not new 2026 research and not a demand for a
Google-scale observability organization.

## O07

**Azure Functions Flex Consumption plan hosting** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/azure-functions/flex-consumption-plan

Type: official runtime/billing guidance. Editorial date 2026-08-04; site update
2026-08-12. Read scaling, always-ready, deployment, billing, and supported
language sections.

Supported claim: HTTP and individual queue functions can scale separately;
always-ready has continuously billed baseline capacity plus execution charges,
without free grants. The current guidance offers rolling site updates rather
than assuming traditional deployment slots. C12, C13. A configured maximum
instance count is not an application spend cap; current guidance distinguishes
function-group limits, always-ready capacity and regional quotas.

No current price quote or performance improvement was measured. Use regional
pricing and billing telemetry before making a dollar commitment.

## O08

**Find Request Unit Charge for a SQL Query** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/cosmos-db/find-request-unit-charge

Type: official measurement guidance. Editorial date 2024-11-07; site update
2026-04-27. The older `/nosql/` URL redirected to this address.

Supported claim: measure database operation cost using SDK response request
charges or portal query statistics rather than guessing from request counts.
C13. This does not establish a fixed RU price or current Watai RU usage.

## O09

**Azure OpenAI in Microsoft Foundry Models performance & latency** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/latency

Type: official provider guidance. Editorial date 2026-05-14; site update
2026-06-05. Read throughput estimation and latency decomposition.

Supported claim: model, input/output shape, deployment load, token throughput,
and cache match rate influence performance. Quota is not guaranteed throughput.
Distinguish first-token latency from token generation duration. C13.
Its sizing examples are not Watai measurements or grounds to buy provisioned
capacity before measuring the actual workload.

## O10

**OpenID Connect** - GitHub Actions documentation.

URL: https://docs.github.com/en/actions/concepts/security/openid-connect

Type: official delivery/authentication guidance; update date not exposed. The
page notes an immutable default subject format for repositories created after
2026-07-15.

Supported claim: a workflow can exchange a narrowly scoped federated identity
for short-lived cloud credentials instead of storing a deployment secret.
C12. OIDC is not authorization by itself: constrain issuer, audience, repository,
branch/environment and actual subject claims. Do not copy an old subject example
without checking this repository's emitted claims.

## O11

**SLSA v1.1 levels** - SLSA project.

URL: https://slsa.dev/spec/v1.1/levels

Type: versioned supply-chain specification overview. Version 1.1; page date
not exposed.

Supported claim: build provenance connects source inputs, process and artifact;
hosted/signed provenance provides stronger guarantees than an undocumented
local build. C12, C11. This audit does not certify a SLSA level or require L3 for
a personal application.

Freshness limit: the attempted `https://slsa.dev/spec/v1.2/levels` returned 404.
The readable v1.1 snapshot is used only for the explicit provenance principle;
it is not asserted to be the latest version.

## O12

**Continuous Backup with Point-in-Time Restore** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/cosmos-db/continuous-backup-restore-introduction

Type: official data-protection guidance. Editorial date 2026-07-13; site update
2026-08-27.

Supported claim: Cosmos supports explicit point-in-time recovery policies and
restore operations. C12, C10. Absence of an explicit policy in Watai's Bicep does
not mean Cosmos has no platform backups. A Cosmos restore alone does not restore
Blob assets, encryption keys, settings, provider-side files, or enforce memory
deletion tombstones.

## O13

**Soft Delete for Blobs to Recover Data** - Microsoft Learn.

URL: https://learn.microsoft.com/en-us/azure/storage/blobs/soft-delete-blob-overview

Type: official data-protection guidance. Editorial date 2026-08-20; site update
2026-08-25.

Supported claim: soft delete retains recoverable objects for a configured
interval; versioning adds storage cost and needs lifecycle management. C12, C10,
C13. Retention is a tradeoff with erasure expectations; recovery and deletion
policies must be designed together, not enabled indiscriminately.

## O14

**Vite Releases** - Vite project.

URL: https://vite.dev/releases

Type: official maintenance policy; publication/update date not exposed. The
rendered version-list values were not present in the fetched text.

Supported claim: maintenance is limited to specific recent major/minor ranges,
and upgrades should follow migration guides. C12, C11. The lockfile's Vite 5.4.21
and Vitest 2.1.9 justify a maintenance review, not an unsupported claim that every
old package is vulnerable. A version-specific advisory inventory was not run.

## O15

**Deprecations - Evals platform, announced 2026-06-03** - OpenAI.

URL: https://developers.openai.com/api/docs/deprecations#2026-06-03-evals-platform

Type: official product lifecycle notice. Section announcement 2026-06-03.

Supported claim: the fetched notice says existing Evals become read-only
2026-10-31 and the dashboard/API are scheduled to shut down 2026-11-30. C11.
Do not introduce a new dependency on that hosted platform for this roadmap;
retain Watai's own versioned datasets and runner interface. This is not an
Azure model retirement claim, and the underlying evaluation methodology in
O05 remains useful independently of the hosted product.

## Research-to-category coverage

| Category | Sources used | Main decision informed |
| --- | --- | --- |
| C11 Testing/evaluation | O04, O05, O11, O14, O15 | Separate deterministic tests, system contracts and model evaluations; build reproducibly; avoid a newly deprecated hosted-evals dependency |
| C12 Delivery/operations | O01, O02, O03, O06, O07, O10, O11, O12, O13, O14 | Supported runtime, declarative environment contract, traceable release, symptom monitoring and rehearsed recovery |
| C13 Performance/cost | O06, O07, O08, O09, O13 | Measure end-to-end stages and unit economics; tune warm capacity, retrieval and storage only after measurement |

## O16

**Implementing SLOs** - Google SRE workbook, Steven Thurgood and David Ferguson.

URL: https://sre.google/workbook/implementing-slos/

Type: primary engineering reference; page update date not exposed. Read the
introduction, adoption conditions, user-oriented targets and initial SLI design.

Supported claim: reliability targets should represent customer needs, be owned,
influence release decisions and evolve with evidence; 100% availability is not
a realistic universal SLO. C12, C13. This does not relax correctness/security
invariants: "zero consent violations in a release test suite" is a safety gate,
not a claim of 100% production availability.

## O17

**Latency optimization** - OpenAI.

URL: https://developers.openai.com/api/docs/guides/latency-optimization

Type: official optimization guidance; publication/update date not exposed.
Read the seven principles and their tradeoffs.

Supported claim: request count, output length, independent-stage parallelism,
streaming, and deterministic alternatives can matter more than indiscriminately
shrinking all context or selecting a larger model. C13, C06. Apply those principles
to measured stages; do not transfer the page's heuristic latency percentages or
OpenAI-specific features to Azure without verification. Speculative execution is
not recommended for irreversible tools or consent-gated memory operations.
