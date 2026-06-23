# 05 — Screens: History, Voice & Images

Build-ready specs for the History drawer/sidebar (V-11), Search (V-12), Thread menu
(V-13), Dictation (V-14), Voice mode (V-15), and the image surfaces (V-16–V-18).
Components from [02-components.md](02-components.md); tokens from
[01-design-tokens.md](01-design-tokens.md); motion from
[06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md).

---

## V-11 — History drawer / sidebar

- **Purpose:** browse, find, and manage conversations; entry to account/settings. Same
  content component renders as an **overlay drawer** (compact) and a **persistent sidebar**
  (expanded).
- **Wireframe:**

```
┌────────────────────────┐
│  ◆ Watai          ✎     │  header: brand + new-chat (✎)
│  ┌──────────────────┐   │
│  │ 🔍 Search         │   │  Search field → V-12
│  └──────────────────┘   │
│  ── PINNED ──           │  SectionHeader (if any)
│  📌 Project plan      ⋯ │  ConversationRow (pinned)
│  ── TODAY ──            │
│  • Trip to Kyoto      ⋯ │
│  • Recipe ideas       ⋯ │  ← selected: accent bar + surface-2
│  ── YESTERDAY ──        │
│  • Tax questions      ⋯ │
│  ── PREVIOUS 7 DAYS ──  │
│  • …                    │
│  ────────────────────   │
│  Archived             › │  footer entry
│  ┌──────────────────┐   │
│  │ ◎ Alex          ⚙ │   │  account row → Settings
│  └──────────────────┘   │
└────────────────────────┘
```

- **Layout:** header (brand + new-chat IconButton) 56; Search field (16 gutters);
  scrollable grouped list; sticky footer (Archived row + Account row → Settings). Width:
  compact min(86vw,360) overlay; expanded fixed 300 (collapsible to 72 icon-rail).
- **Grouping:** Pinned (top, if any), then recency buckets — Today, Yesterday, Previous 7
  Days, Previous 30 Days, then by month/year. Buckets are SectionHeaders (`label` type).
- **Components:** Drawer (C1) / sidebar container, TextField (search), SectionHeader (A22),
  ConversationRow (B3), ListRow (footer), Avatar, IconButton.
- **Row states:** default / hover / active / `selected` (current thread: surface-2 + 3px
  accent leading bar) / `renaming` (inline TextField) / swipe-revealed (compact) /
  long-press → Thread menu.
- **Row actions:**
  - Compact: swipe-left reveals Pin / Archive / Delete; long-press → Thread menu (V-13).
  - Desktop: hover reveals trailing `⋯` → Thread menu; right-click → context Menu.
- **States:** `loading` (row Skeletons), `empty` (EmptyState: "No conversations yet" +
  "Start a chat" CTA), `error` (ErrorState + Retry).
- **Behavior:** selecting a row navigates to `/c/:id`, closes the drawer (compact), keeps
  selection highlighted (expanded). New-chat (✎) → `/new` (V-06).
- **Acceptance:** grouping/sorting correct; pin/rename/archive/delete work with undo;
  selection state correct; overlay vs sidebar parity (one component).

---

## V-12 — Search

- **Purpose:** full-text search across thread titles + message content (client index,
  [../04-data-model.md](../04-data-model.md) §6).
- **Surface:** activating the Search field expands an overlay results panel within the
  drawer (compact full-height; expanded within sidebar or a popover).
- **Wireframe:**

```
┌────────────────────────┐
│  ←  🔍 kyoto temple   × │  search bar (back + clear)
│  ── RESULTS (3) ──      │
│  Trip to Kyoto          │  result group = thread title
│   …visit the **temple**…│  snippet w/ highlight (caption)
│  Travel ideas           │
│   …**Kyoto** in autumn… │
│  ────────────────────   │
│  Recent: kyoto, recipes │  recent searches (when empty query)
└────────────────────────┘
```

- **Layout:** search bar with back + live input + clear; results grouped by thread, each
  with a highlighted snippet (1–2 lines); empty query shows recent searches + (optional)
  quick filters (Has images / Voice / Date) as filter Chips.
- **Components:** TextField (search, leading magnifier, trailing clear), SectionHeader,
  result rows (ConversationRow-like with snippet), Chip (filters), EmptyState.
