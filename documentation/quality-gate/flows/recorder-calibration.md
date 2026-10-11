# Local Recorder Calibration

Status: AUTHORED LOWER-LAYER PROCEDURE, NOT PRODUCT OR SEMANTIC QUALIFICATION.
Version: 1. Date: 2026-09-12.

## Purpose and Boundary

This procedure tests the recorder and known deterministic observation algorithms using
explicit synthetic fixtures. It does not run Watai, authenticate, query a provider or
qualify any real task flow. It cannot replace mandatory LLM semantic review, independent
calibration acceptance or real deployed-app evidence. AUTH and CHAT remain NOT_READY.

Use one installed Chromium instance, headless, at most two owned pages, viewport1280x850
and device scale factor1. Never touch a user browser/profile or Windows input/focus.
All page requests are aborted and counted; any attempted request fails calibration.
The complete browser lifecycle is capped at45seconds, underneath the existing hidden
120second process watchdog. No sleeps, automatic retry, modified threshold or baseline update.

The driver, bundled recorder and this procedure are hashed into the result. Screenshots,
actual browser version, event journals, counts and partial outcomes are retained in a
unique calibration attempt directory. A failed assertion preserves the prefix and closes
only owned resources. Successful lower-layer checks never issue a readiness capability.

## Frozen Public Fixture

The exact markup and CSS live in the calibration driver. Body has zero margin and a
neutral background. `.onboard` is at80px,80px, width360px, padding24px, white background.
Its h1 reads `Welcome to Watai`; `.onboard__actions` has12px padding. The sole button is
280x48px, display block, border0, dark fill, white `Sign in` text, radius4px. The focus
style has no outline and two spread-only shadows:2px white, then4px `rgb(230,0,126)`.
There are no external fonts, images, styles or scripts. The actual recorder bundle is
installed on the local page; observations come from browser APIs, not injected results.

## Fixed Case Order

1. Install fixture and recorder. Capture a checkpoint and assert exactly one button,
   region `welcome`, accessible name `Sign in`, visible ancestor, positive280x48 geometry,
   viewport-contained center and actual hit target within the button. A failure stops
   before any further case. This is the initial canary.
2. Press real Tab once. The button must own focus. Capture a screenshot and decode its
   actual PNG through browser-native `createImageBitmap` and `OffscreenCanvas`. Count
   matching pixels outside the button rectangle within its six-pixel surrounding region.
   Each RGB channel must be within2 of(230,0,126), alpha255. Require at least100 pixels.
3. Click the neutral body at(20,20), without OS mouse input. Capture the unfocused image
   using the same region and algorithm; require zero matching focus-ring pixels.
4. Set the button's `aria-labelledby` to the fixture's hidden label, whose exact text is
   `Continue securely`. The recorded accessible name must match that text, not the visible
   button text. Remove the attribute and require name `Sign in` again.
5. Add one fixed-position opaque overlay matching the actual button rectangle. Its center
   must be returned by browser hit testing, and recorded `hitWithinElement` must be false.
   Remove the overlay. No control is clicked through it.
6. Set `.onboard` opacity to0, checkpoint, restore opacity1, checkpoint. Retain both states;
   the recorded button must have `ancestorVisible:false` during the hidden state.
7. Set `.onboard__actions` padding0, width280px, height48px and overflow hidden. Press real
   Tab from the body to focus the button. Its client clipping rectangle must agree with
   the recorded clip bounds. Capture the clipped screenshot; the exact ring pixel count
   outside the button rectangle must be zero. This is a negative paint control, not a
   permissible product focus style.
8. Stop and drain the public recorder. Any capture-gap, lost sequence or unsupported
   decoding capability fails the calibration, even if expected visible cases were found.

Screenshots retain before/after recorder checkpoints. A changed semantic snapshot during
screenshot capture is recorded as ambiguous correspondence, never claimed as an exact
compositor-frame match. Local stable fixtures must have sufficient matching state.

## Frozen Chat Controls

Only after the public canary/cases pass, use the existing second local fixture containing
one prompt, an unrelated abstract subtree and a password input whose value is
`DO_NOT_CAPTURE`. Install the same recorder. Create an assistant node before the prompt,
observe two animation frames, move it after the prompt, observe two frames, hide the
prompt, observe two frames, restore it and observe two frames. Then stop and drain.

Require retained `RESPONSE_BEFORE_PROMPT` and `MESSAGE_HIDDEN` findings despite the final
correct order and restored prompt. Require timestamped mutation evidence and no retained
password value. Known injected product-style failures are expected calibration results;
missing recorder evidence is not. No real-product success claim is possible from this fixture.

## Interpretation and Follow-Up

A pass supports only these concrete local layout/name/pixel/ordering observations. It
does not prove every compositor frame, full DOM reconstruction, every selector, real
production assets, all viewports, arbitrary transforms/clips, user-state isolation or
semantic-agent effectiveness. Unsupported geometry must remain unavailable rather than
being approximated into a pass. Independent review and held-out calibration remain
required before any readiness attestation can be accepted.

After this bounded attempt, leave the calibration thread. Continue semantic capacity,
dispatch controls and exact remaining preparation/authority blockers; do not rerun the
same calibration unless a relevant source/runtime/contract change invalidates it.