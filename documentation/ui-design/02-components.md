# 02 — Component Library

Every component the frontend needs, specified to build-ready depth. Each entry lists
**anatomy**, **variants**, **sizes**, **states**, **props**, **tokens**, **behavior**,
and **a11y**. Components consume only semantic tokens from
[01-design-tokens.md](01-design-tokens.md). Strings come from
[07-content-and-assets.md](07-content-and-assets.md); icons from the same doc.

Conventions used in this doc:

- **States** every interactive component must define: `default`, `hover`, `focus-visible`,
  `active/pressed`, `disabled`, plus role-specific (`loading`, `selected`, `error`,
  `checked`, `indeterminate`, `empty`).
- Sizes reference `--size-control-*` (32 / 40 / 48) and `--icon-*`.
- "Hit target ≥ 44px" means visual size may be smaller but the tappable area is padded
  to 44px.

## Implementation discipline (enforced)

- **Tokens only.** Color, type, spacing, sizing, radius, elevation, motion, and z-index come
  from `src/design/tokens.css`. No hardcoded hex or magic numbers in component CSS or in JSX
  `style={{ }}`. `npm run lint:ds` (wired into `npm run build`) fails the build on hardcoded
  color literals outside `tokens.css`.
- **Variants, not inline overrides.** Size / tone / state are variant classes or component
  props (`<Avatar size>`, `<Spinner size>`, `<InlineAlert tone>`), never per-call inline styles.
- **One definition per component.** Markup + styles live once; feature code composes primitives.
- **Shared behavior is a primitive.** Dismiss-on-outside-click/Escape is `useDismiss`; overlays
  portal through the shared `Modal` / `Menu`.

---

## A. Primitives

### A1. Button

Text action with optional leading/trailing icon.

- **Anatomy:** `[ leadingIcon? · label · trailingIcon? ]` inside a pill/rounded container.
- **Variants:**
  - `primary` — fill `--color-primary`, text `--color-primary-text`. One per view max.
  - `secondary` — fill `--color-surface-2`, text `--color-text-primary`, no border.
  - `outline` — transparent fill, `--border-hairline`, text `--color-text-primary`.
  - `ghost` — transparent, text `--color-text-primary`; hover fills `--color-surface-2`.
  - `text` — no fill/padding-x minimal; text `--color-accent` (link-like).
  - `destructive` — fill `--color-danger`, text white; or `destructive-ghost` (text
    `--color-danger`).
- **Sizes:** `sm` h32 / `body` / radius-sm; `md` h40 / `body` / radius-md (default);
  `lg` h48 / `body-lg` / radius-md. Horizontal padding: sm 12, md 16, lg 20.
- **States:**

| State | Treatment |
| --- | --- |
| default | per variant |
| hover | primary→`--color-primary-hover`; ghost/secondary→`--color-surface-2/3` |
| focus-visible | focus ring (§13 tokens) |
| active | scale 0.98, +1 surface step darker |
| disabled | `--opacity-disabled`, no pointer events |
| loading | label dims, inline spinner replaces leading icon, width preserved, `aria-busy` |

- **Props:** `variant`, `size`, `leadingIcon`, `trailingIcon`, `loading`, `disabled`,
  `fullWidth`, `type`, `onPress`, `aria-label` (icon-only).
- **A11y:** native `<button>`; `aria-disabled` when disabled-but-focusable; loading sets
  `aria-busy="true"`; min hit target 44.

### A2. IconButton

Square, icon-only button (app-bar actions, composer attach, message actions).

- **Sizes:** 32 / 40 (default) / 44; icon `--icon-24`; container radius `--radius-md` or
  `--radius-pill`.
- **Variants:** `ghost` (default), `filled` (surface-2), `accent` (icon `--color-accent`),
  `contained-primary` (the composer send: fill `--color-primary`, icon
  `--color-primary-text`, radius-pill).
