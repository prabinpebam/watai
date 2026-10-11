# Five-Flow Trial

Status: PREPARATION IN PROGRESS; LIVE TRIAL NOT STARTED.
Version: 1. Date: 2026-09-12.

## Selected Scope

The user's latest request replaces full-catalog preparation with a five-flow trial.
The [pilot manifest](../../../tests/e2e/deployed/five-flow-pilot.json) is the active
selection. The other55 catalog flows and unselected family variants are deferred, not
pilot prerequisites and not counted as passed. This is not a release qualification.

| Flow | Selected desktop variant | Distinct behavior tested |
| --- | --- | --- |
| AUTH-01 | Public startup | Actual welcome content, assets and keyboard-operable Sign in; no login click. |
| CHAT-01 | First prompt and reload | One accepted prompt, correct46 reply, every-state order and fresh persisted restoration. |
| CHAT-02 | Same-thread follow-up | Give project code MAPLE-27, receive ACK, ask for the prior code and receive MAPLE-27 with both turns preserved. |
| CHAT-03 | Streaming and reading anchor | Request integers1..200, observe at least three distinct prefix-growing updates, scroll to the prompt and retain its offset through at least two further updates. |
| CHAT-04 | Stop then next prompt | Request a longer list, click Stop while running after two updates, observe canceled, then ask17+29; old canceled content must stay unchanged while the new reply becomes46. |

Each flow has one attempt, not retries until green. A missed streaming/cancellation branch
is insufficient evidence. `cancel_requested` is not canceled. A later corrected screen
cannot erase a transient prompt loss, reorder, wrong terminal answer or stale write.
Always use original task observations, not driver success flags or role-based sorting.

## Preparation and Execution

AUTH and CHAT-01 retain their existing detailed packs with only out-of-pilot family
requirements deferred. The remaining three are explicitly authored in
[pilot-chat-plans.mjs](../../../tests/e2e/deployed/pilot-chat-plans.mjs), with fixed prompts,
phases, budgets, capture fields/regions, heuristic algorithms and qualitative semantic
expectations. Preparation materializes them before execution into
[CHAT-02.json](../../../tests/e2e/deployed/preparation/CHAT-02.json),
[CHAT-03.json](../../../tests/e2e/deployed/preparation/CHAT-03.json) and
[CHAT-04.json](../../../tests/e2e/deployed/preparation/CHAT-04.json).

The compiler does not interpret free-form instructions at runtime. Existing draft designs
are preserved; only validated content bindings may be refreshed. Changed or attested
contracts are rejected rather than overwritten. The
[pilot heuristics](../../../tests/e2e/deployed/pilot-chat-heuristics.mjs) have distinct
positive/negative offline checks, including intermediate failures followed by correction.
Synthetic fixtures test the evaluator, not the deployed product or semantic reviewer.

Preflight now reports exactly five rows. It still requires complete selected-variant
task/capture/heuristic preparation, configured and calibrated open-ended semantic review,
real identity/provider budgets and independent evidence approval. The smaller denominator
does not waive these. Semantic review must inspect all planned timeline windows and assets
and synthesize the complete experience, with novel anomaly categories allowed.

## Current Blockers

No five-flow live attempt has run. The three multi-turn/anchor/cancellation drivers
are implemented and passed [local driver calibration](pilot-driver-calibration.md),
including inspected final screenshots. This does not qualify actual backend behavior.
The designated account is now signed in to the verified existing Edge automation page.
The authenticated runner has a locally tested attachment/ownership path; it no longer
exports storage or launches a replacement authenticated browser. It validates receipt and
live process/listener identity before connection, instruments only the exact page, and
leaves all borrowed browser resources open. Each authenticated flow starts a separate
empty test-owned conversation through a fixed blank-document handoff; CHAT-02's two turns
and CHAT-04's two runs remain within their respective same-thread flow, not CHAT-01's thread.
No attachment integration has been exercised against the real browser yet.

Installed SDK authentication and enabled `gpt-5.4` metadata are verified. The user
explicitly approved up to100 Copilot AI credits including paid overage and USD2 for
the six app submissions. The earlier quota blocker is resolved. The active mandatory
pre-execution requirements have not been replaced by the requested POC exception.

The [real SDK semantic canary](../../../.harness-state/deployed-eval/semantic-roundtrip-170b9cad-d499-405d-a724-7db79f26b48d/result.json)
completed one synthetic window review and separate synthesis with valid output. Four
model requests across the failed and successful contract attempts consumed4.252 credits;
no app-provider spend occurred. The earlier contradictory clean-with-gaps result remains
[retained as failed](../../../.harness-state/deployed-eval/semantic-roundtrip-40c71812-175c-4dc0-8dce-e723c839a04b/result.json).
This proves runtime operation, not held-out reviewer effectiveness or product behavior.

Verified SDK constraints: runtime session limits have a minimum of30 credits, so the
smaller hard allowance is enforced by pre-dispatch reservations. The native runtime
performs its own metadata GET and omits `max_output_tokens`; the canary supplies that
documented Responses cap and counts text with installed `o200k_base` plus framing reserve.
The two-call cap and seven-credit stage ceiling remain stricter than the runtime limit.
A
candidate lossless timeline format exactly reconstructs retained fixtures in bounded
windows, but is not adopted and does not solve the complete priced review envelope.
See the [runtime/capacity checkpoint](../05-evaluation-and-design-system.md).

Borrowed-page calibration, complete review capacity, semantic runtime/held-out calibration,
independent approval, paint/privacy and actual API identity gaps remain. All drafts stay
unsigned and `NOT_READY`, not a partial or synthetic pass. The 145 passing offline tests
establish local behavior only; no real five-flow attempt has run.

CHAT-01 terminal interpretation now uses accepted-run identity, observed run receipts
and the recorder-side status carried by each snapshot. A buffered running snapshot is
not terminal merely because the host has entered its complete phase. Conversely, a
wrong terminal snapshot observed before that phase still fails even after correction.
Missing run/frame correlation is insufficient. Known visibility and visual-order failures
remain failures, including zero-area content and a previously visible message hidden
under a new entrance flag. These are deterministic evidence checks, not compositor or
independent design-system qualification.

Continue only selected-flow implementation and prerequisite work. Do not expand the other55
flows, rerun unchanged recorder calibration or resume paused product delivery. Once ready,
execute in manifest order using the real deployed app and dedicated account, retain every
attempt and stop on critical chronology/privacy failures, missing evidence or budget limits.