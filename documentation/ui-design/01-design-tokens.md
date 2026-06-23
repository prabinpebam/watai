# 01 — Design Tokens

The complete, fixed token system for Watai. Every value here is **original** to this
project. Components and screens reference tokens only — never literal values. Tokens are
implemented as CSS custom properties on `:root` (light) and `:root[data-theme="dark"]`
(dark), and mirrored as a typed TS object for use in logic.

Parent: [README.md](README.md). Used by every other doc.

---

## 1. Token architecture

Two layers:

1. **Primitives** — raw scales (gray-500, blue-500, size-4…). Never used directly in
   components.
2. **Semantic tokens** — role-based aliases (`--color-bg`, `--color-text-primary`,
   `--space-md`…). Components use **only** these. Theming swaps primitive→semantic
   mappings; component CSS never changes between themes.

Naming convention (CSS): `--{category}-{role}[-{variant}]`, e.g. `--color-surface-2`,
`--text-body-size`, `--space-5`, `--radius-lg`, `--elevation-2`, `--motion-base`.

---

## 2. Color

### 2.1 Primitive palette

Neutral (warm gray) scale:

| Token | Hex |
| --- | --- |
| `--gray-0` | `#FFFFFF` |
| `--gray-25` | `#FAFAFA` |
| `--gray-50` | `#F4F4F5` |
| `--gray-100` | `#ECECEF` |
| `--gray-200` | `#E1E1E6` |
| `--gray-300` | `#CDCDD4` |
| `--gray-400` | `#A8A8B3` |
| `--gray-500` | `#86868F` |
| `--gray-600` | `#6A6A73` |
| `--gray-700` | `#4E4E57` |
| `--gray-800` | `#34343B` |
| `--gray-900` | `#1F1F24` |
| `--gray-950` | `#141417` |
| `--gray-1000` | `#0A0A0B` |

Accent (blue) scale — used sparingly for links, selection, focus, active nav:

| Token | Hex |
| --- | --- |
| `--blue-300` | `#9DBBFF` |
| `--blue-400` | `#6E9BFF` |
| `--blue-500` | `#2F6FEB` |
| `--blue-600` | `#2357C4` |
| `--blue-700` | `#1B449B` |

Functional scales:

| Token | Hex | Token | Hex |
| --- | --- | --- | --- |
| `--green-500` | `#1F9D6B` | `--green-600` | `#178055` |
| `--amber-500` | `#C77D1A` | `--amber-600` | `#A56412` |
| `--red-500` | `#D6453D` | `--red-600` | `#B5332C` |

### 2.2 Semantic tokens — light theme

| Semantic token | Maps to | Use |
| --- | --- | --- |
| `--color-bg` | `--gray-0` `#FFFFFF` | App background, chat canvas. |
| `--color-surface-1` | `--gray-50` `#F4F4F5` | Sidebar, sheets, cards. |
| `--color-surface-2` | `--gray-100` `#ECECEF` | Inset fields, code blocks, hover fills. |
| `--color-surface-3` | `--gray-200` `#E1E1E6` | Pressed fills, dividers-as-fill. |
| `--color-user-bubble` | `--gray-100` `#ECECEF` | User message bubble. |
| `--color-border` | `#E1E1E6` | Hairlines, input borders (1px). |
| `--color-border-strong` | `--gray-300` `#CDCDD4` | Emphasized borders. |
| `--color-text-primary` | `--gray-950` `#141417` | Body text, titles. |
| `--color-text-secondary` | `--gray-600` `#6A6A73` | Subtitles, metadata. |
| `--color-text-tertiary` | `--gray-400` `#A8A8B3` | Placeholders, disabled labels. |
| `--color-text-on-accent` | `#FFFFFF` | Text on accent/primary fills. |
| `--color-accent` | `--blue-500` `#2F6FEB` | Links, selection, active nav, focus. |
| `--color-accent-hover` | `--blue-600` `#2357C4` | Accent hover. |
| `--color-primary` | `--gray-950` `#141417` | Primary action fill (send/CTA). |
| `--color-primary-hover` | `--gray-800` `#34343B` | Primary hover. |
| `--color-primary-text` | `#FFFFFF` | Text/icon on primary fill. |
| `--color-success` | `--green-500` | Success status. |
| `--color-warning` | `--amber-500` | Warning status. |
| `--color-danger` | `--red-500` | Destructive / error. |
| `--color-danger-hover` | `--red-600` | Destructive hover. |
| `--color-scrim` | `rgba(0,0,0,0.40)` | Modal/drawer backdrop. |
| `--color-focus-ring` | `rgba(47,111,235,0.45)` | Focus ring. |
| `--color-code-bg` | `--gray-100` `#ECECEF` | Code block background. |
| `--color-skeleton` | `--gray-100` | Skeleton base. |
| `--color-skeleton-shine` | `--gray-50` | Skeleton shimmer. |

