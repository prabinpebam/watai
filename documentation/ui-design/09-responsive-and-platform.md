# 09 — Responsive & Platform Behavior

The authoritative spec for making Watai work **really well on both mobile and desktop
web**. It defines how the app adapts to viewport size **and input capability**, how every
surface transforms across breakpoints, and the platform-specific engineering (mobile
on-screen keyboard, dynamic viewport, desktop pointer/drag-and-drop) required for a
native-quality feel on each. This doc is the single source of truth for responsive
behavior; the screen docs reference it.

Parent: [README.md](README.md). Tokens: [01-design-tokens.md](01-design-tokens.md).
Components: [02-components.md](02-components.md). Interaction:
[06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md).

---

## 1. Principles

1. **Adapt to capability, not just width.** Layout responds to size; *affordances*
   respond to input (touch vs mouse vs keyboard). A 1100px touchscreen laptop and a
   1100px mouse desktop can differ.
2. **One component, multiple forms.** A surface (e.g. History) is a single component that
   renders as an overlay drawer on mobile and a persistent sidebar on desktop — never two
   implementations (component = single source of truth).
3. **No hover-only affordance.** Anything revealed on hover MUST have a touch/keyboard
   equivalent (long-press, always-visible, or context-menu key).
4. **Fluid between breakpoints.** The UI is correct at *every* width, not only at named
   breakpoints; content uses max-widths and flexible gutters, not fixed page widths.
5. **Respect the real viewport.** Use dynamic viewport units and the visual-viewport /
   virtual-keyboard APIs so the composer is never hidden behind the keyboard and full-
   height surfaces never get clipped by mobile browser chrome.
6. **Pointer precision sets density.** Coarse pointers get ≥44px targets and roomier
   spacing; fine pointers may show denser, hover-revealed controls.

---

## 2. Breakpoint & viewport system

### 2.1 Named ranges (mirror [01-design-tokens.md](01-design-tokens.md) §11)

| Range | Width | Primary layout |
| --- | --- | --- |
| **compact** | 0–599 | Single column, overlay drawer, bottom sheets, full-screen modals. |
| **medium** | 600–1023 | Single column + wider reading area; drawer may pin in landscape; sheets still used. |
| **expanded** | ≥ 1024 | Persistent (resizable) sidebar; dialogs/popovers replace sheets. |

- Breakpoints are evaluated on the **layout width of the app**, via container queries
  where supported (so the chat column adapts inside a resized window/pane), with viewport
  media-query fallback.
- **Continuous correctness:** between any two breakpoints the layout only changes max-
  widths/gutters; no element overlaps, clips, or reflows badly at intermediate widths
  (test the full 320→2560 range, §13).

### 2.2 Viewport units & app height

- Full-height surfaces use **dynamic viewport height**: `height: 100dvh` with
  `min-height: 100svh` as a safe fallback for browsers without `dvh`.
- The app root is a flex column: **app bar (auto) · scroll region (flex:1, min-height:0,
  overflow) · composer (auto)**. Height is driven by a single `--app-height` set from
  `visualViewport` (see §4.2), so address-bar show/hide and keyboard changes never break
  the layout.
- Never use bare `100vh` for the app shell (it ignores mobile browser chrome and the
  keyboard).

### 2.3 Viewport meta

```html
<meta name="viewport"
      content="width=device-width, initial-scale=1, viewport-fit=cover,
               interactive-widget=resizes-content">
```

- `viewport-fit=cover` enables `env(safe-area-inset-*)`.
- `interactive-widget=resizes-content` makes the on-screen keyboard shrink the layout
  viewport so the flex shell and `dvh` adjust automatically (primary keyboard strategy;
  §4.2 is the fallback).
- **Do not** set `maximum-scale=1` or `user-scalable=no` — they break pinch-zoom and fail
  WCAG. Input zoom is prevented with ≥16px fonts instead (§4.3).

---

## 3. Adaptive input model

Detect capability with media queries and feature checks; branch behavior accordingly.

```css
@media (hover: hover) and (pointer: fine)  { /* mouse/trackpad: hover affordances, denser */ }
@media (hover: none)  and (pointer: coarse){ /* touch: 44px targets, no hover reliance   */ }
@media (pointer: fine) and (any-pointer: coarse) { /* hybrid (touchscreen laptop)         */ }
```

| Concern | Fine pointer + hover (desktop) | Coarse pointer / no hover (touch) |
| --- | --- | --- |
| Row/message actions | Reveal on hover + right-click menu | Always-visible affordance + long-press menu |
| Tooltips | Show after 400ms hover/focus | None (label is visible or via long-press hint) |
| Target size | ≥ 32px visual (44 hit area) | ≥ 44px visual |
| Density | "Compact" available | "Comfortable" default |
| Scrollbars | Visible thin scrollbars | Overlay/auto-hide |
| Selection | Mouse drag select | Long-press select |
| Primary nav | Persistent sidebar | Overlay drawer + edge-swipe |

