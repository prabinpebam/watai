# Pilot Driver Calibration

Status: FROZEN SYNTHETIC PROCEDURE; NOT REAL-PRODUCT QUALIFICATION.
Version: 3. Date: 2026-09-12.

Run the actual recorder bundle, monitor and three driver functions on one owned headless
Chromium browser with three sequential local pages,1280x850 scale1. All requests are
aborted and counted; any request attempt fails the stage. No Watai deployment, user
profile, identity service or provider is accessed. Lifecycle callbacks are explicitly
synthetic and cannot prove real backend behavior. No fixture may pass as product evidence.

The exact fixture markup/script is version-bound in the calibration runner. Its scroll
container is600px wide and240px high, overflow auto, with a fixed-line-height pre-wrapped
message body. A normal textarea and button use the real driver's Message, Send and Stop
generating accessible labels. Native click and wheel handlers run the fixed simulation.

For follow-up, the first input yields ACK, then the second yields MAPLE-27. For streaming,
the body first contains integers1..50, then grows by one line every two animation frames
through200. This ensures early genuine overflow and enough subsequent updates to inspect
the reading anchor. The fixture follows the bottom until a real wheel event; afterward
it retains the browser's actual scroll position. No driver sets scrollTop directly.

For cancellation, the same progression targets2000 lines. The real Stop click stops
further append work, emits cancel_requested, then canceled after two frames, and restores
the Send control. The next real prompt yields46. The canceled body's actual text must
remain unchanged through the next reply. Cases use new pages and independent identities.

Each page is capped at45seconds; the browser stage at60seconds and the changed-source decision stage
at4minutes. Static validation checks installed Chromium, fresh decision and fixture/bundle
identity before launch. Expected Send counts are2/1/2 for CHAT02/03/04; expected Stop count
is1 for CHAT04 and wheel count1 for CHAT03. Run the normal evidence-based pilot heuristic
on each complete retained timeline; require DIAGNOSTIC_PASS, no capture gaps, stable
anchor within2px, exact final bodies and one final screenshot per case.

Retain source/bundle/procedure hashes, actual browser version, counters, event timelines,
screenshots and partial results under a unique calibration attempt. One failure stops
later cases and closes only owned resources. No retries, threshold changes or discarded
prefixes. A pass supports these driver mechanics only. Authentication, actual lifecycle
transport, private evidence authority, semantic calibration and full capture sufficiency
remain separate unresolved gates for the real five-flow trial.

Revision2 adds an explicit recorder observation boundary for each synthetic run receipt.
Every snapshot retains the run status already delivered to that recorder. A snapshot
buffered before the terminal receipt remains a running snapshot even when received later.
Canceled-body immutability starts at the first snapshot carrying the canceled boundary,
not at an arbitrary earlier buffered body. Original events are retained in arrival order;
there is no sorting, dropped history or weakened terminal-content assertion.

The revision1 attempt at10:10:58Z remains a failed calibration: its first follow-up case
misclassified a buffered running snapshot as terminal. The new offline regression rejects
genuinely wrong terminal content while accepting the earlier running observation. One
changed-source revision2 attempt is permitted; no in-attempt tuning or automatic retry.

Revision3 addresses the screenshot review of revision2: short completed replies must
honor the fixture's existing follow-to-bottom behavior, and the real CHAT-02/04 driver
must require the final answer rectangle inside the visible conversation viewport.
CHAT-03 intentionally retains its user-pinned history anchor instead. The revision2
report and screenshot-review finding are retained unchanged. Inspect all three final
screenshots after the one revision3 attempt; any failed assertion or visual anomaly
ends this calibration approach without another retry stage. Task content and branch
counts are unchanged. This is still synthetic driver calibration, not deployed proof.