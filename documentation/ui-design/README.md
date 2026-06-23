# Watai UI Design Specification

This is the **implementation-ready** UI design specification for the Watai frontend.
It is exhaustive by intent: every screen, every state, every component, every token,
and every interaction is specified so a developer can build the frontend without making
design decisions. The reference experience is the ChatGPT iOS app; we re-implement its
*patterns* with **original** tokens, assets, and copy. No proprietary assets, color
values, icons, or strings are copied.

Parent docs: [../README.md](../README.md) ·
[../01-product-spec.md](../01-product-spec.md) ·
[../03-api-integration.md](../03-api-integration.md) ·
[../04-data-model.md](../04-data-model.md).

---

## 1. What "implementation ready" means here

A view is implementation-ready when **nothing is left to interpretation**. Concretely,
this spec guarantees, for every surface:

1. **Tokens are fixed** — exact color hex (light + dark), type (family/size/weight/
   line-height/tracking), spacing, radii, borders, shadows, motion, z-index, breakpoints
   ([01-design-tokens.md](01-design-tokens.md)).
2. **Components are fully defined** — anatomy, every variant, every state
   (default / hover / focus-visible / active / disabled / loading / selected / error /
   empty), sizing, and props ([02-components.md](02-components.md)).
3. **Every view is drawn in words** — ASCII wireframe, exact measurements, the components
   it composes, responsive behavior per breakpoint, and all of its states (screens docs
   [03](03-screens-onboarding-settings.md)–[05](05-screens-history-voice-images.md)).
4. **Interaction & motion are specified** — gestures, transitions, durations, easings,
   scroll/focus behavior ([06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md)).
5. **Copy is real** — actual strings, not lorem ([07-content-and-assets.md](07-content-and-assets.md)).
6. **Assets are listed** — every icon, the logo, illustrations, with size/format
   ([07-content-and-assets.md](07-content-and-assets.md)).
7. **Accessibility is explicit** — roles, ARIA, focus order, keyboard map, contrast
   ([06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md)).
8. **Frontend architecture is decided** — folder structure, routing, state shape,
   TypeScript types, AI client contracts (aligned to the real `/openai/v1` API), and a
   **mock/local-data layer so the UI runs with no backend**
   ([08-frontend-architecture.md](08-frontend-architecture.md)).
9. **Acceptance is testable** — each view ends with acceptance criteria and feeds the
   manual inspection checklist (§7 below).

A reviewer should be able to read any screen section and a developer should produce the
same pixels.

---

## 2. Frontend-first build strategy

We build and approve the **frontend in isolation** before any backend exists. This is
viable because of Watai's two-plane design ([../02-architecture.md](../02-architecture.md)):

| Capability | In the frontend-only build | Notes |
| --- | --- | --- |
| Chat, transcription, image, TTS (the **AI plane**) | **Real** — the browser calls the user's `/openai/v1` endpoint directly with their key | No backend needed; fully inspectable. |
| Accounts / auth (the **persistence plane**) | **Stubbed** — a local "profile" with no real sign-in | Auth screens are built and navigable but resolve to a local session. |
| History, threads, messages, images metadata | **Local** — persisted in IndexedDB (the local-only mode, D9) | Survives reload; exportable. |
| Image/audio blobs | **Local** — stored as blobs in IndexedDB | Swapped for Azure Blob later. |
| Cross-device sync | **Off** | Sync engine interface exists but no-ops against a local adapter. |

Everything the user inspects is real interaction and real AI output; only persistence is
local. The data layer is built behind a `Repository` interface
([08-frontend-architecture.md](08-frontend-architecture.md) §data) so swapping the local
adapter for the Azure adapter later touches no UI code.

> **Inspection without a key:** every screen also supports a **demo/mock data mode** so
> the reviewer can see fully populated history, messages, images, and states without
> entering a key. Toggled in a dev-only menu ([08](08-frontend-architecture.md) §mocks).

---

## 3. Document map