**Hybrid devices:** when both coarse and fine pointers exist, prefer touch sizing
(44px) but keep hover enhancements; never hide a function behind hover alone.

---

## 4. Mobile web platform behavior

### 4.1 Safe areas & orientation

- Honor `env(safe-area-inset-top/bottom/left/right)` on the app bar, composer, full-screen
  modals, and voice mode. The composer's effective bottom padding is
  `max(var(--space-3), env(safe-area-inset-bottom))`.
- **Portrait:** default single column.
- **Landscape (phone):** app bar height drops to 48; the message column keeps its 768 cap;
  the voice orb shrinks (`--size-orb` → ~150) so controls + captions stay visible above
  the keyboard/safe areas; image viewer fits-to-height.
- Re-layout on `orientationchange`/resize without losing scroll position or composer
  draft.

### 4.2 On-screen keyboard handling (critical)

The composer must stay pinned **above** the virtual keyboard, and the latest messages
must remain visible while typing.

- **Primary:** `interactive-widget=resizes-content` (§2.3) + the flex/`dvh` shell — the
  layout shrinks and the composer rides up automatically.
- **Fallback (iOS Safari & older engines):** subscribe to `window.visualViewport`
  `resize`/`scroll` and compute a keyboard inset:

```ts
const vv = window.visualViewport;
function syncViewport() {
  const keyboard = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
  document.documentElement.style.setProperty('--keyboard-inset', keyboard + 'px');
  document.documentElement.style.setProperty('--app-height', vv.height + 'px');
}
vv?.addEventListener('resize', syncViewport);
vv?.addEventListener('scroll', syncViewport);
```

- The composer container translates up by `--keyboard-inset`; the scroll region height uses
  `--app-height`; on focus, the active field + last message scroll into view
  (`scrollIntoView({block:'end'})`).
- **VirtualKeyboard API** (Chromium): optionally set
  `navigator.virtualKeyboard.overlaysContent = true` and use `env(keyboard-inset-*)` for a
  cleaner path; feature-detect and fall back to the visualViewport approach.
- When dictation/voice opens, blur the field to dismiss the keyboard first.

### 4.3 Prevent input auto-zoom

- iOS Safari auto-zooms when a focused input's font-size is **< 16px**. Therefore every
  `input`/`textarea` (composer, search, key wizard, settings) uses **font-size ≥ 16px**
  (the composer field uses `body-lg`/17px; search and form fields use a 16px input role).
  This is the accessible alternative to disabling zoom.

### 4.4 Scroll & touch tuning

- `overscroll-behavior: contain` on the chat list and drawer so they don't trigger page
  rubber-band or browser pull-to-refresh; the app shell sets `overscroll-behavior-y:
  none` on the root scroll owner.
- `touch-action: manipulation` on buttons/controls (removes the 300ms tap delay and
  double-tap zoom on controls); images in the viewer use `touch-action: none` so pinch/pan
  is handled by the gesture layer.
- Remove the grey tap flash: `-webkit-tap-highlight-color: transparent`; provide our own
  press state (`--opacity-scrim-press`).
- Momentum scrolling is native; lists are virtualized (§ performance) to stay at 60fps.

### 4.5 Mobile chrome resilience

- The UI must not jump when the URL/address bar shows/hides — guaranteed by `dvh` +
  `--app-height` (§2.2). The composer and app bar stay glued to the true visual edges.

---

## 5. Desktop web platform behavior

### 5.1 Sidebar (persistent + resizable)

- Default 300px; **drag the right edge** to resize within 240–480px; double-click the
  handle resets to 300; toggle collapse to a 72px icon rail or fully hidden
  (`Ctrl/Cmd+B`). Width + collapsed state persist (localStorage).
- The handle is a 6px hover target with a `col-resize` cursor and a focus-visible
  keyboard mode (←/→ resize when focused).

### 5.2 Pointer affordances

- **Hover** reveals conversation-row `⋯`, message action bars, and the image quick
  actions; all also reachable by right-click (context menu) and keyboard.
- **Tooltips** (A17) on icon-only controls after 400ms hover/focus.
- **Right-click** opens the same Menu as the touch long-press sheet (thread menu, message
  actions).
- **Cursor states:** pointer on actionable, text on selectable, `col-resize` on the
  sidebar handle, `grab/grabbing` in the image viewer pan, `zoom-in/out` on the viewer.

