# 06 — Interaction, Motion & Accessibility

How Watai moves, responds to input, and remains usable for everyone. This binds the
motion/gesture/focus rules referenced throughout the screen docs. Tokens from
[01-design-tokens.md](01-design-tokens.md); components from
[02-components.md](02-components.md).

---

## 1. Motion principles

1. **Motion explains, never decorates.** Every animation communicates origin,
   relationship, or state change.
2. **Fast and interruptible.** Nothing blocks input; transitions can be reversed mid-flight.
3. **Token-driven.** Only the durations/easings in [01-design-tokens.md](01-design-tokens.md)
   §9 are used.
4. **Reduced-motion first-class.** Every animation has a reduced-motion equivalent.

---

## 2. Transition choreography (per surface)

| Surface | Enter | Exit | Duration / easing |
| --- | --- | --- | --- |
| History drawer (overlay) | slide-in from left + scrim fade | reverse | `--motion-slow` / `--ease-spring` |
| Bottom sheet / action sheet | slide-up from bottom + scrim fade | slide-down | `--motion-slow` / `--ease-spring` |
| Modal/Dialog (compact) | slide-up full-screen, corners round | slide-down | `--motion-slow` / `--ease-standard` |
| Modal/Dialog (expanded) | scale 0.96→1 + fade + scrim | reverse | `--motion-base` / `--ease-decelerate` |
| Menu / Popover | scale 0.95→1 + fade from anchor edge | fade | `--motion-fast` / `--ease-decelerate` |
| Voice mode | cross-fade + orb settle-in | fade-out + orb shrink | `--motion-slower` / `--ease-standard` |
| Image viewer | thumbnail→fullscreen shared-element zoom | reverse to thumb | `--motion-slow` / `--ease-standard` |
| Toast | rise + fade in | fade + fall | `--motion-base` |
| Route change (chat ↔ chat) | content cross-fade (no slide) | — | `--motion-fast` |
| New message append | user bubble: fade+rise 8px; assistant: fade-in | — | `--motion-fast` |
| Composer button morph | icon cross-fade (voice/send/stop) | — | `--motion-fast` |
| AppBar scroll separation | hairline+blur fade-in past 4px scroll | fade-out at top | `--motion-fast` |

**Streaming text:** tokens append with no per-character animation (only a blinking caret
`▍`, 1s steps); the caret hides on completion. This keeps long streams cheap and calm.

**Skeleton shimmer:** 1.2s linear sweep; removed entirely under reduced motion (static
block).

---

## 3. Gestures (touch / pointer)

| Gesture | Context | Result |
| --- | --- | --- |
| Edge-swipe from left | Chat (compact) | Open History drawer (tracks finger). |
| Swipe-left on drawer | Drawer open | Close drawer. |
| Swipe-down | Sheets, modals, Voice, Image viewer | Dismiss (with rubber-band + velocity threshold). |
| Swipe-left on row | ConversationRow | Reveal Pin/Archive/Delete. |
| Long-press | Message / conversation row | Open action sheet / thread menu. |
| Pull-down at top | Thread top | (Optional) load older / no-op at top. |
| Double-tap | Image viewer | Toggle zoom. |
| Pinch | Image viewer | Zoom; two-finger pan. |
| Horizontal swipe | Image viewer | Previous/next image. |
| Tap scrim | Any overlay | Dismiss (except destructive confirm). |

- **Drag detents:** sheets support `auto`/`half`/`full`; release snaps to nearest by
  position + velocity (`--ease-spring`).
- **Pointer parity (desktop):** hover reveals row/message actions; right-click opens the
  same context menus; wheel zooms in the viewer.

---

## 4. Scroll & focus behavior

### 4.1 Chat scroll
- **Stick-to-bottom** while streaming/new messages **unless** the user scrolled up > 48px;
  then freeze and show JumpToLatestPill (B16). Sending always returns to bottom.
- **Restore position** when reopening a thread (persist last scroll offset per thread).
- **Virtualization:** long threads virtualize rows; preserve scroll anchoring when
  earlier content height changes (e.g., images load) to avoid jumps.

### 4.2 Focus management
- **Modal/drawer/sheet open:** move focus to the first focusable (or the close button);
  **trap** focus within; **Esc** closes; on close, **return focus** to the trigger.
- **Route change:** move focus to the new view's heading (or main landmark) and announce
  the view name.
- **Composer:** after send, focus stays in the composer; after entering "edit & resend",
  focus moves into the edit field with text selected.
- **Voice mode:** focus the End/Close control; captions region announces state changes.
- **Skip link:** a visually-hidden "Skip to message input" link for keyboard users.

---

