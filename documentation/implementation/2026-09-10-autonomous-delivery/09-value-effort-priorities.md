# Safety-constrained value per effort

**Status:** unsigned scheduling proposal, not execution authority.

The scheduler keeps this order of authority:

1. dependency closure and active safety containment;
2. protected-path, gate and capability constraints;
3. safety tier;
4. complete signed value/risk/effort assessment;
5. canonical backlog order as deterministic tie-break.

Value scoring cannot move product work ahead of H01-H05 or move medium-risk work
ahead of critical containment/isolation. It only selects among ready slices in
the same safety tier.

The score is:

$$
\frac{(2 \times \text{risk reduction}) + \text{user value}}{\text{effort}}
\times \text{confidence}
$$

Inputs use integer value/risk/effort from 1 to 5 and confidence from 0 to 1.
Rationale and policy are digest-bound. Duplicate or incomplete assessments block
priority steering.

## Required bootstrap

H01 through H05 remain the first dependency chain. Current emphasis within that
chain is operational, not cosmetic:

| Slice | Immediate outcome |
| --- | --- |
| H01 | Signed truthful baseline and explicit historical unknowns |
| H02 | Independent authority that prevents self-approval |
| H03 | Restart-safe isolated implementation execution |
| H04 | Complete independently observed candidate evaluation |
| H05 | Immutable stage and rollback plane |

## First product safety envelope

After H04, R0 still requires S01, S02, S04 and S06. These are critical safety
work and outrank ordinary improvements:

| Slice | User value | Risk reduction | Effort | Confidence | Rationale |
| --- | ---: | ---: | ---: | ---: | --- |
| S01 | 4 | 5 | 3 | 0.90 | Removes false privacy/control promises and blocks unsafe paths |
| S02 | 5 | 5 | 4 | 0.95 | Prevents cross-account thread/message exposure |
| S04 | 5 | 5 | 3 | 0.90 | Prevents cross-account local drafts/cache disclosure |
| S06 | 4 | 5 | 3 | 0.90 | Preserves authoritative consent and settings across devices |

Dependency constraints decide exact dispatch. S02 and S04 become ready after
H04; S01 also requires H03; S06 waits for S02 and S04.

## High-return independent preparation

The backlog permits these slices to be prepared after H04 while R0 work proceeds.
They cannot be released before an admissible LKG and their own gates pass.

| Proposed order | Slice | Value | Risk reduction | Effort | Confidence | Why now |
| ---: | --- | ---: | ---: | ---: | ---: | --- |
| 1 | S42 | 5 | 4 | 2 | 0.90 | Broad readability and reachable controls at comparatively low effort |
| 2 | S37 | 4 | 4 | 2 | 0.90 | Removes misleading capability claims and preserves preferences |
| 3 | S36 | 5 | 5 | 3 | 0.85 | Fixes voice privacy/cancellation with clear automated boundaries |
| 4 | S41 | 5 | 4 | 4 | 0.85 | High accessibility value but broader shared-overlay surface |

These estimates must be reissued as signed `value-assessment` claims against the
final policy and source. Measured effort or newly discovered risk updates future
assessments; it does not rewrite historical decisions or bypass failed gates.