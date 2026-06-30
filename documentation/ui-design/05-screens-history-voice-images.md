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

- **Purpose:** speech-to-text that drops a transcript into the composer field. It is a *compose
  aid* only — it never sends and never starts a run. Distinct from Voice mode (V-15). Behaves like
  ChatGPT's composer mic.
- **Trigger:** composer 🎙 IconButton, shown whenever a transcription model is configured. First
  tap requests mic permission (first ever → V-05 priming sheet); a denied mic shows an inline hint
  and a route to V-05.
- **Recording bar (replaces the input row while active):**

```
┌───────────────────────────────────────┐
│  ＋  ‹∿∿∿ live waveform ∿∿∿›      ■ Stop │  field replaced by waveform + interim text
│      "going to paris next…"             │  interim transcript (italic, secondary)
└───────────────────────────────────────┘
```

- **Components:** IconButton (mic), WaveformVisualizer (B14, amplitude-reactive from the live mic
  analyser), elapsed timer, Cancel and Accept controls, optional interim-text line.
- **State machine:**

| State | UI | Notes |
| --- | --- | --- |
| `idle` | mic glyph in the composer | tap → `requesting` |
| `requesting` | mic glyph + spinner | OS permission prompt; denied → `denied` |
| `recording` | recording bar: waveform + timer + Cancel + Accept | mic capturing; waveform tracks amplitude |
| `transcribing` | bar dims, spinner on Accept | batch transcription after Accept |
| `inserted` | back to composer, caret after inserted text | final transcript merged into the field |
| `denied` | inline hint + "Enable mic" → V-05 | |
| `error` | toast; composer restored with prior text intact | retry available |

- **Behavior (ChatGPT-parity):**
  - **Accept** stops capture, transcribes the full clip via `gpt-4o-transcribe`, and **inserts the
    text at the caret** inside whatever the user already typed — it never clobbers or reorders
    existing text. Mid-word carets get sensible spacing.
  - **Cancel** discards the clip and restores the prior field value untouched.
  - **Never auto-sends.** The user reviews/edits, then sends with the normal primary button.
  - **Optional silence auto-stop** (Settings → Voice → *Auto-stop on silence*, default off) ends
    capture and behaves like Accept, so dictation stays manual like ChatGPT unless opted in.
  - **Interim text (best-effort):** show a live partial transcript under the waveform when the
    provider streams one; otherwise show "Listening…". Final text always replaces interim.
  - **Long clips:** soft cap ~10 min with a warning near the limit.
- **Persistence:** none server-side — dictation only mutates local composer text (and the per-thread
  draft).
- **Accessibility:** the bar is a live region announcing `recording`/`transcribing`; Cancel/Accept
  are keyboard-reachable; reduced motion swaps the waveform for a static level meter.
- **Acceptance:** real `gpt-4o-transcribe`; amplitude waveform + timer; **caret-safe insertion** into
  existing text; Cancel restores prior text; never sends; permission/denial/error paths handled.

---

## V-15 — Voice mode (full screen)

- **Purpose:** hands-free, continuous spoken conversation — the flagship "talk to Watai" surface,
  modeled on ChatGPT's Voice mode. **Every spoken turn runs through the exact same
  server-authoritative agentic run as text chat** (`POST /runs`), so voice has full parity: memory
  (retrieval + extraction), tools (web search, code interpreter, file search, image), skills,
  streaming, sync, and persistence. Voice is a *front-end on the normal run*, never a separate
  model call.
- **Entry:** the composer's empty-state primary control (voice-mode glyph) and `/voice/:threadId?`.
  Opens over the active thread so the conversation continues in text on exit.
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

- **Layout:** full-window overlay (`--z-voice`), `--color-bg`; amplitude-reactive orb centered
  (`--size-orb`, 220 compact / larger expanded); caption line + optional tool-status chip below;
  control row pinned bottom above the safe area; top row close (✕) + captions (CC) + settings (⚙).
- **Components:** VoiceOrb (B15, amplitude-driven), caption live region, tool-status chip,
  IconButtons (mute / keyboard / end / close / captions / settings).
