# Methodology, scope, and interpretation

## Audit contract

This is an implementation audit and proposed improvement program, not an
implementation of the recommendations. The baseline is
`f7dc195300c4039aae5b9a7a8fb1691327864ea1`; the initial worktree was clean.
Research was consulted on **2026-09-10**. Application code, infrastructure, dependency
manifests, and deployed resources were not intentionally changed.

The question is: **How trustworthy, useful, understandable, and maintainable is
Watai as a personal AI application, and what should change first?** The primary
comparison is a credible personal/private beta, not a hypothetical enterprise
platform with unlimited staffing. Multi-user privacy and destructive data
operations still need strong guarantees at personal scale.

The user's dissatisfaction with memory is a product signal, not proof of a
particular algorithmic failure. The memory review therefore separates observable
implementation defects from hypotheses about the user's experience.

## Coverage and allocation

The baseline contains 582 tracked files, including 91 generated frontend files
under `docs`. Source discovery found 229 backend TypeScript files and 133 frontend
TypeScript/TSX files, including tests. These counts describe inventory, not
line-by-line verification or test coverage.

| Area | Examination | Detailed assessment |
| --- | --- | --- |
| Memory | Contracts, extraction, consolidation, routing, embeddings, retrieval, prompt assembly, disclosure, management UI, deletion, evaluation fixtures and plans | [Memory](02-memory-audit.md), [redesign](06-memory-redesign.md) |
| Backend | Domain/ports/adapters, auth and credentials, controllers, runs and workers, provider calls, tools, skills, images, files and library | [Backend](03-backend-audit.md) |
| Frontend | App shell, chat/history/images/library/skills/voice, design components, auth, local persistence and synchronization, PWA | [Frontend](04-frontend-audit.md) |
| Engineering delivery | Package scripts/locks, test configuration and execution, infrastructure, operations, diagnostics, cost/performance evidence, documentation consistency | [Delivery and operations](05-delivery-and-operations.md) |
| Cross-cutting decisions | Ratings, severity, priorities, tradeoffs, migration, rollout, acceptance gates and ownership | [Scorecard](01-scorecard.md), [roadmap](07-improvement-roadmap.md) |

Generated bundles are treated as delivery artifacts, not independently audited
source. Experiments and historical plans are supporting evidence, not proof that
a feature is deployed. No byte-for-byte source-to-production equivalence is
asserted. Subsystem investigations were independent; final priorities reconcile
their shared boundaries rather than averaging away critical problems.

## Rating rubric

Scores are **ordinal engineering judgments out of ten**, not benchmark
percentages, accessibility certification, penetration-test results, or measured
user satisfaction. Whole-number scores reduce false precision.

| Anchor | Meaning |
| --- | --- |
| 0 | Capability absent or fundamentally unusable |
| 2 | Prototype with very limited safeguards |
| 4 | Functional implementation with material correctness, usability, or operational gaps |
| 6 | Credible personal beta; useful architecture and safeguards, incomplete production evidence |
| 8 | Robust implementation with demonstrated end-to-end and operational evidence |
| 10 | Exemplary, sustained evidence of quality and improvement; not merely feature completeness |

Intermediate numbers interpolate between anchors. Passing unit tests alone does
not earn an 8. A static risk does not automatically imply a low overall product
score. Each category includes strengths, limiting evidence, research, and the
specific changes needed to improve it.

### Categories and weights

| ID | Category | Weight |
| --- | --- | ---: |
| C01 | Product and interaction UX | 8% |
| C02 | Accessibility and mobile resilience | 6% |
| C03 | Client architecture and offline consistency | 8% |
| C04 | Backend architecture and maintainability | 8% |
| C05 | Durability and concurrency | 10% |
| C06 | AI and tool execution | 9% |
| C07 | Memory quality | 12% |
| C08 | Memory control and governance | 8% |
| C09 | Security and privacy | 10% |
| C10 | Assets and data lifecycle | 6% |
| C11 | Testing and evaluation | 7% |
| C12 | Delivery and operational readiness | 5% |
| C13 | Performance and cost engineering | 3% |