### 2.3 Semantic tokens — dark theme

| Semantic token | Maps to | Use |
| --- | --- | --- |
| `--color-bg` | `#0E0E10` | App background, chat canvas. |
| `--color-surface-1` | `#1A1A1D` | Sidebar, sheets, cards. |
| `--color-surface-2` | `#242428` | Inset fields, code blocks, hover fills. |
| `--color-surface-3` | `#2F2F34` | Pressed fills. |
| `--color-user-bubble` | `#2A2A30` | User message bubble. |
| `--color-border` | `rgba(255,255,255,0.10)` | Hairlines, input borders. |
| `--color-border-strong` | `rgba(255,255,255,0.18)` | Emphasized borders. |
| `--color-text-primary` | `#F5F5F6` | Body text, titles. |
| `--color-text-secondary` | `#B4B4BD` | Subtitles, metadata. |
| `--color-text-tertiary` | `#7E7E89` | Placeholders, disabled labels. |
| `--color-text-on-accent` | `#FFFFFF` | Text on accent fills. |
| `--color-accent` | `--blue-400` `#6E9BFF` | Links, selection, active nav, focus. |
| `--color-accent-hover` | `--blue-300` `#9DBBFF` | Accent hover. |
| `--color-primary` | `#FFFFFF` | Primary action fill (send/CTA). |
| `--color-primary-hover` | `#ECECEF` | Primary hover. |
| `--color-primary-text` | `#141417` | Text/icon on primary fill. |
| `--color-success` | `#36C088` | Success status. |
| `--color-warning` | `#E0A04A` | Warning status. |
| `--color-danger` | `#F2675F` | Destructive / error. |
| `--color-danger-hover` | `#F58A84` | Destructive hover. |
| `--color-scrim` | `rgba(0,0,0,0.60)` | Modal/drawer backdrop. |
| `--color-focus-ring` | `rgba(110,155,255,0.55)` | Focus ring. |
| `--color-code-bg` | `#161619` | Code block background. |
| `--color-skeleton` | `#242428` | Skeleton base. |
| `--color-skeleton-shine` | `#2F2F34` | Skeleton shimmer. |

### 2.4 Contrast guarantees

- `--color-text-primary` on `--color-bg`: ≥ 15:1 (light), ≥ 16:1 (dark).
- `--color-text-secondary` on `--color-bg`: ≥ 4.6:1 both themes.
- `--color-text-on-accent` on `--color-accent`: ≥ 4.5:1.
- `--color-primary-text` on `--color-primary`: ≥ 12:1.
- Never communicate state by color alone (pair with icon/label).

---

## 3. Typography

### 3.1 Font families

```
--font-sans: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto,
             "Helvetica Neue", Arial, sans-serif;
--font-mono: ui-monospace, "SF Mono", "Cascadia Code", "Roboto Mono",
             Menlo, Consolas, monospace;
```

System stack gives the native feel and zero web-font load cost. (A licensed brand font
may replace `--font-sans` later without touching components.)

### 3.2 Type scale

Sizes in `rem` (root = 16px). Each role defines size / line-height / weight / tracking.

| Token (role) | Size | Line-height | Weight | Tracking | Usage |
| --- | --- | --- | --- | --- | --- |
| `display` | 1.75rem / 28px | 34px | 600 | -0.01em | Empty-state greeting, splash. |
| `title-1` | 1.375rem / 22px | 28px | 600 | -0.01em | Screen titles. |
| `title-2` | 1.25rem / 20px | 26px | 600 | -0.005em | Section headers, dialog titles. |
| `title-3` | 1.0625rem / 17px | 24px | 600 | 0 | List section headers, card titles. |
| `body-lg` | 1.0625rem / 17px | 26px | 400 | 0 | **Chat message text.** |
| `body` | 0.9375rem / 15px | 22px | 400 | 0 | Default UI text, settings rows. |
| `callout` | 0.875rem / 14px | 20px | 400 | 0 | Secondary UI, helper text. |
| `caption` | 0.8125rem / 13px | 18px | 400 | 0 | Metadata, captions. |
| `label` | 0.6875rem / 11px | 14px | 600 | 0.04em | Overlines, badges, group headers (uppercase). |
| `code` | 0.84375rem / 13.5px | 20px | 400 | 0 | Code blocks/inline (mono). |