- **States:** as Button; hover fills `--color-surface-2`; active scale 0.94.
- **Props:** `icon`, `size`, `variant`, `disabled`, `loading`, `aria-label` (**required**),
  `onPress`, `badge?`.
- **A11y:** `aria-label` mandatory; tooltip on desktop hover after 400ms.

### A3. TextField (single-line input)

- **Anatomy:** `[ leadingIcon? · input · trailing(action/clear/reveal)? ]`, optional
  label above and helper/error below.
- **Sizes:** h40 default / h48 large; radius-sm; padding-x 12; border `--border-input`.
- **States:**

| State | Treatment |
| --- | --- |
| default | border `--color-border`, text primary, placeholder tertiary |
| focus | border `--color-accent` + focus ring; label tints accent (if floating) |
| filled | unchanged |
| error | border `--color-danger`, helper→error text `--color-danger`, error icon |
| disabled | surface-2 fill, `--opacity-disabled` |
| readonly | no border emphasis; copy affordance if relevant |

- **Affordances:** `clear` (×) when non-empty + focused; `reveal` (eye) for password/key;
  `paste` hint for key fields.
- **Props:** `value`, `onChange`, `label`, `placeholder`, `helperText`, `error`,
  `leadingIcon`, `trailingAction`, `type` (`text|password|email|url`), `inputMode`,
  `autoComplete`, `disabled`, `maxLength`, `required`.
- **A11y:** `<label for>`; `aria-invalid` + `aria-describedby` to helper/error; error
  announced via `role="alert"`.

### A4. Textarea (auto-grow) — base for the Composer field

- Grows from 1 line to a max (composer: 40% viewport; settings: 6 lines) then scrolls.
- Enter/Shift+Enter behavior is owned by the host (Composer); base supports both.
- Same state set as TextField; no visible border in the composer variant (the composer
  container owns the border).
- **Props:** + `minRows`, `maxRows`/`maxHeight`, `submitOnEnter`.

### A5. Select / Dropdown

- Trigger looks like TextField with trailing chevron; opens a **Menu** (C5) of options.
- **States:** default/focus/error/disabled as TextField; `open` rotates chevron 180°.
- Mobile: opens a **BottomSheet** option list; desktop: anchored Menu.
- **Props:** `value`, `options[]`, `onChange`, `placeholder`, `renderOption?`,
  `disabled`.
- **A11y:** `role="combobox"`/`listbox` pattern; full keyboard (↑/↓/Home/End/typeahead/
  Esc).

### A6. Switch (toggle)

- Track 44×26, knob 22, radius-pill. Off: track `--color-surface-3`, knob white. On:
  track `--color-accent`, knob white, knob slides +18px over `--motion-fast`.
- **States:** default/hover (track +1 step)/focus ring/active (knob widens to 26)/disabled.
- **Props:** `checked`, `onChange`, `disabled`, `aria-label`/labelled-by.
- **A11y:** `role="switch"` + `aria-checked`; Space/Enter toggles.

### A7. Checkbox & A8. Radio

- 20×20; checkbox radius-xs, radio radius-pill. Unchecked: border `--color-border-strong`.
  Checked: fill `--color-accent`, white glyph (check / dot). Indeterminate (checkbox):
  white dash.
- **States:** default/hover/focus ring/active/disabled/checked/indeterminate.
- **A11y:** native inputs; grouped radios in `role="radiogroup"` with a group label.

### A9. Slider (Voice settings: VAD sensitivity, speech rate)

- Track h4 radius-pill `--color-surface-3`; filled portion `--color-accent`; thumb 20
  with `--elevation-1`.
- **States:** focus ring on thumb; active thumb scale 1.1; disabled muted.
- Optional tick labels and value bubble on drag.
- **A11y:** `role="slider"`, `aria-valuemin/max/now/text`; ←/→ step, Home/End, PageUp/Down.

### A10. SegmentedControl (e.g., Appearance: System/Light/Dark)

- Pill container `--color-surface-2`; selected segment raised `--color-bg` +
  `--elevation-1`; 2–4 segments equal width; selection slides `--motion-base`.
