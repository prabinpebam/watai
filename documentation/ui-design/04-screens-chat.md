# 04 — Screens: Chat

The core of the app. Build-ready specs for the chat home (empty + active), message
rendering, the composer, message actions, the model selector, attachments, and all
global states. Components from [02-components.md](02-components.md); tokens from
[01-design-tokens.md](01-design-tokens.md); motion from
[06-interaction-motion-accessibility.md](06-interaction-motion-accessibility.md);
copy from [07-content-and-assets.md](07-content-and-assets.md).

---

## V-06 — Chat home: empty state (new thread)

- **Purpose:** the landing surface for a new conversation; invites first input.
- **Wireframe (compact):**

```
┌───────────────────────────────────────┐
│  ☰      Watai 5.4 ▾            ＋   ⋯   │  AppBar
├───────────────────────────────────────┤
│                                        │
│                  ◆                      │  brand glyph (48)
│          How can I help?                │  display, centered
│                                        │
│   ┌─────────────┐ ┌──────────────────┐  │
│   │ Summarize a │ │ Brainstorm names │  │  SuggestionChips (wrap, 2 rows)
│   └─────────────┘ └──────────────────┘  │
│   ┌──────────────┐ ┌────────────────┐   │
│   │ Create an    │ │ Explain a       │   │
│   │ image of…    │ │ concept         │   │
│   └──────────────┘ └────────────────┘   │
│                                        │
├───────────────────────────────────────┤
│  ＋   Message Watai…           🎙   ▶   │  Composer (empty → voice glyph)
└───────────────────────────────────────┘
```

- **Layout:** content vertically centered in the scroll region; brand glyph 48 + 16 gap +
  `display` headline; suggestion chips in a centered flex-wrap (max 6), 8px gaps,
  max-width = column; primary button in composer shows the **voice** glyph because the
  field is empty.
- **Components:** AppBar, ModelSelector (V-09), SuggestionChip (A11), Composer (B12),
  EmptyState (B18) layout.
- **States:**
  - `default` — chips shown (if enabled in Personalization).
  - `chips-hidden` — headline only (user disabled starters).
  - `unconfigured` — if no valid chat model, headline becomes a setup nudge with a
    "Connect your AI" Button → V-04; composer disabled.
  - `temporary` — when temporary chat is on, a small "Temporary chat" InlineAlert sits
    above the composer and the AppBar shows the Temp badge.
- **Behavior:** tapping a chip fills the composer with that prompt text (editable, not
  auto-sent); focusing the field hides the keyboard-occluded chips on compact; first send
  transitions to V-07, requests a title, and animates the user bubble in.
- **Responsive:** expanded centers the same block within the main pane; chips can show 3
  per row.
- **Acceptance:** chips populate the composer; first message creates a titled thread and
  transitions without a jarring jump; unconfigured state routes to setup.

---

## V-07 — Chat home: active thread

- **Purpose:** the live conversation.
- **Wireframe (compact, mid-stream):**

```
┌───────────────────────────────────────┐
│  ☰      Watai 5.4 ▾            ＋   ⋯   │
├───────────────────────────────────────┤
│ ┌───────────────────────────────────┐ │
│ │ Assistant message, full width,     │ │
│ │ markdown + code block…             │ │
│ │   ```js  [copy]                     │ │
│ │   const x = 1;                      │ │
│ │   ```                               │ │
│ │ ▍ (streaming caret)                 │ │
│ └───────────────────────────────────┘ │
│                      ┌──────────────┐  │
│                      │ user message │  │  user bubble (right)
│                      └──────────────┘  │
│                                        │
│                            ╭───────╮    │
│                            │ ↓ New │    │  JumpToLatest (if scrolled up)
│                            ╰───────╯    │
├───────────────────────────────────────┤
│  ＋  Message Watai…            🎙   ■   │  Composer (streaming → stop)
└───────────────────────────────────────┘
```

- **Layout:** virtualized scroll list of MessageGroups (B4); 24px between groups, 8px
  within; messages constrained to the 768 column, centered; 16px side gutters compact.
- **Components:** MessageGroup, UserMessage (B5), AssistantMessage (B6), CodeBlock (B8),
  TableBlock (B9), MathBlock (B10), ImageCard (B11), TypingIndicator (B17),
  JumpToLatestPill (B16), Composer (B12).
- **Scroll/stick behavior:** auto-stick to bottom while streaming **unless** the user
  scrolled up; then show JumpToLatestPill and stop auto-scroll. New user send always
  scrolls to bottom.