- **Weights available:** 400 (regular), 500 (medium), 600 (semibold). No 700+ in UI
  chrome.
- **Dynamic type:** the root font-size follows the user's text-size setting
  (Settings → Appearance) via a multiplier (0.9 / 1.0 / 1.1 / 1.25); all rem values
  scale together.
- **Markdown heading map** (assistant content): `# → title-1`, `## → title-2`,
  `### → title-3`, `#### → body-lg semibold`; body copy is `body-lg`.

---

## 4. Spacing

4px base grid. Use these only.

| Token | px | Common use |
| --- | --- | --- |
| `--space-0` | 0 | Reset. |
| `--space-1` | 2 | Hairline gaps, icon nudges. |
| `--space-2` | 4 | Tight inline gaps. |
| `--space-3` | 8 | Chip padding, small gaps. |
| `--space-4` | 12 | Control inner padding, list row gap. |
| `--space-5` | 16 | **Default gutter**, card padding, side margins. |
| `--space-6` | 20 | Comfortable padding. |
| `--space-7` | 24 | Section spacing. |
| `--space-8` | 32 | Block spacing. |
| `--space-9` | 40 | Large section spacing. |
| `--space-10` | 48 | Hero spacing. |
| `--space-12` | 64 | Top/bottom of empty states. |

Message rhythm: 24px (`--space-7`) between message groups, 8px (`--space-3`) between
consecutive bubbles from the same role.

---

## 5. Sizing

| Token | px | Use |
| --- | --- | --- |
| `--size-appbar` | 56 (compact) / 60 (expanded) | App bar height. |
| `--size-sidebar` | 300 | Expanded sidebar width. |
| `--size-sidebar-collapsed` | 72 | Icon-rail sidebar. |
| `--size-column-max` | 768 | Reading column max width. |
| `--size-control-sm` | 32 | Small buttons/inputs. |
| `--size-control-md` | 40 | Default buttons/inputs. |
| `--size-control-lg` | 48 | Large/primary CTAs, composer send. |
| `--size-touch-min` | 44 | Minimum touch target. |
| `--size-composer-min` | 56 | Composer collapsed height. |
| `--size-avatar-sm` | 28 | List avatars. |
| `--size-avatar-md` | 36 | Account avatar. |
| `--size-avatar-lg` | 64 | Profile header. |
| `--icon-16` / `--icon-20` / `--icon-24` / `--icon-28` / `--icon-32` | 16/20/24/28/32 | Icon sizes. Default UI icon = 24. |
| `--size-orb` | 220 | Voice-mode orb diameter (compact). |

---

## 6. Radii

| Token | px | Use |
| --- | --- | --- |
| `--radius-xs` | 4 | Tags, tiny chips. |
| `--radius-sm` | 8 | Inputs, small buttons, code inline. |
| `--radius-md` | 12 | Buttons, cards, menus. |
| `--radius-lg` | 16 | Message bubbles, sheets, image cards. |
| `--radius-xl` | 20 | Large cards, composer container. |
| `--radius-2xl` | 28 | Modal corners (top), hero. |
| `--radius-pill` | 999 | Pills, chips, FAB, avatars. |

Message bubble: `--radius-lg` (16px) with a 4px "tail" corner on the sender side
(user = bottom-right reduced to `--radius-xs`).

---

## 7. Borders

| Token | Value |
| --- | --- |
| `--border-hairline` | `1px solid var(--color-border)` |
| `--border-strong` | `1px solid var(--color-border-strong)` |
| `--border-focus` | `2px solid var(--color-accent)` |
| `--border-input` | `1px solid var(--color-border)` (→ `--color-accent` on focus) |

All hairlines render at device-pixel crispness; on ≥2x displays use the platform hairline
where available.

---

## 8. Elevation (shadows)

Light theme uses soft shadows; dark theme leans on borders + faint shadow.

