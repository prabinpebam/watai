# Project Guidelines

## Cost And Time Discipline

Before any time-consuming or resource-consuming action, use the `Cost Challenger` agent and create a machine-readable work decision with `npm run harness:work-decision`.

An action is expensive when it may exceed 2 minutes, make live model/provider calls, consume AI credits or metered spend, build/pull a container, run a complete browser/integration matrix, deploy, or mutate remote/cloud state.

The decision must state:

- the user-visible or risk-reduction outcome;
- why the work is necessary now;
- the cheapest discriminating alternative;
- maximum wall time, requests, AI credits, and currency spend;
- evidence already available that must not be rerun;
- exact continuation and stop conditions;
- rollback/recovery behavior.

Use staged execution: static check, single canary, focused validation, then full matrix only when the preceding stage passes. Never run a full expensive denominator to diagnose basic startup, authentication, configuration, or lifecycle failures.

Cost and time review must not be used to abandon necessary work. Its purpose is to maximize useful progress per minute and unit of spend. When an approach crosses its ceiling, fails its continuation criterion, or stops producing discriminating evidence, stop that approach, preserve its evidence, identify the root cause, and immediately continue with the cheapest viable changed approach. Hard safety, authorization, spend, and resource ceilings remain non-negotiable.

Prefer fixing the architecture or workflow over repeatedly extending timeouts, budgets, retries, or denominators. Ask whether work belongs on the critical path and whether the same outcome can be reached with less repeated setup, fewer model turns, narrower validation, or reuse of existing evidence.

A full qualification may be necessary for a DoD claim, but repeated qualification is forbidden unless source, runtime image, contract, or relevant behavior changed.

See `documentation/implementation/2026-09-10-autonomous-delivery/10-cost-and-time-governance.md`.

## Package Sources

Use `https://packagefeedproxy.microsoft.io/npm/` for npm and preserve Microsoft Azure Artifacts tarball hosts returned by its metadata. Do not force registry-host replacement. Never fall back to a public registry or unverified cache artifact.