- **States:** `idle` (recents), `typing` (debounced 150ms), `results`, `empty` ("No
  results for ‘…’"), `loading` (brief skeleton for large indexes).
- **Behavior:** tap result → open thread scrolled to and briefly highlighting the matched
  message; matches highlight with an accent-tinted background; Esc/back closes search.
- **Acceptance:** live filtering with highlighted snippets; opening a result scrolls to
  the match; empty/recent states present; keyboard navigable (↑/↓/Enter).

---

## V-13 — Thread menu

- **Trigger:** row `⋯` / long-press / right-click; or AppBar `⋯` for the active thread.
- **Surface:** ActionSheet (compact) / Menu (desktop).
- **Items:** Rename (→ inline rename on the row/title), Pin/Unpin, Archive/Unarchive,
  Duplicate, Export (→ submenu: Markdown / JSON), Share (if enabled), **Clear messages**
  (keep thread, empty it — destructive confirm), **Delete** (destructive → Undo toast).
- **States:** standard; destructive rows danger-colored; disabled items hidden.
- **Acceptance:** every item works; rename is inline; delete/clear are confirmed/undoable;
  export produces a valid file.

---

## V-14 — Dictation (in composer)

- **Purpose:** speech-to-text into the composer field (distinct from Voice mode).
- **Trigger:** composer 🎙 IconButton (visible when transcribe is configured + mic
  permitted; first use triggers V-05 priming).
- **In-composer wireframe (active):**

```
┌───────────────────────────────────────┐
│  ＋  ‹∿∿∿ live waveform ∿∿∿›      ■ Stop │  field replaced by waveform + interim text
│      "going to paris next…"             │  interim transcript (italic, secondary)
└───────────────────────────────────────┘
```

- **Components:** IconButton (mic), WaveformVisualizer (B14), interim text, Stop control.
- **States:** `idle` (mic glyph), `requesting-permission`, `listening` (waveform + interim
  text + Stop; mic glyph → recording dot), `transcribing` (brief spinner after stop),
  `inserted` (final text placed at caret, editable), `denied` (tooltip + route to V-05),
  `error` (toast; keep any partial).
- **Behavior:** tap to start; VAD auto-stops on silence (sensitivity from Settings →
  Voice) or tap Stop; final transcript inserted at the caret without clobbering typed
  text; never auto-sends.
- **Acceptance:** real transcription via `gpt-4o-transcribe`; interim + final text;
  caret-safe insertion; permission and error paths handled.

---

## V-15 — Voice mode (full screen)

- **Purpose:** hands-free spoken conversation; the flagship "talk" surface. Writes turns
  back into the underlying thread.
- **Wireframe:**

```
┌───────────────────────────────────────┐
│  ✕                              CC  ⚙   │  close, captions toggle, voice settings
│                                        │
│                                        │
│                 ╭───────╮               │
│                (    ◉    )              │  VoiceOrb (state-reactive)
│                 ╰───────╯               │
│                                        │
│       "What's the weather like?"        │  live caption (latest transcript/response)
│                                        │
│                                        │
│   🔇 Mute        ⌨ Keyboard      ■ End │  controls
└───────────────────────────────────────┘
```

- **Layout:** full-window overlay (`--z-voice`), `--color-bg`; orb centered (`--size-orb`,
  220 compact / larger expanded); caption line below; control row pinned bottom above safe
  area; top row close (✕) + captions (CC) + settings (⚙).
- **Components:** VoiceOrb (B15), WaveformVisualizer (optional ring), caption live region,
  IconButtons (mute/keyboard/end/close/captions/settings).
- **Machine states (orb + status):**

| State | Orb | Caption | Audio |
| --- | --- | --- | --- |
| `connecting` | settle-in | "Starting…" | — |
| `listening` | amplitude ring | interim transcript | mic on |
| `thinking` | rotating sweep | last user line | mic paused |
| `speaking` | pulse w/ playback | assistant text (karaoke optional) | TTS playing |
| `paused`/`muted` | dimmed | "Muted" | mic off |
| `error` | danger tint settle | error message | — |
| `ended` | fade out | — | — |

- **Loop (TTS path, default per [../03-api-integration.md](../03-api-integration.md) §5):**
  capture (VAD) → `gpt-4o-transcribe` → `gpt-5.4` (stream) → TTS playback → back to
  listening. Each completed turn is written to the thread as user/assistant messages (so
  it continues in text after exit).
- **Barge-in:** if mic detects speech during `speaking`, duck/stop playback and return to
  `listening` (approximate on TTS path; native on Realtime path if adopted).
- **Controls:** Mute (mic), Keyboard (switch to text — exits to thread with composer
  focused), End (exit). Captions toggle shows/hides the live text (default on for a11y).
- **States/fallbacks:** `mic-denied` → explain + route to V-05; `tts-unavailable` →
  read-aloud disabled, still transcribes + shows text replies; `offline`/AI error →
  ErrorState with Retry/End.
- **Reduced motion:** orb becomes static with a textual state label; no pulsing.
- **Responsive:** compact full-screen; expanded centered overlay (orb larger, controls
  centered).
- **Acceptance:** full spoken loop works; turns persist to the thread; captions present;
  mute/keyboard/end function; reduced-motion + denial + error paths handled; orb reflects
  each machine state.

---

## V-16 — Inline image in chat

- **Surface:** ImageCard (B11) inside an assistant message.
- **States:** `generating` (skeleton + shimmer + "Creating image…" + optional progress),
  `complete` (image, intrinsic aspect, max-width=column, `--radius-lg`), `error`
  (InlineAlert + Retry), `multiple` (n>1 → 2-up grid; tap expands all in viewer).
- **Quick actions:** long-press/hover → Save, Variations, More (→ V-17 actions). Tap →
  Image viewer (V-17). Optional caption row: truncated prompt + ⋯.
- **Acceptance:** generation states render; tap opens viewer; quick actions work; grid for
  multiple.

---

## V-17 — Image viewer (lightbox)

- **Purpose:** focus, inspect, and act on a generated image.
- **Wireframe:**

```
┌───────────────────────────────────────┐
│  ✕                               ⋯      │  close + overflow
│                                        │
│            ┌───────────────┐            │
│            │               │            │  image, zoom/pan, fit-to-screen
│            │     image     │            │
│            │               │            │
│            └───────────────┘            │
│   "A red fox in an autumn forest"       │  prompt (expandable) + meta (size · time)
│                                        │
│  ⤓ Save   ⟳ Variations   ✎ Edit   ⤴ Share│  action bar
└───────────────────────────────────────┘
```

- **Layout:** full-screen modal (`--z-modal`), dark scrim; image centered with pinch/
  double-tap/scroll-wheel zoom + pan; provenance row (prompt expandable, size, timestamp);
  bottom action bar.
- **Components:** Modal/Dialog (C2), image canvas, Button/IconButton row, expandable text.
- **Actions:** Save/Download, Variations (regenerate alternates), Edit (prompt-based /
  inpainting if capability-supported — opens an edit affordance: prompt field + optional
  mask brush), Share, "Use as input" (feed into a new generation/edit), Copy prompt,
  Delete.
- **States:** `loading`, `loaded`, `zoomed`, `editing` (mask/prompt UI), `generating`
  (variation/edit in progress overlay), `error`.
- **Gestures:** swipe-down to dismiss; left/right swipe to move between images in the same
  message/gallery; double-tap zoom toggle.
- **Capability gating:** Edit/Variations hidden if `gpt-image-2` lacks edit support per the
  capability matrix.
- **Acceptance:** zoom/pan/swipe work; save/variations/edit (when supported) function;
  provenance shown; dismiss returns to exact prior scroll position.

---

## V-18 — Image gallery (per thread)

- **Purpose:** all images generated within a thread (and optionally a global gallery in
  Data controls).
- **Entry:** Thread menu or an "Images (n)" affordance when a thread has images.
- **Wireframe:** AppBar (back + title "Images") over a responsive grid (2 cols compact, 3–4
  expanded), 4px gaps, square-cropped thumbnails; tap → V-17 (positioned to that image).
- **States:** `loading` (grid Skeletons), `empty` (EmptyState: "No images yet"),
  `loaded`.
- **Acceptance:** grid renders thumbnails; tapping opens the viewer at the right image;
  empty/loading states present.

---

## Section acceptance summary

1. History: one component renders as overlay drawer (compact) and persistent sidebar
   (expanded); grouping, selection, pin/rename/archive/delete + undo all correct.
2. Search: live, highlighted, opens to the matched message; recents + empty states.
3. Thread menu: all actions including export and destructive confirms.
4. Dictation: real STT into composer, caret-safe, VAD auto-stop, permission/error paths.
5. Voice mode: full spoken loop persisted to the thread, orb states, captions, controls,
   reduced-motion + fallbacks.
6. Images: inline generation states, viewer (zoom/pan/swipe/actions, capability-gated
   edit), and per-thread gallery.