- **Message lifecycle states (assistant):** `pending` (TypingIndicator until first token)
  → `streaming` (text appends + caret; composer shows Stop) → `complete` (action bar
  available) → optional `interrupted`/`error` (see B6).
- **Message lifecycle states (user):** `sending` → `sent`; `failed` → inline Retry.
- **AppBar overflow (⋯):** opens Thread menu (V-13).
- **Responsive:** expanded shows the sidebar; column stays 768 centered in the pane.
- **Acceptance:** streaming renders smoothly without layout thrash; stop preserves
  partial; scroll-stick logic matches spec; all content types render.

### V-07.1 — Message rendering details

**User message (B5):**
- Right-aligned bubble, `--color-user-bubble`, `body-lg`, `--radius-lg` (tail
  bottom-right), max-width min(75%, column). Selectable. Attachments as a thumbnail row
  above text (each tappable → viewer). Timestamp hidden; revealed on tap (caption,
  secondary, below bubble).

**Assistant message (B6 + MarkdownRenderer B7):**
- Full-width, no bubble. Rendering map per [02-components.md](02-components.md) B7.
- **Action bar** (appears on hover desktop / always-visible compact below the message):
  `[ Copy · Regenerate · Read aloud · 👍 · 👎 · ⋯ ]` as ghost IconButtons (24). `⋯` opens
  the full action sheet (V-08). During streaming the bar is hidden.
- **Model badge:** if the message's model ≠ the thread's current selection, a small
  `label` badge (e.g., "5.4") shows after the action bar.

**Code block (B8):** language label + Copy in a header; highlighted; wrap toggle; long
lines scroll-x; "Copied" feedback.

**Tables (B9):** horizontal scroll with edge fade on overflow.

**Math (B10):** inline/block KaTeX; failure → raw LaTeX in inline code.

**Links:** accent color, new tab, `rel=noopener noreferrer`; long URLs truncate.

**Inline images (B11):** generated images render as cards → V-17 viewer.

### V-07.2 — Composer (full behavior)

- **Container:** `--radius-xl`, surface-1, `--border-hairline`, min-height 56, bottom-
  anchored above safe area; max growth 40% viewport then internal scroll.
- **Left:** ＋ attach IconButton (24) → Attachments picker (V-10). Hidden if the active
  chat model lacks vision (per capability matrix) — or shown but warns on attach.
- **Field:** auto-grow Textarea (A4); placeholder "Message Watai"; multiline; draft
  persisted per thread.
- **Right cluster:** 🎙 dictation IconButton (always, if transcribe configured) + primary
  morphing button:
  - empty → **voice** (accent IconButton) → opens Voice mode (V-15).
  - has text → **send** (contained-primary, up-arrow); Enter sends (desktop),
    Shift+Enter newline; mobile send via button.
  - streaming → **stop** (filled square) → aborts stream, keeps partial.
- **Dictation sub-state (V-14):** field shows live (interim) transcript + a waveform strip
  + a Stop control; on stop, final transcript stays editable in the field.
- **Attachment sub-state:** AttachmentChip row above the field (horizontal scroll);
  each removable; send includes them as vision parts.
- **Disabled sub-state:** offline or unconfigured → field muted, placeholder explains
  ("You're offline" / "Connect your AI to start"), send hidden.
- **Editing-from sub-state:** when editing a prior user message (fork), the composer shows
  an "Editing message" hint chip with Cancel; sending creates a branch.
- **Keyboard-aware (mobile):** the composer stays pinned **above** the on-screen keyboard
  using `interactive-widget=resizes-content` + the `visualViewport`/`--keyboard-inset`
  strategy; on focus, the field + latest message scroll into view; no layout jump when the
  browser address bar shows/hides. The field font-size is ≥ 16px to prevent iOS focus-zoom.
  (See [09-responsive-and-platform.md](09-responsive-and-platform.md) §4.)
- **Desktop input (drag-drop + paste):** dragging image files over the chat/composer shows
  a "Drop to attach" overlay and attaches valid images on drop; pasting an image from the
  clipboard attaches it. Same validation as the picker (V-10).
- **Acceptance:** morph logic exact; Enter/Shift+Enter correct on desktop; drafts persist;
  dictation and attachments integrate; disabled states explain themselves; composer stays
  above the mobile keyboard; desktop drag-drop/paste attach images.

---

## V-08 — Message action sheet

- **Trigger:** long-press a message (compact) / `⋯` in the action bar or right-click
  (desktop).
