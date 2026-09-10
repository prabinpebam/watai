# Consolidated finding register

**52 findings: 28 P1 and 24 P2; no P0 or P3 assigned.** Counts are navigation aids,
not independent risk estimates. Some findings describe different consequences
of the same cross-cutting contract. Ratings apply to the 13 categories, not to
individual bugs.

Each linked report contains baseline source locations, observation/inference
boundaries, confidence, impact conditions, research, alternatives and acceptance
criteria. Work-package IDs refer to the [roadmap](../07-improvement-roadmap.md).
All entries remain **open recommendations**: this audit did not fix application
behavior.

## Memory

Evidence: [memory assessment](../02-memory-audit.md),
[memory research](../research/memory-sources.md).

| ID | Priority | Finding | Work packages |
| --- | --- | --- | --- |
| MEM-01 | P1 | Read/learning consent, pause, policy failure and settings authority are inconsistent | W08, W09 |
| MEM-02 | P1 | Delete retains payload and lacks a reliable relearning/erasure barrier | W04, W09, W10 |
| MEM-03 | P1 | Extraction scheduling and processing are not durably idempotent | W07, W10 |
| MEM-04 | P1 | Consolidation can duplicate, invalidate before replacement, and retain stale vectors | W10 |
| MEM-05 | P1 | Provenance is not verified evidence; sensitivity and subject attribution are incomplete | W10 |
| MEM-06 | P2 | Candidate windows, early top-k, vector identity and manual indexing create blind spots | W11 |
| MEM-07 | P2 | Profile injection is broad, incompletely disclosed and outside the stated combined budget | W11, W16 |
| MEM-08 | P2 | Identity/time/route and restoration semantics overpromise the actual model | W10, W11 |
| MEM-09 | P2 | Management inventory is incomplete, lossy and unclear about effective state | W09, W11 |
| MEM-10 | P1 | Raw JSON replacement can act against the wrong status/revision inventory | W09 |
| MEM-11 | P2 | Rebuild acknowledgement, export/import and pagination contracts are incomplete | W09, W11 |
| MEM-12 | P2 | Current evaluation does not measure the actual shipped memory/answer pipeline | W12 |

## Backend

Evidence: [backend assessment](../03-backend-audit.md),
[backend research](../research/backend-sources.md).

| ID | Priority | Finding | Work packages |
| --- | --- | --- | --- |
| BE-01 | P1 | Caller-supplied public thread IDs address owner-unqualified child partitions | W05 |
| BE-02 | P1 | Raw blob references can bypass canonical object-ownership mediation | W05, W13 |
| BE-03 | P1 | Active-run admission and submission idempotency are non-atomic | W07 |
| BE-04 | P1 | Durable transport lacks recoverable business handoff, claims and reconciliation | W07 |
| BE-05 | P1 | Cancellation and stale worker finalization can violate deletion/update intent | W07, W13 |
| BE-06 | P1 | Open-stream deadlines, error events and terminal completion are incomplete | W07 |
| BE-07 | P1 | Endpoint/key changes and URL fetching lack a consistent egress boundary | W06 |
| BE-08 | P1 | Mutable identity claims and token authorization policy need strengthening | W06 |
| BE-09 | P1 | Provider file deletion and skill caching do not match application ownership | W06, W13 |
| BE-10 | P1 | Library/thread/studio/provider deletion and retention are not one lifecycle | W04, W09, W13 |
| BE-11 | P2 | Multi-step document/artifact ingestion lacks convergence and compensation | W13 |
| BE-12 | P2 | Iteration counts do not fully bound tool authorization, time, tokens or spend | W03, W12, W14, W16 |
| BE-13 | P2 | Some size/content-verification limits apply after allocation or trust | W13, W16 |
| BE-14 | P2 | Timestamp deltas and append order do not establish durable replay/chronology | W07, W08 |
| BE-15 | P2 | Worker/provider/notification responsibilities and capability assumptions are entangled | W03, W07, W16 |
| BE-16 | P2 | Optional credential clearing and current wrapping-key refresh are incomplete | W06 |
| BE-17 | P2 | SAS signing-key expiry and legacy/un-enriched asset addressing can mismatch | W13 |