- **A11y:** `role="radiogroup"`; arrow keys move selection.

### A11. Chip

Three flavors share a pill shape (`--radius-pill`, h32, padding-x 12, `body`/`callout`).

- `suggestion` — prompt starters on empty state: surface-1 fill, hover surface-2, full
  text; tap fills composer.
- `filter` — toggle: unselected outline, selected fill `--color-accent` + white text.
- `attachment` — composer attachment: thumbnail + filename + remove (×); max-width with
  ellipsis.
- **A11y:** suggestion/filter are buttons; attachment remove has its own `aria-label`.

### A12. Avatar

- Sizes 28 / 36 / 64 (`--size-avatar-*`), radius-pill. Image, or initials on a
  deterministic surface tint, or a default user glyph. Optional presence dot (not in v1).

### A13. Badge / Pill label

- `count` (numeric, on icons), `dot` (status), `text` (e.g., "Temp", "Beta"). Heights 16
  (dot/count) / 20 (text); `label` type uppercase; colors via functional tokens.

### A14. Spinner

- Indeterminate ring, 1px–2px stroke, sizes 16/20/24/32, `--color-text-secondary` (or
  `--color-primary-text` on filled buttons). Rotates 0.8s linear. Reduced-motion: switch
  to a pulsing dot.

### A15. Skeleton

- `--color-skeleton` blocks with a shimmer sweep (`--color-skeleton-shine`, 1.2s). Shapes:
  line (text), circle (avatar), rect (image/card). Reduced-motion: static block, no
  shimmer. Used by message-loading, history-loading, image-loading.

### A16. ProgressBar

- Determinate (file/key test progress) and indeterminate. Track `--color-surface-3`, fill
  `--color-accent`, h4 radius-pill.

### A17. Tooltip

- Desktop only (hover/focus), 400ms open delay, 0ms between adjacent. Surface-1 + 
  `--elevation-2`, `caption`, max-width 240, 8px offset, arrow optional. `--z-tooltip`.
- **A11y:** `aria-describedby`; never the sole source of an accessible name.

### A18. Divider

- 1px `--color-border` (horizontal/vertical) or labeled divider ("Today") using `label`
  type with surface inset. Inset variants for list rows (start at content, not edge).

### A19. InlineAlert / Banner

- Full-width or inline rounded (`--radius-md`) message with leading status icon, text,
  optional action/close.
- **Tones:** `info` (accent), `success` (green), `warning` (amber), `danger` (red); tone
  sets icon + left accent; background is a 8–12% tint of the tone over surface.
- Used for offline, key-invalid, content-filtered, sync notes.
- **A11y:** `role="status"` (info/success) or `role="alert"` (warning/danger).

### A20. Toast

- Transient bottom-center (compact) / bottom-left (expanded) snackbar; surface-1 +
  `--elevation-2`, `--radius-md`, `body`; optional single action (e.g., **Undo** on
  delete). Auto-dismiss 4s (8s if it has an action); swipe/΄click-away to dismiss.
  Stacks max 3; `--z-toast`.
- **A11y:** `role="status"` polite; action is a real button; timer pauses on hover/focus.

### A21. ListRow (generic settings/menu row)

- **Anatomy:** `[ leadingIcon/avatar? · (title / subtitle) · trailing(value/chevron/
  switch/checkmark)? ]`; min-height 48; padding-x 16; tap feedback fills `--color-surface-2`.
- **Variants:** `nav` (chevron), `value` (right-aligned value + chevron), `toggle`
  (switch), `select` (checkmark when chosen), `destructive` (title `--color-danger`).
- **A11y:** entire row is one target; trailing control labelled by the row title.

### A22. SectionHeader

- Grouped-list header: `label` type, uppercase, `--color-text-secondary`, padding 16/8;
  optional trailing action (e.g., "Edit", "See all").

---

## B. Domain components (chat & content)

### B1. AppBar (TopBar)