| Doc | Contents |
| --- | --- |
| [README.md](README.md) | This file: implementation-ready definition, frontend-first strategy, global app frame, breakpoints, inspection checklist. |
| [01-design-tokens.md](01-design-tokens.md) | Color, type, spacing, sizing, radii, borders, shadows, motion, z-index, breakpoints, focus ring, opacity — with exact values and CSS variable names. |
| [02-components.md](02-components.md) | Every primitive and composite component: anatomy, variants, states, sizing, props, a11y. |
| [03-screens-onboarding-settings.md](03-screens-onboarding-settings.md) | Splash, welcome, auth, BYO-key wizard, permissions, Settings hub + every subpage. |
| [04-screens-chat.md](04-screens-chat.md) | Chat home, empty state, message rendering (user/assistant/markdown/code/math/tables), composer, attachments, message actions, model selector, temporary chat, streaming. |
| [05-screens-history-voice-images.md](05-screens-history-voice-images.md) | History drawer, search, thread menu, dictation, voice mode, inline images, image viewer, gallery. |
| [06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md) | Gestures, transitions, motion choreography, scroll/focus, keyboard map, ARIA, contrast, reduced motion. |
| [07-content-and-assets.md](07-content-and-assets.md) | All UI strings/microcopy and the full icon/logo/illustration asset inventory. |
| [08-frontend-architecture.md](08-frontend-architecture.md) | Folder structure, routing, state shape, TypeScript types, AI client contracts, mock/local data layer, env/config. |
| [09-responsive-and-platform.md](09-responsive-and-platform.md) | **Mobile + desktop web behavior:** breakpoints, input-capability adaptation (hover vs touch), on-screen keyboard, dynamic viewport, drag-and-drop, resizable sidebar, layout-transformation matrix, test matrix. |

Read in order on first pass.

---

## 4. Global app frame

Every primary surface lives inside one persistent frame. Dimensions are defaults; exact
tokens in [01-design-tokens.md](01-design-tokens.md).

### 4.1 Compact (phone, < 600px) — single column

```
┌───────────────────────────────────────────────┐
│ safe-area top inset                            │
├───────────────────────────────────────────────┤
│  ☰    Watai 5.4 ▾   · Temp        ＋    ⋯       │  App bar — height 56
├───────────────────────────────────────────────┤
│                                                │
│                                                │
│            scrollable content region           │  Fills remaining height
│         (message column, max-width 768,        │
│              centered, 16px side gutters)       │
│                                                │
│                                       ╭─────╮   │
│                                       │ ↓   │   │  Jump-to-latest pill (conditional)
│                                       ╰─────╯   │
├───────────────────────────────────────────────┤
│  ＋   Message Watai…              🎙   ⏺/▶/■   │  Composer — min-height 56, grows
├───────────────────────────────────────────────┤
│ safe-area bottom inset (home indicator)        │
└───────────────────────────────────────────────┘
```

- **App bar (top):** leading menu button (opens History drawer), centered model selector
  (label + chevron, optional "Temp" badge when temporary chat is active), trailing new-
  chat and overflow (thread menu). Sticky; gains a hairline bottom border + subtle blur
  when content scrolls under it.
- **Content region:** scrolls independently; content is width-capped to a 768px reading
  column, centered, with 16px side gutters on narrow screens.
- **Composer (bottom):** pinned above the bottom safe-area inset; auto-grows up to 40% of
  viewport height; the primary button morphs voice → send → stop.
- **Drawer & modals** present over this frame (see [02-components.md](02-components.md)
  Drawer/Modal/Sheet and [06](06-interaction-motion-accessibility.md) for motion).

### 4.2 Expanded (desktop, ≥ 1024px) — persistent sidebar

```
┌──────────────┬────────────────────────────────────────────┐
│  Watai        │   Watai 5.4 ▾                       ＋  ⋯   │  App bar — height 60
│  ───────────  ├────────────────────────────────────────────┤
│  ＋ New chat  │                                            │
│  🔍 Search    │                                            │
│  ───────────  │           message column (max 768),         │
│  Today        │              centered in the pane           │
│   • Thread A  │                                            │
│   • Thread B  │                                            │
│  Yesterday    │                                            │
│   • Thread C  │                                            │
│  ...          │                                            │
│  ───────────  ├────────────────────────────────────────────┤
│  ◎ Account    │  ＋  Message Watai…           🎙   ▶/■      │  Composer
└──────────────┴────────────────────────────────────────────┘
   sidebar 300px              main pane (fills remaining)
```