## Frontend

Evidence: [frontend assessment](../04-frontend-audit.md),
[frontend research](../research/frontend-sources.md).

| ID | Priority | Finding | Work packages |
| --- | --- | --- | --- |
| FE-01 | P1 | Local database, drafts and outbox are not identity-scoped | W08 |
| FE-02 | P1 | Whole-queue snapshot writes can lose concurrent operations | W08 |
| FE-03 | P1 | Composer clears input before durable acceptance and synchronous admission | W08, W14 |
| FE-04 | P1 | Temporary-default control does not create a supported temporary run | W09, W14 |
| FE-05 | P1 | Voice mute and delayed capture startup do not enforce cancellation intent | W14 |
| FE-06 | P1 | Shared overlays/navigation lack complete name/focus/keyboard contracts | W15 |
| FE-07 | P1 | Informative light-theme text has insufficient calculated contrast | W15 |
| FE-08 | P2 | Onboarding claims all-model testing while testing only chat | W14 |
| FE-09 | P2 | Collection/search requests can present stale or misleading results | W14 |
| FE-10 | P2 | Offline/export/clear-device promises and legacy asset boundaries need precision | W13, W14 |
| FE-11 | P2 | History, rendering, draft and asset growth paths need measurement/bounds | W16 |
| FE-12 | P2 | Loading/error recovery and accessible completion status are inconsistent | W14, W15 |
| FE-13 | P1 | Push-only settings sync can overwrite authoritative preferences with defaults | W08, W09 |

## Delivery and operations

Evidence: [operations assessment](../05-delivery-and-operations.md),
[operations research](../research/operations-sources.md),
[executed baseline](validation.md).

| ID | Priority | Finding | Work packages |
| --- | --- | --- | --- |
| OPS-01 | P1 | IaC pins Node 20, now EOL; deployed runtime was not queried | W01 |
| OPS-02 | P1 | Declared resources/settings do not reproduce all advertised capabilities | W01 |
| OPS-03 | P1 | Repository lacks a reproducible gated release/promotion contract | W02 |
| OPS-04 | P2 | Diagnostics infrastructure is not demonstrated end-to-end health/SLO coverage | W03 |
| OPS-05 | P1 | Coherent restore with keys/assets/consent/deletion is not demonstrated | W04 |
| OPS-06 | P2 | Historical small benchmarks do not establish current latency targets | W03, W16 |
| OPS-07 | P2 | Scaling/warm settings do not establish user spend limits or unit economics | W03, W16 |
| OPS-08 | P2 | Documentation mixes superseded assumptions, current contracts and old decisions | W04 |
| OPS-09 | P2 | Toolchain support and the scope of checks lack an explicit policy | W01 |
| OPS-10 | P2 | Full browser gate failed; selected passing rerun does not replace it | W02 |

## Conditions that must not be lost in summaries

- Backend ownership findings are static defects; no foreign data or production
  resource was accessed to demonstrate an incident.
- The current server rejects temporary-thread creation. The UI promise is
  broken; the worker's missing temporary-memory check is defense-in-depth,
  not demonstrated reachable private-chat leakage through supported admission.
- Ordinary newly server-appended attachments receive Library enrichment.
  BE-17's addressing mismatch concerns uncached/un-enriched/legacy references,
  not every fresh-device attachment.
- Account Library retention after thread deletion is partly intentional.
  The defect is inconsistent authority and incomplete promised erasure, not
  simply that every retained file is an orphan.
- Missing backup/SLO/CI declaration does not establish that no manually
  configured cloud/platform control exists.
- Browser failures preceded the relevant functional assertions or involved an
  ambiguous selector. They do not demonstrate a viewport geometry regression.
- No category score is a measured hallucination rate, WCAG conformance result,
  cloud SLA, or prediction of how much a new model/graph will improve quality.