- **Surface:** ActionSheet (C4) compact / Menu (C5) desktop, anchored to the message.
- **Items (assistant):** Copy, Copy as markdown, Regenerate (→ submenu: same / change
  reasoning_effort / change model), Read aloud, Good response, Bad response (→ optional
  note field), Share/Export, Select text, Delete (destructive, with Undo toast).
- **Items (user):** Copy, Edit & resend (→ enters composer editing-from), Delete.
- **States:** standard sheet/menu states; destructive rows in danger color.
- **Acceptance:** each action performs its function; Regenerate submenu applies overrides;
  delete is undoable.

---

## V-09 — Model selector

- **Trigger:** the AppBar center label (B2).
- **Surface:** Menu (desktop) / BottomSheet (compact) titled "Model".
- **Rows:** each configured chat model: `[ name · subtitle (reasoning_effort) · ✓ ]`; the
  active one checkmarked. Footer: "Manage models" → Settings → Models (V-21).
- **States:** `default`, `unconfigured` (single row "Set up a model" → V-04),
  `error` (active model row shows a small danger dot if last call was unauthorized).
- **Behavior:** selecting sets the thread's active model (persisted on the thread);
  affects subsequent sends only.
- **Acceptance:** selection persists per thread and is reflected in the AppBar; manage
  link navigates.

---

## V-10 — Attachments picker

- **Trigger:** composer ＋.
- **Surface:** ActionSheet (compact) / Menu (desktop) with: Photo library, Take photo
  (camera), Choose file.
- **Behavior:** selected items become AttachmentChips in the composer; validate type
  (image/* for vision; others rejected with a toast) and size (cap, e.g., 20MB, with a
  clear error); if the active chat model lacks vision, show a warning InlineAlert offering
  to proceed (image dropped) or open Models.
- **States:** `picking`, `processing` (thumbnail generating), `rejected` (toast/inline).
- **Acceptance:** valid images attach and send as vision parts; unsupported types/sizes
  are rejected with clear messaging; capability gating works.

---

## V-27 — Global states

These overlay or inline across chat (and the app).

### Offline
- A top InlineAlert/banner under the AppBar: "You're offline. You can read past chats."
  Composer AI actions disabled; history readable. Auto-dismiss on reconnect with a brief
  "Back online" toast. `role="status"`.

### AI errors (mapped to [../03-api-integration.md](../03-api-integration.md) §6)
- Rendered **in place of** the assistant message content (ErrorState B19) or as an
  InlineAlert, by code:

| Code | Message (see [07](07-content-and-assets.md)) | Primary action |
| --- | --- | --- |
| `unauthorized` | Key problem | Open Models (V-21) |
| `deployment_not_found` | Names the model | Open Models |
| `rate_limited` | Countdown from Retry-After | Auto-retry; manual Retry |
| `content_filtered` | Policy explanation | Edit prompt |
| `server_error`/`timeout` | Generic + Retry | Retry |
| `aborted` | none (silent) | — (shows "Stopped" chip) |
| `unsupported_capability` | Feature unavailable | Open Models |

- **No key is ever shown in any error.**

### Loading / skeletons
- Thread open (from history): message Skeletons (B15) — alternating full-width and
  bubble shapes — until messages hydrate from IndexedDB.
- History list loading: row Skeletons.
- Image generating: ImageCard `generating` skeleton + progress text.

### Toasts
- Delete → "Conversation deleted" + **Undo** (8s). Copy → "Copied" (2s). Saved settings →
  "Saved". Export ready → "Export downloaded".

### Empty
- New thread (V-06). Empty search (V-12). Empty gallery (V-18). Archived empty.

- **Acceptance:** every data region shows empty/loading/error appropriately; offline gates
  AI but not reading; error copy matches the taxonomy and never leaks secrets.

---

## Chat acceptance summary

1. New-thread empty state → first send → titled active thread, smooth transition.
2. Streaming token-by-token; Stop preserves partial; pending shows TypingIndicator.
3. Markdown/code(+copy, highlight, wrap)/tables(scroll)/math/links/images all correct.
4. Action bar + action sheet operate (copy, regenerate w/ overrides, read-aloud, edit
   fork, delete+undo).
5. Composer: morph voice→send→stop, Enter behavior, drafts, dictation, attachments,
   disabled states.
6. Model selector sets per-thread model; gating from capability matrix.
7. All global states (offline/error/loading/empty/toast) render per spec with no key
   leakage.
