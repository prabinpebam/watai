# Research index

**Consulted: 2026-09-10.** The registers below document sources actually read,
the claims they support, applicability to Watai, and limits on those claims.
They are not a bibliography of links collected without inspection.

| Register | Main scope | Rating categories |
| --- | --- | --- |
| [Memory sources](memory-sources.md) | Long-term memory, temporal reasoning, retrieval, evaluation, provenance, user control and architectural alternatives | C07, C08 |
| [Backend sources](backend-sources.md) | Architecture, queue processing, concurrency, provider/tool contracts, authentication, security boundaries and asset lifecycle | C04, C05, C06, C09, C10 |
| [Frontend sources](frontend-sources.md) | Interaction design, accessibility, browser/platform contracts, local persistence and PWA behavior | C01, C02, C03 |
| [Operations sources](operations-sources.md) | Runtime support, reproducible delivery, testing/evaluation, SLOs, recovery, latency and unit economics | C11, C12, C13 |

## Reading the evidence correctly

Official API documentation is authoritative about a provider contract, but not
about whether Watai implemented it. A vendor benchmark can demonstrate a result
under its own setup, but not a general improvement for this application's
workload. A product's memory UI is evidence of a possible user-facing contract,
not disclosure of that product's internal algorithm.

Publication date, last update and access date are different. An undated,
maintained page is not labeled a new 2026 publication. A versioned older
specification can still support a stable engineering principle. Unavailable
pages and limited abstracts are not treated as fully reviewed papers.

The audit deliberately does not turn a source's example threshold, model name,
pricing illustration, or benchmark score into a Watai measurement. Proposed
targets are labeled in the [memory proposal](../06-memory-redesign.md) and
[roadmap](../07-improvement-roadmap.md).

## Research questions that determine implementation decisions

| Question | Evidence to consult | Decision |
| --- | --- | --- |
| Is more autonomous memory actually useful? | Memory benchmark tasks, false-memory rates, paired Watai evaluation, user corrections | Earn automatic recall with measured usefulness; retain a simple baseline |
| Does a graph solve the observed problem? | Temporal/relational error slices and graph research limitations | Use an experiment gate, not a graph-first rewrite |
| Can queue delivery alone guarantee completion? | Azure delivery/retry semantics, Cosmos concurrency and Watai persistence order | Make scheduling, claims and terminal transitions recoverable |
| Does a successful provider call imply a successful turn? | Tool and file lifecycle contracts, client reconciliation | Define success through durable user-visible results |
| Is offline support correct for multiple accounts/devices? | Browser storage constraints and synchronization invariants | Scope local data to identity and expose conflicts honestly |
| Does a polished viewport imply accessibility? | WCAG/APG and actual assistive-technology checks | Separate visual, keyboard, screen-reader and native-device evidence |
| Does a passing unit suite establish memory quality? | Evaluation methodology and task-specific datasets | Use deterministic tests plus held-out model evaluations |
| Is the hosting configuration current and reproducible? | Node/Azure support tables, app-setting replacement and release provenance | Migrate runtime and reconcile the environment before expansion |
| Should cost be optimized by shrinking memory? | Stage timing, provider usage, Cosmos RU and warm-instance billing | Optimize useful-turn economics while protecting quality |

## Freshness and portability

The evidence includes provider guidance updated in 2026, as well as relevant
older standards and research. It does not claim exhaustive discovery of every
publication available on the audit date. Recheck fast-changing provider support,
retirement, pricing and preview-feature availability when implementing.

In particular, Azure OpenAI, OpenAI's direct platform, browser behavior and
GitHub Actions have distinct contracts. Do not apply a direct-OpenAI retirement
date or feature to Azure simply because the model names look similar. Do not
claim assistive-technology conformance from a jsdom test or provider reliability
from an in-memory adapter.