- Height `--size-appbar`; three slots: leading (menu IconButton, compact only), center
  (ModelSelector + optional Temp badge), trailing (New-chat IconButton + overflow
  IconButton). Sticky `--z-appbar`; transparent over content at scrollTop 0, gains
  `--elevation-appbar` + `--blur-appbar` once content scrolls under.
- Title-less by default (the ModelSelector is the title). In Settings/sub-stacks, center
  shows the screen `title-3` and leading becomes a **Back** IconButton.

### B2. ModelSelector

- Trigger: `[ modelLabel ▾ ]` centered in the AppBar (`title-3`), tappable. Opens a Menu
  (desktop) / BottomSheet (compact) listing configured chat models with the active one
  checkmarked, each row `[ name · subtitle(reasoning_effort) · ✓ ]`, plus a footer link
  "Manage models" → Settings → Models.
- States: `default`, `open` (chevron 180°), `unconfigured` (label = "Set up model",
  accent), `error` (label tint danger when last call failed auth).
- **A11y:** combobox/listbox; announces selected model.

### B3. ConversationRow (history list item)

- **Anatomy:** `[ pin? · title (1 line, ellipsis) · timestamp ]` over an optional second
  line `lastMessagePreview` (1 line, secondary). Height 56 (1-line) / 64 (with preview).
- **States:** default; hover (surface-2); active; `selected` (current thread: surface-2 +
  3px leading accent bar in expanded sidebar); `renaming` (inline TextField replaces
  title); swipe-revealed actions (compact); `pressed-long` opens Thread menu.
- **Trailing (desktop hover):** a `⋯` IconButton → Thread menu.
- **A11y:** row is a link to `/c/:id`; pin state announced; actions reachable via the
  context menu key.

### B4. MessageGroup

- Wraps consecutive messages from one role; controls vertical rhythm (24px between
  groups, 8px within). Assistant groups are full-width; user groups right-aligned.

### B5. UserMessage (bubble)

- Right-aligned bubble: fill `--color-user-bubble`, `--radius-lg` with bottom-right
  `--radius-xs` tail, padding 12/16, `body-lg`, max-width min(75%, column). Attachments
  render as a thumbnail row above the text. Long-press/hover → action sheet.
- **States:** default; `sending` (80% opacity + tiny spinner badge); `failed` (danger
  hairline + retry affordance); `editing` (becomes a bordered Textarea with Save/Cancel);
  `selected-text`.

### B6. AssistantMessage (block)

- Full-width, **no bubble**. Renders the MarkdownRenderer (B7). Leading 28px brand mark
  optional. Below the content, a hover/long-press **action bar** (Copy, Regenerate,
  Read-aloud, Good, Bad, More).
- **States:** `streaming` (caret ▍ at end; action bar hidden except Stop is in composer);
  `complete`; `interrupted` ("Stopped" chip + Continue); `error` (InlineAlert in place of
  content + Retry); `empty-pending` (TypingIndicator until first token).

### B7. MarkdownRenderer (assistant content styles)

Sanitized markdown → styled elements. Exact mapping:

| Element | Style |
| --- | --- |
| paragraph | `body-lg`, 12px bottom margin |
| h1/h2/h3 | `title-1/2/3`, 20px top / 8px bottom |
| strong / em | weight 600 / italic |
| ul/ol | 20px inset, 6px item gap, custom markers |
| blockquote | 3px leading accent border, secondary text, 12px inset |
| inline code | `code` type, surface-2 fill, radius-xs, 2px/4px padding |
| code block | → CodeBlock (B8) |
| table | → TableBlock (B9) |
| link | `--color-accent`, underline on hover, `target=_blank rel=noopener noreferrer` |
| hr | 1px `--color-border`, 16px vertical |
| image (generated) | → ImageCard (B11) |
| math | → MathBlock (B10) |

- **Streaming-safe:** unclosed fences/markers render gracefully; re-parse is incremental
  to avoid layout thrash.
- **Security:** HTML sanitized; no raw HTML execution; URLs scheme-checked.