### 5.3 Drag-and-drop & paste (attachments)

- **Drag files** anywhere over the chat/composer → a full-pane drop overlay ("Drop to
  attach"); on drop, valid images become AttachmentChips (same validation as the picker,
  [04-screens-chat.md](04-screens-chat.md) V-10). Non-images rejected with a toast.
- **Paste** an image from the clipboard into the composer → attaches it.
- Drag-over is debounced and shows the overlay only for file drags (not text selection
  drags).

### 5.4 Wheel / trackpad

- **Image viewer:** wheel/trackpad pinch zooms; click-drag pans; arrow keys + `+/-` zoom;
  `Esc` closes.
- **Wide content:** code blocks and tables scroll horizontally with Shift+wheel; an edge
  fade signals more content.
- Smooth-scroll honors `prefers-reduced-motion`.

### 5.5 Windowing & large screens

- Layout switches at breakpoints **on continuous resize** with no reload; drawer/sidebar,
  scroll position, and composer draft are preserved across the switch.
- The message reading column stays capped at 768px and centered in the main pane;
  on ultra-wide (≥ 1600px) the pane gutters grow rather than the text line-length.
- Multiple tabs/windows share storage; a `BroadcastChannel` keeps the active thread list
  and settings in sync across tabs (last-write-wins, no live cursor in v1).

### 5.6 Keyboard

- Full keyboard map in [06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md)
  §5 (New chat, Search, toggle sidebar, settings, voice, copy last, thread nav, shortcut
  help). Every pointer action has a keyboard path.

---

## 6. Layout transformation matrix (per surface)

How each surface renders across ranges. "Sheet" = BottomSheet/ActionSheet;
"Menu" = anchored popover; "Dialog" = centered modal.

| Surface | compact | medium | expanded |
| --- | --- | --- | --- |
| History (V-11) | Overlay drawer (edge-swipe) | Overlay drawer; pin in landscape | Persistent, resizable sidebar |
| Search (V-12) | Full-height overlay | Full-height overlay | Inline panel in sidebar / popover |
| Model selector (V-09) | Bottom sheet | Bottom sheet | Anchored menu |
| Attachments (V-10) | Action sheet | Action sheet | Menu + drag-drop + paste |
| Message actions (V-08) | Always-visible bar + long-press sheet | same | Hover bar + right-click menu |
| Thread menu (V-13) | Action sheet / swipe | Action sheet | Menu (hover `⋯` / right-click) |
| Settings (V-19–26) | Full-screen push stack | Full-screen push stack | Master/detail two-pane (or dialog) |
| Modal/confirm | Full-screen slide-up sheet | Slide-up sheet | Centered dialog |
| Image viewer (V-17) | Full-screen + swipe + pinch | same | Centered lightbox + wheel/keys |
| Voice mode (V-15) | Full-screen, orb 220 (150 landscape) | Full-screen | Full-window overlay, larger orb |
| Composer | Bottom, keyboard-aware | Bottom | Bottom; drag-drop + paste |
| Onboarding (V-02–05) | Full-screen | Centered ≤480 column | Centered card/dialog |

---

## 7. Component adaptation summary

Single components, two forms (see [02-components.md](02-components.md) for full contracts):

- **Drawer (C1)** ⇄ **Sidebar** — same content; overlay vs inline; sidebar adds resize.
- **BottomSheet/ActionSheet (C3/C4)** ⇄ **Menu/Popover (C5)** — same item model; anchored
  on desktop.
- **Modal (C2)** — full-screen sheet (compact) vs centered dialog (expanded).
- **Tooltip (A17)** — desktop-only; never the sole accessible name.
- **ConversationRow (B3)** — swipe actions (touch) vs hover `⋯` + right-click (desktop);
  selected state shows an accent rail in the sidebar.
- **AssistantMessage action bar (B6)** — always-visible (touch) vs hover-revealed
  (desktop); identical items.
- **Composer (B12)** — keyboard-aware bottom bar (mobile) + drag-drop/paste (desktop).

---

## 8. Media & images responsiveness

- Generated **ImageCards** use intrinsic aspect ratio, `max-width: 100%` of the reading
  column, and `loading="lazy"`; reserve space via aspect-ratio to prevent layout shift.
- The viewer fits-to-screen by the limiting dimension (width in portrait, height in
  landscape) and never upscales beyond native without explicit zoom.
- Provide responsive raster assets (`srcset`/density) only for bitmap brand/illustration
  assets; UI icons are SVG and resolution-independent.
- Avatars and thumbnails are square-cropped with `object-fit: cover`.

---

## 9. PWA & installed/standalone behavior

