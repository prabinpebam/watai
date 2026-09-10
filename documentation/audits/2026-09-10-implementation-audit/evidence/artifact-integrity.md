# Audit artifact integrity

**Date:** 2026-09-10. **Baseline:** `f7dc195300c4039aae5b9a7a8fb1691327864ea1`.

The final synthesis checked:

- Every local Markdown link and linked heading in the audit tree resolves.
- Explicit root-relative code citations point to existing files and their
  numeric line references are within file bounds. Abbreviated locators were
  reviewed within their subsystem conventions; existence does not by itself
  prove the claim at that line.
- All 52 detailed finding headings occur once in the consolidated register:
  12 memory, 17 backend, 13 frontend and 10 operations findings.
- Priorities reconcile to 28 P1 and 24 P2. No P0 or P3 is assigned.
- All register work-package references exist among W01-W17.
- Thirteen scorecard rows have weights totaling 100%; the weighted score is
  4.19, correctly displayed as 4.2.
- W01-W16 estimates sum to 66-116 engineer-days; optional W17 is excluded.
- The source ledgers contain 12 memory, 15 backend, 11 frontend and 17
  operations primary-source entries: 55 entries total. M13 is separately
  identified as a supplementary survey, not a primary source.
- The retained synthetic memory diagnostic passes Node syntax checking and
  runs without provider or datastore access. Its eleven unmet-contract
  observations remain evidence of baseline gaps, not application test failures
  introduced by this documentation change.
- `git diff --check` reports no tracked whitespace errors; application source,
  infrastructure, dependency manifests/locks and tracked `docs` deployment
  assets remain unchanged.

The main README gains one navigation link. All other deliverables are under
`documentation\audits`. Local dependency restoration and ignored/scratch
validation outputs are documented separately.

The synthesis also corrected an overstrong pin-selection interpretation:
pinning does not force a final slot. The portable reproduction now compares
the current preselection against a broader-candidate positive control using
the existing composite ranking. See [memory validation](memory-validation.md).

The [central acceptance specification](../08-acceptance-and-evaluation.md)
is the authoritative proposed dataset/metric plan; subsystem exploratory
case counts are not additional required datasets. Baseline browser failures,
targeted reruns, static risks, synthetic observations, and unverified live
properties remain distinguished throughout.