### B8. CodeBlock

- **Anatomy:** header bar `[ language · copy ]` + scrollable code area (mono `code`,
  `--color-code-bg`, `--radius-md`). Soft-wrap toggle in header; long lines scroll-x.
- **States:** default; `copied` (copy icon → check, "Copied" tooltip 1.2s); `wrapped`.
- Syntax highlighting via lazy-loaded grammars; unknown language → plain mono.
- **A11y:** copy button labelled; code in a `<pre><code>` with language class.

### B9. TableBlock

- Bordered, zebra optional; header row 600; horizontal scroll container on narrow
  screens with edge fade; cells `body`/`callout`.

### B10. MathBlock

- KaTeX render; inline `$…$` baseline-aligned; block `$$…$$` centered with x-scroll on
  overflow. Render failure → show the raw LaTeX in inline code, never crash.

### B11. ImageCard (inline generated image)

- Rounded (`--radius-lg`) image with intrinsic aspect ratio; max-width = column.
  **States:** `generating` (skeleton + shimmer + progress text), `complete`,
  `error` (InlineAlert + Retry). Tap → Image viewer (V-17). Long-press/hover → quick
  actions (Save, Variations, More). Caption row (optional): truncated prompt + "⋯".
- Multiple images (n>1) render as a 2-up grid that expands in the viewer.

### B12. Composer

The most complex component. See full behavior in
[04-screens-chat.md](04-screens-chat.md) §composer; component contract here.

- **Anatomy (collapsed):**
  `[ ＋(attach) · [ growing textarea / placeholder ] · 🎙(dictation) · primaryBtn ]`
  inside a `--radius-xl` container (surface-1, `--border-hairline`), min-height 56,
  bottom-anchored above safe-area.
- **Primary button morph:** empty→`voice` (IconButton accent, opens Voice mode);
  has-text→`send` (contained-primary, up-arrow); streaming→`stop` (filled square).
  Morph animates icon cross-fade `--motion-fast`.
- **Sub-states:** `disabled` (offline/unconfigured: field muted, placeholder explains);
  `dictating` (field shows live transcript + waveform strip + Stop); `with-attachments`
  (AttachmentChip row above the field); `editing-from` (forking a user message — shows
  "Editing" hint + Cancel).
- **Drafts:** value persists per thread.
- **A11y:** textarea labelled "Message Watai"; primary button announces its current mode;
  attachment chips list with remove buttons.

### B13. AttachmentChip — see A11 `attachment` flavor; used in composer & user messages.

### B14. WaveformVisualizer

- Canvas bar/line visualizer driven by Web Audio amplitude. Used in dictation (compact
  strip) and Voice mode (around the orb). Color `--color-accent`; idle = flat line.
  Reduced-motion: static level meter (no animation). Pure visual; `aria-hidden`.

### B15. VoiceOrb

- Central animated circle for Voice mode (`--size-orb`). Visual states map to machine
  states: `idle` (slow breathing scale 1.0↔1.03), `listening` (amplitude-reactive ring),
  `thinking` (rotating gradient sweep), `speaking` (pulse synced to TTS playback),
  `error` (settle + danger tint). Canvas/SVG; colors from tokens. Reduced-motion: static
  orb with a small state label. `aria-hidden`; state announced via the captions live
  region instead.

### B16. JumpToLatestPill

- Floating pill above composer, right-aligned, `[ ↓ · "New messages"? ]`,
  `--elevation-2`, `--z-jump-pill`. Appears when user scrolls up during/after streaming;
  tap → smooth-scroll to bottom; auto-hides at bottom.

### B17. TypingIndicator

- Three-dot animated indicator (assistant pending). Reduced-motion: static "…" with
  `aria-label="Assistant is typing"`.

### B18. EmptyState

- Centered: optional illustration/glyph, `display`/`title-2` headline, `callout`
  subtext, optional primary action and/or suggestion chips. Used by new-thread, empty
  search, empty gallery, archived-empty.

