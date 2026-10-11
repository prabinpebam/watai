# ChatGPT web parity: investigation, specification and plan

Date: 2026-10-11. Status: **DRAFT FOR REVIEW; documentation only**.
Watai source baseline: `101ecbb5d9784bdadcd807592ba1eb32d2c7fcd1`.
Latest reviewed release record: [0.2.4](../../releases/2026-10-11-v0.2.4.md).

## Objective

Bring Watai as close as practical to the current **ChatGPT web product's user
outcomes**, using Azure-hosted services and original Watai UI/assets. Match useful
workflows, not proprietary implementations, brand assets, subscription products
or unobservable backend details.

The deliverable is a researched specification and implementation plan, **not
permission to begin product coding, provision services, connect accounts or deploy**.

| Document | Purpose |
| --- | --- |
| [01-research-and-evidence.md](01-research-and-evidence.md) | Dated reference facts, access limitations, Watai source map and REA-style observation procedure |
| [02-product-and-architecture-spec.md](02-product-and-architecture-spec.md) | 55-capability gap matrix, target UX, Azure architecture, contracts and measurable acceptance |
| [03-implementation-plan.md](03-implementation-plan.md) | Dependency-ordered slices, existing-backlog integration, validation, milestones and rollout |

## Findings that change the direction

1. The reference has moved beyond traditional chat. Reviewed official July-October
   release notes include unified search, connected files, scheduled/event-driven
   work, interactive quizzes, Pages, Space, Sites, ongoing agents and Intelligent UI.
2. Watai already has meaningful foundations: server-owned queued generation,
   SignalR/polling, tools, generated files, Library, Image Studio, voice and memory.
   This is an additive program, not a rewrite.
3. Capability reporting currently infers several tools from the endpoint hostname.
   A model catalog entry or configured name is not evidence that a user's actual
   deployment supports a feature.
4. Temporary Chat is explicitly unavailable; regeneration currently removes
   trailing assistant messages. Privacy lifecycle and branch/version semantics
   need deliberate contracts before parity expansion.
5. Current Microsoft documentation lists newer GPT families and Responses support,
   but region, quota, deployment, API and model compatibility remain unverified for
   Watai. Azure model access does not include ChatGPT's product services.
6. The source/docs/release baseline differs: older specifications describe
   client-owned orchestration or Durable Functions, while current source uses
   server-owned Storage Queue workers. Production 0.2.4 still runs Node 20 although
   source/infrastructure declare Node 24. Preserve these distinctions.

## Evidence boundary

The initial desk-research stage used REA's **observe -> trace -> evidence -> explain
-> plan** discipline, but did **not** install or execute REA or launch a browser.
No stage captured a signed-in ChatGPT session, inspected its private servers or
invoked Azure models. Documented reference behavior is not browser-observed behavior.

Following the user's request to perform the necessary Edge setup, one owned
**headless Edge** canary reused an
existing private, idle automation profile with Playwright and pre-navigation
read-only guards. The guards blocked a non-read request, and no authenticated app
controls were captured. The requested active Edge profile was separately matched
using account metadata, but its cookie store is locked (Windows error 32); no
cookie bytes were read/copied and the user's Edge was not restarted. See the
[browser attempt record](01-research-and-evidence.md#52-headless-playwright-attempt).

Some official Help and announcement pages returned HTTP 403; the pricing page
provided only its title, and two pages had insufficient extraction. These are
evidence gaps, not evidence that the features are absent. Exact account entitlements,
interaction details and production end-to-end behavior remain open.

**No claim of exhaustive current ChatGPT coverage or 1:1 parity is made.** The
55 rows are a broad, explicitly bounded reference inventory. Authenticated
observation must discover additional features and refine this version before an
implementation slice claims exact behavioral parity.

## Recommended sequence

1. Establish truthful deployment/model/tool capability and privacy contracts.
2. Preserve conversation branches; add unified search and useful audio ingestion.
3. Add private Projects with explicit context isolation.
4. Add typed interactive responses and an editable document/code workspace.
5. Add bounded Research/Work, then read-only connected sources.
6. Add scheduled work and collaboration; put browser actions and ongoing agents
   behind a separate isolation/authorization gate.

Deliver one coherent validated user-visible milestone at a time. Do not wait for
every frontier feature before shipping useful improvements, and do not count
disabled controls or a source-only test as completed capability.

## Relationship to existing plans

This is an additive web-parity direction. It does not replace the canonical
[safety backlog](../2026-09-10-autonomous-delivery/04-implementation-backlog.md),
close its findings, waive [EDD preparation](../../quality-gate/05-evaluation-and-design-system.md),
or overwrite the existing [Library](../../library-implementation-spec.md),
[memory](../../memory-system/README.md), [voice](../../voice-implementation-plan.md)
and [agentic](../../agentic/README.md) contracts. Where historical intent disagrees
with current source, the research ledger records the distinction; resolution is a
specific implementation task, not an assumption.
