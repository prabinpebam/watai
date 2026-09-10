# Cost and time governance

## Objective

Spend wall time, provider requests, AI credits, money, browser capacity and engineering attention only when the next action is necessary on the current critical path and is the cheapest check that can change the decision.

## Expensive action

An action is expensive when it can exceed two minutes, make a live provider call, consume AI credits or metered spend, build or pull a container, run a complete browser/integration denominator, deploy, or mutate remote/cloud state.

## Required sequence

1. Reuse current evidence.
2. State one falsifiable hypothesis.
3. Run the cheapest discriminating static or local check.
4. Run one bounded canary.
5. Continue to a focused subset only when the canary passes.
6. Run the full frozen denominator only when it is required for an explicit DoD claim.
7. Reuse a passing qualification until relevant source, image, contract or behavior changes.

## Work decision

Before an expensive command, the `Cost Challenger` issues `APPROVE`, `REDUCE`, `REJECT` or `BLOCKED`. An approval is materialized as a one-shot command-hash-bound decision by:

```powershell
$env:WATAI_EXPENSIVE_COMMAND = '<exact command>'
npm run harness:work-decision -- path\to\request.json
```

The request must include:

```json
{
  "schemaVersion": "1.0",
  "challengerVerdict": "APPROVE",
  "expectedValue": "Concrete user value or DoD risk reduced",
  "necessaryNow": true,
  "necessaryNowReason": "Why this is on the current critical path",
  "cheapestStage": "The smallest action that can change the decision",
  "alternativesConsidered": ["Cheaper alternative and why it is insufficient"],
  "evidenceReuse": ["Existing evidence not rerun"],
  "estimatedMinutes": 4,
  "ceilings": { "wallClockMinutes": 4, "requests": 3, "aiCredits": 30, "usd": 0 },
  "continueIf": "Objective pass condition",
  "stopIf": "Objective stop condition",
  "rollback": "Recovery without deleting failed evidence",
  "fullDenominator": false
}
```

A full denominator must additionally provide `canaryReportPath` referencing `CANARY_PASSED` evidence. Decisions expire after 15 minutes and are consumed once by the pre-tool hook.

## Agent qualification

The implementation-agent qualification uses:

- canary: one `bounded-read` run, maximum 4 minutes, 3 provider requests and 30 AI credits;
- full qualification: three cases by three repetitions, maximum 36 minutes and 270 AI credits;
- continuation: full qualification only after a fresh canary bound to the same source, smoke image, contract and case passes;
- stop: any canary provider, oracle, usage, time or budget failure.

The full qualification remains necessary once because implementation readiness claims reliable real-model behavior across read-only discipline, bounded editing, and validation/submission. It is not rerun for unchanged relevant inputs.