### B19. ErrorState

- Like EmptyState with a danger glyph, a plain-language message, and a primary **Retry**
  (and secondary "Open settings" where relevant). Used for failed loads and AI errors at
  surface scope.

### B20. SettingRow — see A21 ListRow variants; the Settings screens compose these.

---

## C. Overlays & navigation

### C1. Drawer (History)

- Left, width min(86vw, 360) compact; presents over a `--color-scrim` backdrop with
  `--blur-scrim`. Slides in `--motion-slow` `--ease-spring`; drag-to-close with rubber-
  band; flick threshold closes. `--z-drawer`. In expanded layout it is **not** an overlay
  — it is the persistent sidebar (same content component, different container).
- **A11y:** focus trapped while open; Esc closes; returns focus to the menu button;
  `aria-modal` when overlay.

### C2. Modal / Dialog

- Compact: full-screen layer sliding up `--motion-slow`, top corners `--radius-2xl`,
  drag-down to dismiss; a grabber handle + AppBar with Close/Back. Expanded: centered
  card (max-width 560), `--elevation-3`, scrim. `--z-modal`. Used by Settings (compact =
  full-screen stack), confirmations, Image viewer wrapper.
- **A11y:** `role="dialog"` `aria-modal`, labelled by its title; focus trap; Esc closes
  (unless a destructive confirm requires explicit choice).

### C3. BottomSheet

- Bottom-anchored panel, top corners `--radius-2xl`, grabber handle, scrim. Heights:
  `auto` (content), `half`, `full`. Drag between detents; flick-down dismiss. Compact-only
  pattern (becomes Menu/Popover in expanded). `--z-sheet`.

### C4. ActionSheet

- A BottomSheet specialized for a list of actions (message actions, thread menu, attach
  picker). Each row: `[ icon · label ]`; destructive rows use `--color-danger`; a
  trailing **Cancel** group on compact. Expanded equivalent = Menu anchored to the
  trigger.

### C5. Menu / Popover

- Anchored floating list (`--elevation-2`, `--radius-md`, surface-1), `--z-sheet`-ish but
  below sheets. Items: `[ icon? · label · trailing(shortcut/checkmark)? ]`; supports
  separators, section labels, submenus (desktop), destructive items. Opens `--motion-fast`
  scale+fade from the anchor edge.
- **A11y:** `role="menu"`/`menuitem`; full keyboard (↑/↓/Esc/Enter/typeahead); returns
  focus to trigger.

### C6. ConfirmDialog

- Small Dialog: `title-2` + `body` message + actions (Cancel / confirm). Destructive
  confirm uses `destructive` Button and requires explicit press (no Esc-confirm). Used for
  delete thread, delete all data, sign out.

---

## D. Component → token quick map (sanity table)

| Component | Key tokens |
| --- | --- |
| Button primary | `--color-primary`, `--color-primary-text`, `--radius-md`, `--motion-fast` |
| Composer container | `--color-surface-1`, `--border-hairline`, `--radius-xl`, `--size-composer-min` |
| UserMessage | `--color-user-bubble`, `--radius-lg`, `body-lg`, `--space-4` |
| AssistantMessage | `--color-text-primary`, `body-lg`, column `--size-column-max` |
| CodeBlock | `--color-code-bg`, `--font-mono`, `code`, `--radius-md` |
| Drawer | `--color-surface-1`, `--color-scrim`, `--elevation-3`, `--z-drawer` |
| Toast | `--color-surface-1`, `--elevation-2`, `--radius-md`, `--z-toast` |
| VoiceOrb | `--color-accent`, `--size-orb` |

---

## E. Component acceptance criteria

A component is done when: all states render correctly in light + dark; it is fully
keyboard operable with a visible focus ring; it uses only semantic tokens; it meets its
minimum hit target; reduced-motion is honored; and its props match this contract. Each
screen doc references these components by name; if a screen needs a behavior not listed
here, add it here first (single source of truth).