Weights total 100%. Memory receives 20% because it is central to the user's
concern. The weighted score is a prioritization summary, not a launch gate.
Security, isolation, deletion, and durable execution have independent gates:
excellent UI cannot compensate for failure in those properties. Category
overlap is intentional where a defect affects both a capability and confidence
in that capability; finding counts must not be interpreted as independent risks.

## Evidence and severity

Findings use the namespaces `MEM`, `BE`, `FE`, and `OPS`.

| Label | Interpretation |
| --- | --- |
| Observed | Directly supported by source/configuration or an executed check |
| Inferred / risk | Consequence follows under stated conditions but was not reproduced in a deployed environment |
| Hypothesis | Plausible explanation requiring user or workload evidence |
| Proposed | Design decision, target, or experiment; not present behavior or an industry guarantee |
| Unknown | Requires access or evidence not available in this audit |

Confidence describes the strength of the evidence for the stated claim.
High-confidence missing code does not establish high-confidence production
incidence. Use these priorities:

| Priority | Treatment |
| --- | --- |
| P0 | Immediate containment for demonstrated critical harm; not assigned merely for a theoretical possibility |
| P1 | Correct before expanding use or relying on the affected trust guarantee |
| P2 | Planned quality/reliability work after immediate trust risks |
| P3 | Optimization, cleanup, or a conditional investment |

Code locations refer to the baseline, not future line numbers. Missing controls
are phrased as "not found in the reviewed implementation/template"; externally
configured Azure or GitHub controls may exist.

## Research standard

Every scored category is mapped to sources actually fetched/read during this
audit. The [research index](research/README.md) records those mappings.

Sources are interpreted according to their authority:

1. **Standards and provider documentation** establish contracts, constraints and
   supported capabilities, but do not prove Watai satisfies them.
2. **Research papers and benchmark implementations** supply hypotheses, test
   dimensions and tradeoffs. Preprints and vendor benchmarks are identified as
   such; their scores are not attributed to Watai.
3. **Official product documentation** establishes user-visible patterns worth
   comparing, not a requirement to clone that product or its internal design.
4. **Repository evidence** establishes what this implementation does. Older local
   reports remain historical even when they contain measured numbers.

"Current" means the available source was consulted on the audit date and its
visible date/version was considered. It does **not** mean every publication on
the internet was discovered. Some pages have no reliable publication date;
those are marked undated. Search/fetch failures and alternative sources are
recorded where relevant. A newer source is not automatically stronger than an
older standard or a better-controlled study.

The recommendations distinguish provider-specific behavior. In particular,
OpenAI platform lifecycle notices are not assumed to be Azure OpenAI retirement
notices. Model deployment names are not sufficient evidence of the underlying
model version, region availability, price, or capability.

## Validation and exclusions

Existing local tests/builds were used; exact commands, outcomes and environment
limitations are in [validation evidence](evidence/validation.md). Build output
was directed away from the tracked GitHub Pages deployment directory.

This audit does **not** claim:

- production Azure configuration, tenant permissions, backup recovery, actual
  bills, telemetry, or GitHub branch protection were inspected;
- active exploitation, a comprehensive penetration test, legal compliance, or
  exhaustive dependency-advisory coverage;
- representative model quality, statistically reliable production tail latency,
  or native iPhone keyboard/assistive-technology conformance;
- user research or observed dissatisfaction beyond the user's stated concern;
- that planned memory/profile/graph stores already exist because specifications
  describe them.

No real conversations, account data, credentials, or cloud benchmark requests
were needed. Proposed production experiments require synthetic or explicitly
consented data, isolated accounts, a spend ceiling, and a rollback path.

## Definition of a better implementation

An improvement must link a finding to a user outcome, a bounded design change,
and an acceptance check. A rewrite is justified only if a cheaper intervention
cannot meet that check. The desired result is less surprising memory, reliable
recovery, clearer controls, and reproducible evidence, not more components.