- **Sidebar (left, 300px, collapsible to 0/72px):** brand, New chat, Search, grouped
  conversation list, account at the bottom. This is the History drawer rendered inline
  instead of as an overlay.
- **Main pane:** the same app bar (minus the menu button) + content + composer.
- **Modals** become centered dialogs (Settings can be a full-pane stack or a dialog);
  the Image viewer is a centered lightbox; Voice mode is a full-window overlay.

### 4.3 Medium (600–1023px) — tablet

Single column like compact, but the reading column may widen and the drawer can be
pinned in landscape. Composer and app bar identical to compact.

### 4.4 Frame regions and which surfaces occupy them

| Region | Compact | Expanded |
| --- | --- | --- |
| Navigation | Overlay drawer | Persistent sidebar |
| Primary | Chat / view content | Chat / view content |
| Input | Bottom composer | Bottom composer |
| Overlays | Sheets, full-screen modals | Dialogs, lightbox, full-window voice |

---

## 5. Surface index (with screen-doc locations)

| ID | Surface | Doc |
| --- | --- | --- |
| V-01 | Splash / launch | [03](03-screens-onboarding-settings.md) |
| V-02 | Welcome | [03](03-screens-onboarding-settings.md) |
| V-03 | Sign in / sign up | [03](03-screens-onboarding-settings.md) |
| V-04 | BYO-key setup wizard | [03](03-screens-onboarding-settings.md) |
| V-05 | Permissions priming (mic) | [03](03-screens-onboarding-settings.md) |
| V-06 | Chat home — empty (new thread) | [04](04-screens-chat.md) |
| V-07 | Chat home — active thread | [04](04-screens-chat.md) |
| V-08 | Message action sheet | [04](04-screens-chat.md) |
| V-09 | Model selector | [04](04-screens-chat.md) |
| V-10 | Attachments picker | [04](04-screens-chat.md) |
| V-11 | History drawer / sidebar | [05](05-screens-history-voice-images.md) |
| V-12 | Search | [05](05-screens-history-voice-images.md) |
| V-13 | Thread menu | [05](05-screens-history-voice-images.md) |
| V-14 | Dictation (in composer) | [05](05-screens-history-voice-images.md) |
| V-15 | Voice mode (full screen) | [05](05-screens-history-voice-images.md) |
| V-16 | Inline image in chat | [05](05-screens-history-voice-images.md) |
| V-17 | Image viewer (lightbox) | [05](05-screens-history-voice-images.md) |
| V-18 | Image gallery (per thread) | [05](05-screens-history-voice-images.md) |
| V-19 | Settings hub | [03](03-screens-onboarding-settings.md) |
| V-20 | Settings — Account | [03](03-screens-onboarding-settings.md) |
| V-21 | Settings — Models & keys | [03](03-screens-onboarding-settings.md) |
| V-22 | Settings — Personalization | [03](03-screens-onboarding-settings.md) |
| V-23 | Settings — Voice | [03](03-screens-onboarding-settings.md) |
| V-24 | Settings — Data controls | [03](03-screens-onboarding-settings.md) |
| V-25 | Settings — Appearance | [03](03-screens-onboarding-settings.md) |
| V-26 | Settings — About | [03](03-screens-onboarding-settings.md) |
| V-27 | Global states (offline, error, loading, skeletons, toasts) | [04](04-screens-chat.md) §states + [02](02-components.md) |

---

## 6. Cross-cutting rules (apply to every view)

1. **Reading column:** assistant/user content is capped at 768px and centered; chrome
   may span full width.
2. **Safe areas:** honor `env(safe-area-inset-*)` top and bottom on every full-height
   surface.
