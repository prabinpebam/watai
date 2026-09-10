# Executive audit and scorecard

**Overall engineering assessment: 4.2/10.**

Watai has substantial working functionality and a sensible architecture, but its
strongest product promises are not consistently enforced. The main problems
are ownership boundaries, concurrent state changes, durable execution, privacy
controls, memory semantics, and recovery. **Preserve the architecture; repair
the contracts before expanding the feature set.**

This is a source-grounded judgment of the implementation at
`f7dc195300c4039aae5b9a7a8fb1691327864ea1`, researched on 2026-09-10.
It is not a production incident report, measured model accuracy, compliance
certification, or comprehensive penetration test.

## Ratings

The scale is 0 absent, 2 prototype, 4 functional with material gaps, 6 credible
personal beta, 8 production-proven, 10 exemplary sustained evidence.
See [methodology](00-methodology.md) for confidence and weighting.

| ID | Category | Score | Weight | What earns credit | What limits it / first improvement |
| --- | --- | ---: | ---: | --- | --- |
| C01 | Product and interaction UX | 5/10 | 8% | Broad real workflows; useful Library recovery and dictation | Temporary-chat/mute/onboarding promises and lost-input risk; make controls and acceptance states truthful |
| C02 | Accessibility and mobile resilience | 4/10 | 6% | Tokens, named primitives, viewport and keyboard groundwork | Modal/focus/name gaps, low-contrast information, unverified native behavior; fix shared primitives then test assistive technology |
| C03 | Client architecture and offline consistency | 4/10 | 8% | Repository seam, IndexedDB, snapshots and recovery | Global account cache, lossy outbox, push-only settings, no reviewed service worker; fix ownership and transactions before caching more |
| C04 | Backend architecture and maintainability | 6/10 | 8% | Domain/ports/adapters, testability, managed-service fit | Worker responsibility concentration and duplicated transport; extract coordination boundaries without a microservice rewrite |
| C05 | Durability and concurrency | 4/10 | 10% | Queues and persisted responses survive browser closure | Non-atomic admission/handoff, missing leases/fences, cancel/delete races; make the execution ledger authoritative |
| C06 | AI and tool execution | 5/10 | 9% | Real routing/tool loop, required-action checks, artifact capture | Incomplete stream terminal semantics, capability assumptions, incomplete budgets; deterministic tool/transport policy |
| C07 | Memory quality | 4/10 | 12% | Typed facts, extraction, vectors, editable records | Blind spots, stale/duplicate state, weak temporal/subject modeling, no representative answer-quality evidence; evaluate a bounded evidence/profile hybrid |
| C08 | Memory control and governance | 2/10 | 8% | Controls and source fields exist | Pause/read mismatch, policy failure behavior, relearning after deletion, unsafe JSON editor and incomplete disclosure; make policy and forgetting enforceable |
| C09 | Security and privacy | 4/10 | 10% | JWT verification, invite gate, encrypted credentials, scoped grants | Child namespaces and raw asset references bypass intended ownership; repair complete authorization mediation |
| C10 | Assets and data lifecycle | 4/10 | 6% | Library/provenance, direct uploads, cleanup foundations | Conflicting deletion authorities, provider resource ownership, incomplete ingestion/purge; one reference/lifecycle model |
| C11 | Testing and evaluation | 5/10 | 7% | Substantial passing unit coverage, builds, integration seams and browser suites | No checked-in CI gate, unstable full browser run, little end-to-end semantic evidence; test the identified invariants and held-out utility |
| C12 | Delivery and operational readiness | 3/10 | 5% | Bicep, diagnostics infrastructure and deployment documentation | EOL runtime in IaC, incomplete configuration, manual promotion, unproved recovery; supported reproducible environments |
| C13 | Performance and cost engineering | 4/10 | 3% | Historical latency work and warm-worker controls | Small old samples, unbounded growth paths and incomplete cost enforcement; measure stage latency and cost per useful turn |

Weighted calculation: `sum(score * weight) / 100 = 4.19`, displayed as **4.2**.
The unweighted mean is 4.15, also 4.2 to one decimal. These are summaries of
ordinal judgments, not statistically estimated quantities. Memory has 20%
weight because of the user's concern. Trust gates override the average.

Confidence is high for directly cited configuration/control-flow findings,
medium for overall category maturity, and low for production incidence or
measured human/model outcomes that were not sampled.

## Research grounding for every rating

The registers contain **55 primary-source entries plus one supplementary
survey entry**. Entries are not necessarily distinct publications/URLs; some
provider guidance supports more than one domain. No benchmark result is
transferred to Watai.