## 5. Keyboard map (desktop)

| Shortcut | Action |
| --- | --- |
| `Enter` | Send message |
| `Shift+Enter` | Newline in composer |
| `Esc` | Close top overlay / stop streaming / cancel edit |
| `Ctrl/Cmd + N` | New chat |
| `Ctrl/Cmd + K` | Search |
| `Ctrl/Cmd + B` | Toggle sidebar |
| `Ctrl/Cmd + ,` | Open Settings |
| `Ctrl/Cmd + Shift + V` | Start Voice mode |
| `Ctrl/Cmd + Shift + C` | Copy last assistant message |
| `Ctrl/Cmd + ↑` / `↓` | Previous/next thread in sidebar |
| `↑` (empty composer) | Edit last user message |
| `Ctrl/Cmd + /` | Show keyboard shortcuts sheet |
| `Tab` / `Shift+Tab` | Move focus (with visible ring) |
| Arrow keys | Navigate menus/lists/segments/sliders |

All shortcuts are listed in a `Ctrl/Cmd + /` help sheet and never override assistive-tech
shortcuts.

---

## 6. Accessibility (WCAG 2.2 AA)

### 6.1 Semantics & landmarks
- Page landmarks: `banner` (AppBar), `navigation` (history), `main` (chat), `contentinfo`
  where relevant.
- The message list is a `log` (`role="log"` / `aria-live="polite"`) so new assistant
  content is announced **without** interrupting; user's own sent message is not announced
  to themselves redundantly.
- Each message is an `article` with an accessible label like "Assistant said…" / "You
  said…" and a timestamp available to AT.

### 6.2 Streaming announcements
- Stream into a polite live region in **coalesced** chunks (e.g., on sentence/clause
  boundaries or ~time-batched), not per token, to avoid spamming screen readers.
- On completion, announce "Response complete"; on stop, "Response stopped"; on error, the
  error message via `role="alert"`.

### 6.3 Voice mode & captions
- The orb is `aria-hidden`; **captions** are the accessible channel: a live region
  announces state ("Listening", "Thinking", "Speaking") and the transcript/response text.
- Captions default **on**; toggle persists.

### 6.4 Forms & errors
- Every field has a programmatic `<label>`; helper/error linked via `aria-describedby`;
  invalid fields set `aria-invalid`; errors use `role="alert"`.
- The BYO-key/test results list announces per-model status changes politely.

### 6.5 Controls
- Icon-only buttons require `aria-label`; the composer primary button updates its label as
  it morphs ("Start voice" / "Send message" / "Stop response").
- Switches use `role="switch"`+`aria-checked`; segmented controls use radiogroup
  semantics; sliders expose `aria-valuetext` (e.g., "Speech rate 1.2×").

### 6.6 Focus visibility & target size
- `:focus-visible` ring on every interactive element (tokens §13).
- Minimum target 44×44px (WCAG 2.2 §2.5.8); small glyphs get hit-slop.

### 6.7 Color & contrast
- Text/icon contrast ≥ 4.5:1 (≥ 3:1 for large text and UI glyphs); verified against
  tokens (§2.4 of tokens). Never color-only state; pair with icon/text.

### 6.8 Motion & sensory
- Honor `prefers-reduced-motion`: no translate/scale/pulse; opacity-only ≤ `--motion-fast`;
  static orb/skeletons; caret still allowed (or static).
- No content flashes > 3×/sec.

### 6.9 Text & zoom
- Layout reflows to 200% zoom / 320px-equivalent without loss; dynamic type multiplier
  (Appearance) scales all text; no clipping or truncation of essential text.

### 6.10 Internationalization
- All strings externalized ([07-content-and-assets.md](07-content-and-assets.md)); RTL
  mirrors layout (drawer flips to right, chevrons mirror, message alignment swaps);
  locale-aware dates/numbers and history grouping.

---

## 7. Haptic-equivalent & sound

- Where the platform supports it (e.g., installed PWA on supported devices), provide subtle
  haptic feedback on send, long-press reveal, and detent snaps. Never required; purely
  additive. No sound effects by default (TTS audio excepted).

---

## 8. Interaction acceptance criteria

1. Every overlay traps focus, closes on Esc, and restores focus to its trigger.
2. Keyboard-only users can reach and operate every control; focus ring always visible.
3. Screen reader announces streamed responses politely and coalesced; voice-mode state via
   captions.
4. `prefers-reduced-motion` removes non-essential motion app-wide.
5. All gestures behave per §3 with velocity-based dismiss/snap.
6. Chat stick-to-bottom and position-restore behave per §4.1.
7. Contrast and target-size checks pass on every screen in both themes.
