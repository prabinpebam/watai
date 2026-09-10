# Project Guidelines

## Cost And Time Discipline

## Continuous DoD Delivery

When the user asks to implement, complete, or work against the DoD, continue autonomously across slice boundaries until the DoD is complete. A passing test, completed slice, commit, clean worktree, status report, context compaction, or elapsed delivery milestone is not a stopping condition.

After each validated slice, immediately select and begin the next dependency-ready backlog slice. If the canonical next slice is blocked, continue with the highest-risk dependency-ready product slice that preserves architecture and safety. Keep the backlog and latest user request authoritative; do not wait for the user to say "continue" again.

Stop only when one of these is true:

- the requested DoD is fully implemented and validated;
- the user explicitly asks to pause or stop;
- every useful remaining path is blocked by a verified external dependency, authorization, safety ceiling, or required user secret/input that cannot be obtained safely.

When one path is blocked, preserve its evidence and move to parallel ready work. Do not call the task-complete tool or send a final completion response while DoD work remains executable locally. Commit boundaries are recovery checkpoints, not conversation boundaries.

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

For initiatives expected to exceed 30 minutes or contain three or more expensive stages, create one program-level work decision before further setup. It must define the first user-visible or product-risk-reducing delivery milestone, a maximum setup budget, a time-to-first-value target, the smallest end-to-end path, deferred work, and an exit criterion for meta-work.

Optimize total quality throughput, not isolated command efficiency. Track elapsed setup time versus delivered product value. Setup and governance are enabling work: once the minimum safe control plane exists, prefer delivering the next DoD slice over adding more harness sophistication. Keep at most one setup/improvement thread active alongside product work.

Process is overhead until it proves otherwise. Every process step must justify its cost through a concrete delivery, risk reduction, or reusable time saving. If polishing, refining, documenting, or governing the process consumes more time than the actual product work it enables, stop immediately: the approach is on the wrong path. Remove or collapse the process before continuing delivery.

At each 30-minute program checkpoint, or after two failed attempts at the same stage, challenge the whole approach. Ignore sunk cost. Remove unnecessary prerequisites, collapse repeated ceremonies, reuse compatible evidence, and move non-critical qualification to the latest responsible gate. A checkpoint must end with a concrete delivery action, a materially changed approach, or a verified external blocker.

A full qualification may be necessary for a DoD claim, but repeated qualification is forbidden unless source, runtime image, contract, or relevant behavior changed.

See `documentation/implementation/2026-09-10-autonomous-delivery/10-cost-and-time-governance.md`.

## Continuous Production Milestones

Real deployment is a delivery goal, not a final cleanup step. Promote a milestone whenever one coherent user-visible slice is validated, or after at most three completed slices, whichever happens first. Do not accumulate days of locally validated benefits without putting them in the real app.

Every production milestone must:

- add a concise entry to the in-app Settings > About release notes describing user-visible benefits and limits;
- bind the frontend commit and backend artifact/config identity in `documentation/releases/`;
- preserve an addressable previous frontend commit and backend package before mutation;
- deploy backend-compatible changes before the frontend that consumes them;
- run bounded production health and public-shell smoke checks after deployment;
- provide a short manual validation checklist and the real app URL to the user;
- define exact rollback commands that restore code only and never roll back consent, deletion, privacy, or data ledgers.

A deployed milestone is a user validation checkpoint, not a reason to stop implementation. Continue dependency-ready work while awaiting feedback, but do not stack another production milestone over an unvalidated regression. If production smoke fails, rollback immediately to the retained target and preserve the failure evidence.

## Package Sources

Use `https://packagefeedproxy.microsoft.io/npm/` for npm and preserve Microsoft Azure Artifacts tarball hosts returned by its metadata. Do not force registry-host replacement. Never fall back to a public registry or unverified cache artifact.
