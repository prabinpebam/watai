# Watai Design System & Library — Audit Report

> Status: **Implemented** — the issues below have been remediated; see §11 (Resolution) for the
> mapping of fixes. Evidence is cited as `path:line`. Severity: **P0** = correctness / theming
> bug · **P1** = systemic discipline breach · **P2** = polish / consolidation.

---

## 1. Executive summary

The Watai design system is, at its **foundation, genuinely high grade**: a single, complete
token source (`src/design/tokens.css`), a clean primitives layer (`src/design/ui.tsx`,
`overlays.tsx`), CSS split into three tokens-only files, a build-ready written spec
(`documentation/ui-design/`), and almost no `!important` abuse. Buttons, inputs, switch,
segmented control, and the modal/sheet/menu overlays are exemplary single-source components.

The gap between **"good design system"** and **"top-grade, fully-disciplined design system"**
is concentrated in one root cause:

> **Several spec'd primitives exist only as CSS classes, not as React components with
> variants. Where a component is missing, callers re-implement it inline — so sizing,
> color, and weight leak back into feature code as magic numbers and hardcoded hex.**

The clearest example: there is **no `Avatar` component and no avatar size variants**, even
though the tokens (`--size-avatar-sm/md/lg`) and the `.avatar` class exist. As a result the
avatar is sized inline in **~12 places** with **six different pixel values (28/36/44/56/64/72)**,
three of which aren't even on the token scale.

Headline issues:

| # | Severity | Issue | Blast radius |
| --- | --- | --- | --- |
| 1 | **P0** | Hardcoded hex in inline styles (`#fff`, `#aaa`) — won't theme, wrong in dark mode | `ImagesView.tsx` ×3 |
| 2 | **P1** | No `Avatar` component / size variants → inline sizing duplicated, off-token values | ~12 sites |
| 3 | **P1** | `Spinner` has only `large`; real sizes set via inline `width/height` (border doesn't scale) | ~7 sites |
| 4 | **P1** | No font-weight tokens; spec says "400/500/600, no 700+" but code uses `650` and inline `700` | CSS + 2 sites |
| 5 | **P1** | Anchored-popover behavior re-implemented 3× instead of one `Popover` primitive | overlays/ToolsMenu/DevMenu |
| 6 | **P1** | Pervasive inline magic-number styling (gap/width/padding/fontSize) bypassing tokens | ~40 sites |
| 7 | **P2** | Spec'd primitives missing as components: Chip, Badge, Select, Slider, Skeleton, InlineAlert, ListRow, Tooltip | feature code |
| 8 | **P2** | Inline overrides that patch component CSS ("local fixes") instead of variants | overlays/Settings |

**Overall grade: B+ / "strong, not yet airtight."** The bones are A-grade; the discipline at
the leaf nodes (feature components consuming the system) is where it slips.

---

## 2. Scope & method

Reviewed:

- **Tokens:** `src/design/tokens.css`
- **Primitives / library:** `src/design/ui.tsx`, `src/design/overlays.tsx`,
  `src/design/icons.tsx`, `src/design/Logo.tsx`
- **Styles:** `src/design/global.css`, `src/design/components.css`
- **Consumers:** everything under `src/features/`, `src/app/`, `src/mocks/`
- **Source of truth:** `documentation/ui-design/01..09` (esp. `01-design-tokens.md`,
  `02-components.md`)

Method: token inventory, grep sweeps for inline styles / hardcoded hex / `!important` /
font-weight / raw `<button>` / `createPortal`, and a primitive-by-primitive comparison of the
**implemented** library against the **spec'd** component catalog.

---

## 3. What is already top-grade (keep / protect)

- **Single token source.** `tokens.css` is complete and well-structured: primitive palette →
  semantic tokens, full typography scale, 4px spacing grid, sizing, radii, elevation, motion,
  z-index, opacity, plus dark theme and a density override. This is the strongest part.
- **Tokens-only CSS contract.** All three CSS files open with "Tokens only"; `README.md`
  states "Tokens are fixed." The contract exists and is mostly honored.
- **Clean primitives.** `.btn` (`components.css:4`) is single-source with every variant/size/
  state; `Button`, `IconButton`, `Field`, `TextAreaField`, `Switch`, `Segmented`, `Spinner`
  are small, typed, and reused.
- **Compound overlays done right.** `Modal` (`overlays.tsx:26`) renders a centered dialog on
  desktop and a bottom sheet on compact from one API; `ConfirmDialog`/`PromptDialog` share one
  `.dialog` visual language; `Menu` is a real reusable surface.
- **No `!important` abuse.** All 13 occurrences are legitimate `prefers-reduced-motion` /
  shimmer overrides.
- **No duplicate component class definitions.** `.btn`, `.avatar`, `.spinner`, etc. are each
  defined once. Feature CSS lives in the same tokens-only files (no per-feature stylesheets).

---

## 4. Theme A — Token discipline

### A1 (P0). Hardcoded hex in inline styles — breaks theming
`src/features/images/ImagesView.tsx`:
- `:141` `style={{ color: '#fff' }}` (image-card prompt)
- `:160`, `:164` `style={{ color: '#aaa' }}` (viewer meta)

`#aaa` is invisible/wrong in light mode and unthemed in dark mode. `#fff` over media is a
*valid intent* but must be a token. **Fix:** introduce `--color-text-on-media` (or reuse
`--color-text-on-accent`) and a `--color-text-on-media-muted`; reference those.

### A2 (P1). Missing font-weight tokens + spec violations
- Spec (`01-design-tokens.md:169`): **"Weights available: 400, 500, 600. No 700+ in UI."**
- `tokens.css` defines **no** `--font-weight-*` tokens.
- CSS hardcodes `font-weight: 600` ~20×, `500` ×2, and **`650`** (`components.css:431`, off-scale).
- Inline **`fontWeight: 700`** violates the "no 700+" rule: `src/mocks/ChatGallery.tsx:257`,
  and `fontWeight: 600` inline in `Onboarding.tsx:59`, `SearchView.tsx:73`, `Settings.tsx:1485`.

**Fix:** add `--font-weight-regular/medium/semibold` (400/500/600) to `tokens.css`; replace all
literal weights; delete `650`/`700`.

### A3 (P1). Inline magic numbers bypassing the spacing/size scale
~40 inline styles use raw px/unitless numbers instead of `--space-*` / `--size-*`:
`App.tsx:36` `width: 40`, `App.tsx:99` `maxWidth: 440`, `Onboarding.tsx:38` `gap: 12`,
`ImagesView.tsx:102` `minHeight: 72`, `ChatView.tsx:89` `height: 12`, `ChatGallery.tsx:267`
`height: 64`, `SearchView.tsx:73` `marginBottom: 2`, `DevMenu.tsx:80` `padding: 8`, etc.
(`gap: 12` is exactly `--space-4`; using `12` opts out of the density override.)

**Fix:** swap to token values; for one-off spacers prefer a class (`.row`/`.col` already accept
token gaps) over inline numbers.

### A4 (P1). Inline z-index bypassing the `--z-*` scale
`src/mocks/DevMenu.tsx:28` `zIndex: 590` and `:31` `zIndex: 600` are invented values that
collide with `--z-tooltip: 600`. **Fix:** use `--z-sheet`/`--z-modal`/dedicated tokens.

### A5 (P2). Hardcoded `#fff` inside the design-system CSS itself
`components.css:58` `.btn--danger { color: #fff }` and `:262` `.avatar { color: #fff }` should
be `--color-primary-text` / `--color-text-on-accent`. Small, but it's the DS preaching tokens
while using literals.

---

## 5. Theme B — Reusable components & variants (anti-duplication)

This is the **core of the request** and the biggest opportunity. The spec
(`02-components.md`) defines 22 primitives; the library implements ~9 as components. Where a
primitive is **CSS-class-only**, callers re-implement it inline.

### B1 (P1). `Avatar` — the flagship duplication
- CSS `.avatar` (`components.css:255`) has **no size variants**; default size is undefined.
- Sized inline in ~12 places with **6 distinct values**: `28` (`Message.tsx:207`), `36`
  (`Onboarding.tsx:55`, `Settings.tsx:422/506/1245/1289/1499`), `44` (`Settings.tsx:332`),
  `56` (`ChatView.tsx:64`, `Settings.tsx:399`), `64` (`Settings.tsx:470`), `72`
  (`Onboarding.tsx:371`). Tokens only define 28/36/64 → **44/56/72 are off-scale**.
- `fontSize` for initials is *also* set inline (`13/18/22/24`).

**Fix:** add `<Avatar size="sm|md|lg" variant="user|assistant" src? initials? />` backed by
`.avatar--sm/md/lg` (driving width/height **and** initials font-size from tokens). Reconcile
56/72 into the scale or add `--size-avatar-xl`.

### B2 (P1). `Spinner` sizing
- Component exposes only `large` (`ui.tsx:138`); CSS has `18px` + `.spinner--lg 28px`.
- Spec A14 wants **16/20/24/32**. Callers force size with inline `width/height`:
  `ui.tsx:32` (the `Button` itself!), `Settings.tsx:1021/1048` (16), `ChatView.tsx:102/108`
  (14), `Message.tsx:35` (12), `Composer.tsx:208` (margin hack).
- Inline width/height **does not scale `border-width`**, so small spinners look heavy.

**Fix:** `<Spinner size="sm|md|lg|xl" />` → `.spinner--sm/md/lg/xl` setting width/height **and**
border-width together; remove every inline spinner size.

### B3 (P2). Other spec'd primitives that are CSS-only or hand-rolled
| Primitive (spec) | Today | Evidence |
| --- | --- | --- |
| Chip (A11) | suggestions are raw `<button className="suggestion">` | `ChatView.tsx` empty state |
| Badge/Pill (A13) | ad-hoc spans | "Temp" / mock badges |
| Select/Dropdown (A5) | hand-rolled menus | ModelSelector / model pickers |
| Slider (A9) | raw `<input type="range">` | `Settings.tsx:1155` |
| Skeleton (A15) | `.skeleton` + inline `width/height` | `ImagesView.tsx:129` |
| InlineAlert (A19) | `.alert` className used directly | `Message.tsx:240` (`+ inline marginTop`) |
| ListRow (A21) | `.setting-row` repeated by hand | Settings throughout |
| Tooltip (A17) | native `title` attr only | `IconButton` |

**Fix (incremental):** promote the highest-traffic ones to components first — `Chip`,
`InlineAlert`, `Select`. Lower-traffic (Slider, Tooltip, ListRow) can follow or stay as
documented exceptions.

### B4 (P1). Anchored-popover logic duplicated 3×
`createPortal` floating surfaces re-implement "position near anchor + outside-click +
viewport clamp" independently:
- `overlays.tsx:227` `Menu` (x/y context menu, own clamp + mousedown close)
- `src/features/chat/ToolsMenu.tsx:183` (own anchor math `:187`, own close)
- `src/mocks/DevMenu.tsx:26` (own scrim + inline position `:31`)

**Fix:** extract one `Popover`/`useAnchoredPosition(anchorRef)` primitive handling placement,
flip, clamp, focus trap, and dismiss; rebuild Menu/ToolsMenu/DevMenu/Select on it.

---

## 6. Theme C — Compound components & layouts

- **Good:** `Composer` (textarea + attach + tools + send/stop) and `Modal` (header/body/footer
  + adaptive sheet) are well-formed compounds. Layout utilities `.row`, `.col`, `.grow`,
  `.page__inner` exist.
- **Issue (P2):** layout is frequently expressed as **inline flex with raw gaps** rather than
  the utilities + token gaps — `Onboarding.tsx:38/89` `style={{ ... gap: 12 }}`,
  `ImagesView.tsx:105`, `VoiceMode.tsx:170/175`, `ChatGallery.tsx:223`. This re-derives the
  same flex recipe repeatedly and opts out of the density token.
- **Issue (P2):** `AppShell.tsx:59/71/88` repeat `style={{ justifyContent: collapsed ? 'center'
  : 'flex-start' }}` on three nav rows — should be a `.nav-row--collapsed` modifier toggled by
  one class.

**Fix:** standardize on `.row`/`.col` (with `gap` via token), add a `--collapsed` modifier for
the sidebar nav, and forbid inline flex recipes in review.

---

## 7. Theme D — Local styles & fixes (inline overrides patching the system)

These are "local fixes" — inline style that patches a component's CSS for one context instead
of a variant in the single source:

- `overlays.tsx:38` `style={{ padding: '0 0 12px' }}` and `:44` `style={{ paddingInline: 0 }}`
  patch `.modal__header`/`.modal__footer` **for the sheet variant**. Belongs in CSS as
  `.sheet .modal__header { ... }`.
- `Settings.tsx:1211` `style={{ padding: 0, borderBottom: 'none' }}` and `DevMenu.tsx:36`
  `style={{ padding: '8px', borderBottom: 'none' }}` patch `.setting-row` → add a
  `.setting-row--flush` modifier.
- `Settings.tsx:1301`, `DevMenu.tsx:33` inline padding on menu/label rows → variants.
- **Duplicated reduced-motion block:** `global.css:101` and `components.css:2021` both define
  `@media (prefers-reduced-motion)` overrides → consolidate into one.

---

## 8. Opportunities & guardrails (prevent regression)

Adding components and tokens fixes today's drift; **guardrails** stop tomorrow's:

1. **Stylelint** (CSS): ban hardcoded hex/px outside `tokens.css`
   (`declaration-property-value-disallowed-list`), enforce tokens-only.
2. **ESLint** (TSX): a `no-restricted-syntax` rule flagging `style={{ }}` JSX attributes that
   contain numeric literals or hex strings (allow `var(--…)` and genuinely dynamic values).
3. **Avatar/Spinner/Chip components** land first → delete the inline call sites they replace.
4. **Font-weight tokens** + a `.u-weight-*` utility; remove `650`/`700`.
5. **`Popover` primitive** → collapse the three menu implementations.
6. A short **"DS contract"** note in `02-components.md`: *no inline numeric/hex styles; size via
   variant props; new visual = a variant in the single source, never an inline patch.*

---

## 9. Prioritized remediation plan (suggested)

**Phase 1 — correctness & tokens (small, high value)**
- A1: replace `#fff`/`#aaa` in `ImagesView` with tokens (add `--color-text-on-media*`).
- A2: add font-weight tokens; purge `650`/`700` and inline `fontWeight`.
- A4/A5: tokenize DevMenu z-index and DS `#fff`.

**Phase 2 — kill the flagship duplications**
- B1 `Avatar` component + `--sm/md/lg(/xl)` variants; migrate ~12 call sites.
- B2 `Spinner` `size` variants (width + border); migrate ~7 call sites.

**Phase 3 — consolidate behavior & layout**
- B4 `Popover`/`useAnchoredPosition`; rebuild Menu/ToolsMenu/DevMenu.
- Theme C: `.row`/`.col` migration + sidebar `--collapsed` modifier.
- Theme D: move inline sheet/row patches into CSS variants; merge reduced-motion blocks.

**Phase 4 — fill the component catalog**
- B3: `Chip`, `InlineAlert`, `Select`, then `Slider`/`Skeleton`/`ListRow`/`Tooltip`.

**Phase 5 — guardrails**
- Stylelint + ESLint rules; DS contract note; (optional) a component-gallery route to render
  every primitive/variant/state live for visual review.

---

## 10. Effort vs. impact

| Item | Impact | Effort | Order |
| --- | --- | --- | --- |
| A1 hex→token (dark-mode bug) | High | XS | 1 |
| A2 weight tokens | Med | S | 2 |
| B1 Avatar | High | S–M | 3 |
| B2 Spinner sizes | High | S | 4 |
| A3 magic-number sweep | Med | M | 5 |
| B4 Popover dedup | Med-High | M | 6 |
| Theme C/D consolidation | Med | M | 7 |
| B3 missing components | Med | M–L | 8 |
| Guardrails (lint) | High (durable) | S | 9 |

None of these are architectural rewrites — the foundation is sound. They are disciplined
clean-ups that move the system from **B+ to A**.

---

## 11. Resolution (implemented)

All phases were applied. Summary of changes:

**Tokens (`tokens.css`)** — added `--font-weight-regular/medium/semibold`, on-media colors
(`--color-text-on-media*`, `--color-on-media-hover`, `--color-media-bg`), highlight tokens
(`--color-mark-bg/text`), and `--size-avatar-xl`.

**P0 — theming.** Removed all inline `#fff`/`#aaa` from `ImagesView`; the dark image viewer now
uses on-media tokens. No hardcoded hex remains in any inline style.

**P1 — Avatar.** New `<Avatar size variant>` (`ui.tsx`) + `.avatar--sm/md/lg/xl` and
`.avatar--danger` classes; **all ~12 inline-sized avatars migrated** (sizes now from the token
scale only).

**P1 — Spinner.** `<Spinner size="sm|md|lg|xl">` + `.spinner--*` (width **and** border scale
from `--icon-*`); **all ~11 inline-sized spinners migrated** (incl. the `Button` primitive).

**P1 — Weights.** Weight tokens added; `650` and inline `700` removed (now `--font-weight-semibold`);
a `.text-strong` utility replaces inline `fontWeight` in feature code.

**P1 — Popover dedup.** Extracted `useDismiss(active, onClose, refs)` (`lib/hooks.ts`); `Menu`
and `ToolsMenu` now share it (DevMenu z-index/padding tokenized).

**P1 — magic numbers.** Tokenized inline numerics that map to the scale (gaps, spacers,
DevMenu z-index/padding); colors fully tokenized.

**P2 — local fixes.** Sheet header/footer padding moved to `.sheet .modal__header/__footer`;
`.setting-row--flush` + `.btn--align-start` (sidebar) replace inline overrides; the duplicate
`prefers-reduced-motion` block was removed.

**P2 — components.** Added `<InlineAlert tone>` (3 call sites migrated) + `.alert--success/info`.
Chip/Badge intentionally **not** componentized — Chip has no consumers and Badge usage is already
token-clean (componentizing would be churn, not value).

**Guardrail.** `scripts/check-design-system.mjs` (`npm run lint:ds`, wired into `npm run build`)
fails on hardcoded hex in the design stylesheets or in any JSX inline style. The DS contract is
documented in `ui-design/02-components.md`.

**Verification.** `npm run build` (guardrail + typecheck + bundle) passes; 193 frontend tests
pass. Deliberately deferred (documented exceptions, low value/high churn): full `font-weight: 600`
literal sweep in CSS (value-identical to the token), and standalone `Select`/`Slider`/`ListRow`/
`Tooltip` components (low traffic).