3. **Theme:** every color comes from a semantic token; no literal colors in components.
   Light/dark switch is instant and complete.
4. **Touch targets:** ≥ 44×44px; small glyphs get invisible hit-slop to reach 44px.
5. **Focus-visible:** every interactive element shows the standard focus ring on keyboard
   focus ([01-design-tokens.md](01-design-tokens.md) §focus).
6. **Empty / loading / error:** every data-backed region defines all three; never a bare
   blank.
7. **Motion:** all transitions use the motion tokens and collapse to opacity/instant
   under `prefers-reduced-motion`.
8. **Copy:** all visible text comes from the string table
   ([07-content-and-assets.md](07-content-and-assets.md)); no hardcoded strings in
   components.
9. **Adaptive, not just responsive:** every surface renders its correct form for the
   viewport **and input capability** (touch vs mouse vs keyboard); the composer stays
   above the on-screen keyboard; layout is correct at every width 320–2560 in both
   orientations. Authoritative rules in
   [09-responsive-and-platform.md](09-responsive-and-platform.md).
10. **No hover-only affordance:** anything revealed on hover (desktop) has a touch and
    keyboard equivalent (long-press / always-visible / context-menu key).

---

## 7. Manual inspection checklist (frontend approval gate)

Use this to approve the frontend before backend work begins. Each item maps to per-view
acceptance criteria in the screen docs.

**Foundations**

- [ ] Light and dark themes both correct on every screen; switching is instant.
- [ ] Layout correct at 360, 600, 905, and 1280px widths.
- [ ] Safe-area insets respected on a notched device / simulator.
- [ ] All text scales with the OS/text-size setting without clipping.
- [ ] Keyboard-only navigation reaches every control; focus ring always visible.
- [ ] `prefers-reduced-motion` removes non-essential motion.

**Cross-platform (mobile + desktop)** — full grid in [09](09-responsive-and-platform.md) §13

- [ ] Chat usable with the on-screen keyboard open (iOS Safari + Android Chrome): composer
      pinned above the keyboard, latest message visible, no jump on address-bar toggle.
- [ ] History is an overlay drawer (edge-swipe works) on mobile and a persistent, resizable
      sidebar on desktop — from one component.
- [ ] Sheets become anchored menus/dialogs on desktop; full-screen modals become centered
      dialogs; image viewer + voice mode adapt.
- [ ] No hover-only action: every desktop hover/right-click action has a touch + keyboard path.
- [ ] Desktop drag-and-drop and clipboard paste attach images; mobile picker covers touch.
- [ ] Correct, non-overlapping layout at 320→2560px in portrait and landscape; XL text size.

**Onboarding & settings**

- [ ] Splash → Welcome → Sign in → BYO-key wizard flows end to end.
- [ ] BYO-key wizard validates each model with "Test connection" and shows per-model status.
- [ ] All Settings subpages render and persist changes locally.

**Chat**

- [ ] New-thread empty state with suggestion chips; first send creates a titled thread.
- [ ] Streaming renders token-by-token; Stop preserves the partial.
- [ ] Markdown, code (with copy + highlight), tables, and math render correctly.
- [ ] Message actions (copy/regenerate/edit/read-aloud/delete) work.
- [ ] Composer auto-grows; primary button morphs voice → send → stop.

**History, voice, images**

- [ ] Drawer lists threads grouped by recency; pin/rename/archive/delete with undo.
- [ ] Search filters live with highlighted snippets.
- [ ] Dictation inserts transcribed text at the caret.
- [ ] Voice mode runs a spoken loop and writes turns back into the thread.
- [ ] Image generation renders inline; viewer supports zoom/save/regenerate/variations.

**States**

- [ ] Offline banner + AI gating; reconnect restores.
- [ ] Every error type from [../03-api-integration.md](../03-api-integration.md) §6
      renders its correct message with no key leakage.
- [ ] Empty/loading/skeleton states present on every data region.

When every box is checked, the frontend is approved and backend implementation begins
([../05-execution-plan.md](../05-execution-plan.md) Phase 2).