- **Manifest:** `display: standalone`, `theme_color`/`background_color` from tokens, icons
  + maskable icon ([07-content-and-assets.md](07-content-and-assets.md) §14),
  `orientation: any`.
- **Standalone (installed):** no browser chrome; our app bar is the top surface; safe-area
  insets apply; status-bar/theme color matches the active theme and updates on theme
  change.
- **Install:** desktop/Android show an install affordance using the `beforeinstallprompt`
  event; **iOS** has no prompt event → a one-time "Add to Home Screen" hint sheet with
  instructions (dismissible, shown only in Safari, non-nagging).
- **Offline:** app shell + visited threads cached; AI gated offline ([04](04-screens-chat.md)
  V-27). Installed and browser tabs share the same IndexedDB data.

---

## 10. Performance (per platform)

- **Targets:** 60fps for drawer/sheet/modal animations (transform/opacity only, never
  animate layout); time-to-interactive and shell budgets per [README.md](../README.md) §6.
- **Lists:** virtualize the chat message list and long history lists; preserve scroll
  anchoring when image/code heights resolve.
- **Code-split:** route-level splitting; lazy-load syntax-highlight grammars, KaTeX, the
  image viewer, and voice/audio modules so the first chat paint is light on mobile.
- **Streaming:** incremental, memoized markdown re-render; caret is CSS-only; no full-tree
  reflow per token (mobile CPUs are the constraint).
- **Low-end mobile:** verify on a mid/low-tier Android and an older iPhone; degrade
  shimmer/animations under reduced data/CPU; avoid large base64 images in memory (revoke
  object URLs).
- **Desktop:** support very long threads and large windows without jank; debounce resize
  and search.

---

## 11. Density & dynamic type interplay

- **Density** (Settings → Appearance: Comfortable/Compact) and **pointer capability**
  combine: Compact density is offered by default only on fine pointers; coarse pointers
  keep ≥44px targets even in Compact (padding shrinks, hit area does not).
- **Text size** multiplier (0.9–1.25) scales the whole type scale; layouts must reflow
  (wrap, grow) without clipping at the largest setting on the smallest width.

---

## 12. Per-surface acceptance (responsive)

Each screen doc's "Responsive" note must hold. Specifically:

1. **Chat** stays usable with the keyboard open on iOS/Android: composer above keyboard,
   latest message visible, no layout jump on address-bar toggle.
2. **History** is an overlay drawer with working edge-swipe on touch and a persistent,
   resizable sidebar on desktop — from one component.
3. **All sheets** become anchored menus/dialogs on expanded; **all full-screen modals**
   become centered dialogs; image viewer and voice mode adapt per §6.
4. **No affordance is hover-only;** every desktop hover action has a touch + keyboard path.
5. **Drag-and-drop and paste** attach images on desktop; the mobile picker covers touch.
6. Layout is correct and non-overlapping at **every** width 320–2560 in both orientations.

---

## 13. Responsive test matrix (inspection)

Verify the build against this grid (feeds the checklist in [README.md](README.md) §7).

**Viewports (px):** 320×568, 360×640, 390×844, 414×896, 768×1024, 834×1112, 1024×768,
1280×800, 1440×900, 1920×1080, 2560×1440.

**Orientation:** portrait + landscape on phone and tablet sizes.

**Browsers/engines:** Safari iOS, Chrome Android, Chrome/Edge (Win/macOS), Safari macOS,
Firefox.

**Input:** touch only, mouse only, trackpad, keyboard only, hybrid touchscreen-laptop.

**Conditions:** keyboard open, large text (XL), Compact density, dark + light, reduced
motion, offline, installed PWA (standalone), RTL.

**Per cell, confirm:** no clipping/overlap; composer reachable and above keyboard; nav in
its correct form (drawer vs sidebar); overlays in their correct form (sheet vs
menu/dialog); hover actions have touch equivalents; 60fps animations; scroll position +
draft preserved across resize/rotate.

---

## 14. Acceptance criteria (doc-level)

The app "works really well on both mobile and desktop" when:

1. The keyboard-open chat experience on real iOS Safari and Android Chrome keeps the
   composer pinned above the keyboard with the latest message visible and zero layout
   jump from browser-chrome changes.
2. Every surface in §6 renders its correct form at compact/medium/expanded and transitions
   cleanly on continuous resize without losing state.
3. No function is reachable by hover alone; touch and keyboard parity verified (§3).
4. Desktop adds resizable sidebar, hover/right-click affordances, tooltips, drag-and-drop
   + paste, and wheel/keyboard viewer controls.
5. The full test matrix (§13) passes with no clipping/overlap from 320→2560px in both
   orientations, both themes, and at XL text size.
6. Performance targets (§10) hold on a low-tier mobile device and a large desktop window.