- **Hands-free loop (continuous, VAD-driven — no taps):**
  1. **Listen.** Mic open; client VAD tracks amplitude; the orb reacts to the user's voice.
  2. **Endpoint.** On end-of-speech (trailing silence ≈ Settings → Voice → *Mic sensitivity*),
     capture stops automatically and the turn submits. A tap on the orb is a manual endpoint for
     noisy rooms / push-to-talk.
  3. **Transcribe.** `gpt-4o-transcribe` → the user-turn text.
  4. **Run.** Submit it as a normal user message + **`POST /runs`** on the thread — the same path
     text chat uses. The worker generates with memory + tools + skills and streams over SignalR.
  5. **Speak as it streams.** As the streamed reply completes **sentence by sentence**, synthesize
     each sentence with TTS (selected voice + rate) and play them back-to-back, so speech starts ~1
     sentence after the first token instead of waiting for the whole reply.
  6. **Loop.** When playback drains and the run is complete, return to **Listen** automatically.
- **Barge-in (interrupt) — the most important "feels alive" behavior:** if the mic detects the user
  speaking during `speaking`, **duck then stop TTS within <150 ms**, drop queued sentences, cancel
  the in-flight run (`DELETE /threads/:id/runs/:id`), and switch to `listening` so the new turn is
  next.
- **Tool turns:** when the run invokes a tool, the orb shows `working` and a status chip
  ("Searching the web…", "Running code…", "Creating an image…"); the spoken reply summarizes the
  result. Generated images land in the thread (seen on exit), not read out byte-by-byte.
- **Machine states (orb + caption + audio):**

| State | Orb | Caption | Mic | TTS |
| --- | --- | --- | --- | --- |
| `connecting` | settle-in | "Starting…" | warming | — |
| `listening` | amplitude bloom (tracks user) | "Listening…" (live partial = Realtime, future) | open (VAD) | — |
| `thinking` | gentle rotating sweep | last user line | paused | — |
| `working` | sweep + tool chip | tool status | paused | — |
| `speaking` | pulse synced to playback | assistant text (sentence highlight) | monitoring for barge-in | playing |
| `muted` | dimmed ring | "Muted" | off | — |
| `error` | danger settle | error + Retry | — | — |
| `ended` | fade out | — | off | — |

- **Controls:**
  - **Mute** — actually gates the mic (stops VAD/endpointing), orb dims; tap to unmute. Not cosmetic.
  - **Keyboard** — exit to the thread with the composer focused (the conversation is already there).
  - **End (⏹)** — stop everything, persist, return to the thread.
  - **Captions (CC)** — show/hide live text; default from Settings → Voice → *Live captions* (on for
    a11y).
  - **Settings (⚙)** — quick access to voice / rate / mic-sensitivity (Settings → Voice).
- **Persistence & sync:** because each turn is a real run, user + assistant messages are written
  server-side, synced to every device, and fed to memory extraction — identical to text chat. There
  is no separate "voice persistence" path. (A retained audio attachment is optional, out of scope
  for v1.)
- **Settings honored (Settings → Voice):** voice selection, speaking rate, mic sensitivity (VAD
  endpoint), captions default, dictation auto-stop. These must be wired (today they are inert).
- **Latency targets:** end-of-speech → first spoken word ≤ ~1.5 s on a warm path (transcribe + first
  token + first-sentence TTS overlapped); barge-in → silence < 150 ms.
- **Fallbacks:** `mic-denied` → explain + V-05; `transcribe-unavailable` → can't run voice, offer
  dictation/text; `tts-unavailable` → keep the full loop but show text replies silently; `offline` /
  run error → ErrorState with Retry/End; a failed run settles the orb to `error` with the partial
  transcript preserved.
- **Reduced motion:** orb becomes a static disc with a textual state label; no pulsing/sweeps.
- **Responsive:** compact full-screen (mobile); centered overlay with a larger orb (desktop).
- **Acceptance:** continuous VAD loop with **no taps**; turns go through `POST /runs` (memory + tools
  + skills present — verify with a tool turn and a memory turn); **sentence-streamed** TTS;
  **barge-in** stops speech < 150 ms and starts a new turn; mute truly gates the mic; captions +
  keyboard + end work; voice / rate / sensitivity from Settings are applied; reduced-motion +
  denial + tts-down + error paths handled.

> **Realtime (Advanced Voice) — future.** A native speech-to-speech path via the Realtime API
> (server-minted ephemeral token, client socket) would cut latency and make barge-in native. It is a
> later enhancement; **v1 ships the STT → run → TTS loop above**, which already delivers ChatGPT's
> standard-voice experience while keeping full agentic parity.

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
