# Deployed Public Baseline: 2026-09-12

Status: AUTH-01 public diagnostic passed; full deployed baseline BLOCKED.
No application code, account data, provider configuration or production deployment changed.

## Attempts

| Attempt | Real target and outcome | Observations |
| --- | --- | --- |
| AUTH-01 v1, 04:15:59Z | Actual public app; welcome/hit/focus checks true; INSUFFICIENT_EVIDENCE | 207 events, 176 frames, 4 semantic snapshots, 6 requests, 703,382 decoded bytes |
| AUTH-01 v2, 04:22:17Z | Actual public app; DIAGNOSTIC_PASS, no findings | 148 events, 117 frames, 4 semantic snapshots, 6 requests, 703,382 decoded bytes |

Original attempt ID: `2026-09-12T04-15-59.256Z-9cf942ed-7b82-4012-bd9c-5fcdcb3bbdd3`.
Corrected-plan attempt ID: `2026-09-12T04-22-17.582Z-bf0df71e-0b6c-444b-a020-7e839cf78f9b`.
Both original packages remain under the ignored `test-results/deployed-eval/` directory.

## Observed Failure and Repair

The v1 recorder measured approximately 505 ms from installation to its first animation
frame and classified that as a gap between delivered frames. The first sampled document
was still empty; subsequent frames were approximately 16 ms apart. That measurement
conflated startup latency with inter-frame sampling loss.

The recorder now records `startupWaitMs` and `firstFrame` separately, with `gapMs: null`
for the first sample. Later visible-frame gaps over 250 ms still fail and stop capture.
No timeout was extended, no old evidence was erased, and no claim of compositor-wide
coverage was added. AUTH-01 was versioned before its new real attempt.

Twelve offline tests pass, including genuine later-gap rejection, empty-outcome rejection,
sequence/phase gaps, transient inversion, privacy and host-side capture-loss shutdown.
The separate headless calibration detects inversion and hidden-prompt defects. Calibration
is not production evidence. Offline reevaluation reproduced the v2 diagnostic result.

## Serving Identity and Visible Result

Real URL: https://prabinpebam.github.io/watai/.
Browser: Chromium 149.0.7827.55, headless, fresh signed-out context, 1280 x 850.
v2 finished at `2026-09-12T04:22:20.183Z`.

- Plan SHA-256: `bfce42d64c1a61a0e08bbd3c67dd4db0733dad63f1e7179104574f186a39e834`.
- Serving entry asset SHA-256: `0dddef7253792318a3686a3e99a9b114d766b7246a05fc3525e818bccc1f5630`.
- Recorder SHA-256: `fbdb2e56a0a7f6708f9f2b56839f25199aa1abda1974c54fdd9a56b0fa2e37da`.
- Evaluator SHA-256: `7842c0f39183327865fb3a8b69abf981e0bfa24fba6382433b66e9a77a655b42`.
- Driver SHA-256: `81d65d97c9b3a67bd90268e9ecc2b922de43285efc9d766924d336815d5eaed2`.

The actual screenshot shows the welcome heading, supporting text, brand mark and a
visible Sign in button with keyboard focus. No Sign in click, token injection, fake
response, local app server, live provider call or POST request was used. This observation
does not establish independent DS approval or any signed-in workflow's correctness.

## Remaining Blockers and Next Action

CHAT-01 has an authored diagnostic capture plan and driver, but no protected genuine
dedicated session is available. Test-account provisioning/login bootstrap and provider
spend limits remain outstanding. The user was unavailable to supply safe setup details;
no personal account or credentials were borrowed.

Live execution was restored to disabled and permits consumed. `releaseEligible` remains
false. The next live work is legitimate dedicated test-account bootstrap, then the real
chat baseline and fixes driven by its evidence. The reported signed-in production failure
has not yet been reproduced or repaired; the only repair in this baseline is to recorder
measurement and safety handling.