| Categories | Primary evidence | How the research changes the recommendation |
| --- | --- | --- |
| C01-C03 | [F01-F11](research/frontend-sources.md) | WCAG/APG require actual names/focus/status behavior; browser storage/auth contracts expose ownership and offline boundaries; React/media guidance favors explicit cleanup |
| C04-C05 | [B01-B06, B11](research/backend-sources.md) | Managed web-queue-worker remains suitable, but Cosmos transaction scope and queue/reconnect behavior require recoverable coordination |
| C06 | [B05, B07, B08, B14](research/backend-sources.md), [O17](research/operations-sources.md#o17) | Provider tools/background mode are conditional; authorization and terminal handling remain application responsibilities; fewer model steps may beat more agents |
| C07-C08 | [M01-M12](research/memory-sources.md) | Evaluate temporal/update/abstention abilities; preserve evidence without injecting everything; separate read/write control; graph memory is an experiment, not a prerequisite |
| C09-C10 | [B03, B05, B07-B15](research/backend-sources.md), [O12-O13](research/operations-sources.md) | Cryptography and SAS do not replace object authorization; provider/backup retention and app deletion must be reconciled |
| C11 | [O04, O05, O11, O14, O15](research/operations-sources.md) | Unit correctness differs from model quality and release provenance; keep portable evaluations rather than adopting a retiring hosted product |
| C12-C13 | [O01-O03, O06-O14, O16-O17](research/operations-sources.md) | Current runtime support changes the migration priority; measure user-visible SLOs, warm capacity and complete unit economics |

The date-sensitive findings include Node 20 being EOL, Azure Functions listing
Node 22/24 as GA, current ARM settings-replacement behavior, and current provider
background/retention limitations. Older foundational papers and standards are
retained where they offer stronger relevant reasoning than a newer marketing
claim. This is a bounded review of current accessible evidence, not exhaustive
discovery of all September 2026 publications.

## The most consequential findings

| Concern | Evidence | Decision |
| --- | --- | --- |
| Server ownership can be crossed through colliding public thread IDs or raw blob references | BE-01/02; source-level defects, no production access attempted | Resolve before expanding multi-user use |
| Browser account switching and pending writes do not have an owner-scoped durable boundary | FE-01/02/13 | Account-keyed data, transactional operation table, authoritative revisioned settings |
| Cancelling/deleting does not reliably stop or fence ongoing work | BE-03-06, MEM-03 | Execution claims, recovery and finalization must be conditional and idempotent |
| Memory controls do not mean what the interface says | MEM-01/02/09/10/11 | Fix read/learn/forget/edit contracts before changing extraction models |
| Newly saved, older or corrected memories can be missed or inconsistently served | MEM-04/06/07/08 | Versioned indexing, whole-eligible-set retrieval, temporal identity and one context budget |
| Privacy-related temporary/retention settings are not fully implemented | FE-04, BE-10 | Disable misleading promises until an end-to-end supported policy exists |
| Image/Library/provider resources have different deletion/ownership rules | BE-09-13/16/17 | Canonical owner-verified references, resumable ingestion and cleanup ledger |
| Deployment and recovery evidence trail the code | OPS-01-05/08-10 | Supported runtime, complete environment, gated artifacts and rehearsed restore |

No P0 is assigned: the audit did not demonstrate an active critical incident.
That does not make P1 authorization and privacy gaps optional. Detailed
conditions and limitations belong to each report, not just this summary.

## Memory: the specific recommendation

The user's dissatisfaction is understandable as a **hypothesis supported by
concrete inconsistencies**, not a measured diagnosis of their experience.
The implementation can save a fact without making it reliably recallable,
disable recall when asked merely to pause learning, omit profile context from
disclosure, and call retained/relearnable data permanently deleted.

**Do not start with a bigger model, a knowledge graph, or a larger always-on
summary.** First deliver an explicit, small, user-approved memory baseline.
Then add an evidence-backed assertion store, deterministic consent/correction
rules, bounded query-specific retrieval, and inspectable context disclosure.
Automatic learning must earn its place through comparisons with no-memory and
profile-only baselines.

The [memory redesign](06-memory-redesign.md) defines the proposed policy, data
model, serving path, deletion/relearning protection, UI, migration, rollback and
research alternatives. The [evaluation specification](08-acceptance-and-evaluation.md)
defines how to decide whether it is actually better.

## What not to throw away

Keep React/Vite, the repository abstraction, the domain/ports/adapters layout,
Azure Functions/Cosmos, encrypted credential handling, server-owned generation,
incremental snapshots, useful Library recovery patterns, dictation safeguards,
and the existing test investment. None of the research demonstrates that a new
frontend framework, microservices, Kubernetes, Graphiti, a multi-agent hierarchy,
or a second database is required to fix the observed failures.

## Evidence limits and immediate next decision

The baseline passed 231 frontend and 557 API tests, with 11 live integration
tests intentionally skipped; builds/typechecking passed. The full browser matrix
had eight failures and the selected serial follow-up passed. Neither fact is
hidden or overinterpreted: see [validation](evidence/validation.md).
Memory-specific synthetic reproductions are separately documented and do not
constitute paid-provider quality measurements.

No actual user study, production configuration/bill inspection, live attack,
native-device accessibility assessment or representative model-quality study
was performed. These are explicit follow-up gates, not evidence silently
assumed in the scores.

**Recommended approval:** the [phased roadmap](07-improvement-roadmap.md), starting
with ownership/consent/worker correctness and a trustworthy simple memory
experience. Approve a bounded implementation phase, not a wholesale rewrite.