| Token | Light value | Dark value | Use |
| --- | --- | --- | --- |
| `--elevation-0` | none | none | Flat. |
| `--elevation-1` | `0 1px 2px rgba(0,0,0,.06), 0 1px 3px rgba(0,0,0,.10)` | `0 1px 2px rgba(0,0,0,.40)` | Cards, raised buttons. |
| `--elevation-2` | `0 4px 12px rgba(0,0,0,.12)` | `0 4px 14px rgba(0,0,0,.50)` | Menus, popovers, tooltips. |
| `--elevation-3` | `0 12px 32px rgba(0,0,0,.18)` | `0 16px 40px rgba(0,0,0,.60)` | Modals, sheets, drawer. |
| `--elevation-appbar` | `0 1px 0 var(--color-border)` + 8px backdrop blur when scrolled | same | Sticky app bar separation. |

---

## 9. Motion

| Token | Value | Use |
| --- | --- | --- |
| `--motion-instant` | 0ms | Reduced-motion fallback. |
| `--motion-fast` | 120ms | Hover/press, small fades. |
| `--motion-base` | 200ms | Default transitions, menu open. |
| `--motion-slow` | 320ms | Drawer, sheet, modal present. |
| `--motion-slower` | 480ms | Full-screen transitions, voice-mode enter. |
| `--ease-standard` | `cubic-bezier(0.2, 0, 0, 1)` | Most transitions. |
| `--ease-decelerate` | `cubic-bezier(0, 0, 0, 1)` | Entering elements. |
| `--ease-accelerate` | `cubic-bezier(0.3, 0, 1, 1)` | Exiting elements. |
| `--ease-spring` | `cubic-bezier(0.22, 1, 0.36, 1)` | Drawer/sheet drag-release. |

Under `prefers-reduced-motion: reduce`, all durations collapse to `--motion-instant` or
opacity-only fades (≤ `--motion-fast`); no translate/scale. Full choreography in
[06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md).

---

## 10. Z-index layers

| Token | Value | Layer |
| --- | --- | --- |
| `--z-base` | 0 | Content. |
| `--z-appbar` | 100 | Sticky app bar. |
| `--z-jump-pill` | 150 | Jump-to-latest pill. |
| `--z-drawer-scrim` | 200 | Drawer backdrop. |
| `--z-drawer` | 210 | History drawer. |
| `--z-sheet-scrim` | 300 | Bottom-sheet backdrop. |
| `--z-sheet` | 310 | Bottom sheet / action sheet. |
| `--z-modal-scrim` | 400 | Modal/dialog backdrop. |
| `--z-modal` | 410 | Dialog / Settings / Image viewer. |
| `--z-voice` | 450 | Full-screen voice mode. |
| `--z-toast` | 500 | Toasts / banners. |
| `--z-tooltip` | 600 | Tooltips / popover hints. |

---

## 11. Breakpoints

| Token | Range | Layout |
| --- | --- | --- |
| `--bp-compact` | 0–599px | Single column, overlay drawer, bottom composer. |
| `--bp-medium` | 600–1023px | Single column, wider reading area, drawer may pin (landscape). |
| `--bp-expanded` | ≥ 1024px | Persistent 300px sidebar, dialogs instead of sheets. |

Container query fallback: components also respond to their own width where supported, so
the chat column adapts inside the expanded pane.

---

## 12. Opacity & misc

| Token | Value | Use |
| --- | --- | --- |
| `--opacity-disabled` | 0.40 | Disabled controls. |
| `--opacity-muted` | 0.64 | De-emphasized icons. |
| `--opacity-scrim-press` | 0.08 | Press overlay on neutral surfaces. |
| `--blur-appbar` | 8px | App-bar backdrop blur when scrolled. |
| `--blur-scrim` | 2px | Optional backdrop blur behind modals. |

---

## 13. Focus ring (exact spec)

```
:focus-visible {
  outline: none;
  box-shadow: 0 0 0 2px var(--color-bg), 0 0 0 4px var(--color-focus-ring);
  border-radius: inherit;
}
```

- 2px gap ring in the background color + 2px accent ring = a clear halo on any surface.
- Applied via `:focus-visible` only (no ring on mouse/touch press).
- Within dark surfaces, the inner gap uses the local surface color, not always `--bg`.

---

## 14. Implementation notes

- Ship tokens as `tokens.css` (`:root` + `[data-theme="dark"]`) and a generated
  `tokens.ts` (typed object) so logic (e.g. canvas voice-orb colors) reads the same
  source of truth.
- `data-theme` is set on `<html>` from the user's Appearance choice; `system` reads
  `prefers-color-scheme` and updates live.
- No component may introduce a color, size, radius, shadow, or duration outside these
  tokens. New needs are added here first (single source of truth).
