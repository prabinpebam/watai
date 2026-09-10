# Watai autonomous implementation and delivery plan

**Status: DESIGN plus a local rehearsal controller; not authorization to deploy.**
Research/access date: **2026-09-10**. Audit document baseline:
`9b4314ddd537401667d68642c3eeee85e7fabca7`; audited application:
`f7dc195300c4039aae5b9a7a8fb1691327864ea1`.

The goal is an unattended engineering system that makes Watai safer and more
useful in small, independently evidenced releases, with memory trust first.
It must **stop safely rather than invent authority, relax a test, or ask for a
human decision**. Continuous progress is a goal; unconditional autonomous success
is not a credible guarantee.

## Decisions

Use a small deterministic TypeScript controller, a durable execution ledger,
isolated Copilot SDK/CLI workers, and separately authorized GitHub Actions
validation/promotion jobs. Agents propose changes and counterexamples; they do
not decide whether their own work passes. Start with one product builder and one
active release, not an open-ended agent swarm. Keep React/Vite, Functions/Cosmos,
and existing repository/service seams. Do not introduce a product graph database.

The **workflow state graph**, **slice dependency DAG**, and **evidence/provenance
DAG** are different graphs with different invariants. Workflow retry cycles are
bounded; backlog dependencies and evidence ancestry must be acyclic.

First deliver truthful controls, owner isolation, revisioned settings, safe
accepted work, and then accurate **Saved-only memory**. Automatic learning and
hybrid retrieval stay disabled until their own evidence passes. The full goal
is closure of all **52 findings (12 MEM, 17 BE, 13 FE, 10 OPS)**, not a better
numeric maturity score or a passing subset relabeled complete.

## Reading and execution order

| Artifact | Authority and purpose |
| --- | --- |
| [01-harness-design.md](01-harness-design.md) | Controller, roles, tools, context, durable execution, threat boundaries |
| [02-definition-of-done.md](02-definition-of-done.md) | Hard gates, fixed evaluation authority, statistical rules, autonomous UX limits |
| [03-bootstrap-and-release.md](03-bootstrap-and-release.md) | Preflight, initial baseline, release topology, no-human exceptions, recovery |
| [04-implementation-backlog.md](04-implementation-backlog.md) | Milestones, small slices, ordering and finding closure interpretation |
| [05-research-and-decisions.md](05-research-and-decisions.md) | Fetched primary sources, dated claims, alternatives and caveats |
| [06-design-validation-and-review.md](06-design-validation-and-review.md) | Local mechanical evidence, adversarial findings and design revisions |
| [07-harness-implementation-review.md](07-harness-implementation-review.md) | Executable-controller critique, implemented safeguards and remaining blockers |
| [08-execution-readiness.md](08-execution-readiness.md) | Current DoD readiness, bootstrap ceremony and execution-ready criteria |
| [contracts/backlog.json](contracts/backlog.json) | Canonical 56-slice execution backlog; each finding has explicit closure slices |
| [contracts/policy.json](contracts/policy.json) | Proposed gate/authority/budget policy, disabled by default |
| [contracts/workflow.json](contracts/workflow.json) | Typed transition table and bounded exception paths |
| [contracts/examples.json](contracts/examples.json) | Synthetic evidence packet and failure/recovery traces, never valid for release |
| [contracts/plan.schema.json](contracts/plan.schema.json) | Closed JSON contracts for the machine-readable artifacts |
| [validate-plan.mjs](validate-plan.mjs) | Local, network-free plan/traceability validator and negative controls |

The four JSON inputs remain **specifications/examples**, not trusted authority.
The audit-only validator is joined by the local rehearsal controller under
`harness/`, which executes the workflow contract and tests failure paths. It does
not authenticate a production identity, dispatch an agent, build Watai, run model
calls, enable Actions, create infrastructure, promote a release, or prove
production safety. Existing audit observations remain open.

Run from the repository root:

```powershell
node documentation\implementation\2026-09-10-autonomous-delivery\validate-plan.mjs
npm run validate:harness
npm run harness:status -- implementation
```

It checks JSON contracts, exact audit ID coverage, DAG structure, mandatory fields,
gate references, role separation, bounded workflow paths, synthetic evidence
binding, and rejection of deliberately malformed plans. It cannot establish that
future implementations actually satisfy prose acceptance criteria.

## Contract hierarchy and change control

The future preauthorized trust-root manifest pins policy, controller, evaluator,
dataset, and workflow SHAs outside builder write authority. That manifest and the
hard rules in this plan outrank all agent output. The JSON backlog is canonical
for slice membership/dependencies; the DoD defines gate semantics. Disagreement
between artifacts is **BLOCKED_SAFE**, never interpreted in whichever way passes.
No `passes: true` written by a builder can close work.

The old audit's manual studies, manual signoffs and paid-run approvals are
replaced with machine-grounded contracts and preauthorized limits. This does not
magically prove human usability, subjective trust, multilingual correctness,
physical-device equivalence, or complete WCAG conformance. Unsupported claims
remain explicitly machine-tracked and must not appear in release copy.

## What "stable is always available" means

After bootstrap, at least one immutable, addressable last-known-good (LKG)
frontend/API/config compatibility set is retained and eligible to serve. Candidate
branches and unvalidated artifacts never receive public traffic or production
queue work. Every routing change has a fenced, independently authorized rollback.
Provider/cloud outages can still interrupt availability; operational SLOs quantify
this, rather than promising impossible 100% uptime.

The current Pages `master/docs` deployment and manually deployed Functions app
are **observed, not proven validated**. Bootstrap records their provenance gaps
and risk envelope before a first contract-passing LKG is established. Initial
containment may reduce capability; the full goal cannot count a permanently
disabled advertised capability as repaired. S01 contains unsupported temporary chat immediately;
S49 must deliver real server-enforced temporary behavior for full closure.

## Authorization boundary

This document specifies future machine capabilities. It does not grant them.
Normal and exceptional paths use only already authorized machine identities,
scopes, quotas and infrastructure. Missing credentials, unautomatable login,
unsupported region/device capability, exhausted spend or absent safe routing
produce durable `BLOCKED_SAFE`/`UNSUPPORTED` records while retaining the old
product. No manual approval queue, CAPTCHA solver, password scraping, surprise
subscription, permission self-grant, remote push or deployment is part of this
planning task.
