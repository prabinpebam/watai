# 05 — Memory UX And Control Spec

This document makes the memory system implementation-ready from a product and UX perspective. It defines the screens, language, states, interaction patterns, and acceptance criteria that make memory transparent without turning it into a noisy information bubble.

Cross-references: [02-watai-memory-spec.md](02-watai-memory-spec.md), [03-implementation-plan.md](03-implementation-plan.md), [04-evaluation-and-governance.md](04-evaluation-and-governance.md), [../ui-design/02-components.md](../ui-design/02-components.md), [../ui-design/03-screens-onboarding-settings.md](../ui-design/03-screens-onboarding-settings.md).

## 1. What Implementation-Ready Means

For this memory system, implementation-ready means the spec answers every question an engineer or designer would otherwise need to invent during build:

| Area | Required clarity |
| --- | --- |
| Product promise | What memory does and does not do for users. |
| Data contract | Exact record types, states, source refs, and deletion behavior. |
| Runtime contract | When memory is read, written, skipped, cached, and shown. |
| UX contract | Screens, controls, labels, empty/loading/error states, and response-level disclosure. |
| Safety contract | What is never stored, what requires explicit consent, and what deletion means. |
| Performance contract | Retrieval budgets, fallback behavior, telemetry, and eval gates. |
| Acceptance contract | Tests and manual QA that prove the feature works semantically, not just that APIs exist. |

If a developer can implement the first release by following the docs without asking product questions such as "where does the user edit this?", "what happens when memory is paused?", "what should the response show?", or "does this abstract style preference count as memory?", then the spec is implementation-ready.

## 2. UX Principles

1. **Transparent, not noisy.** Memory should be easy to inspect when the user wants it, but it should not add a visible badge or bubble to every response.
2. **User-owned, not assistant-owned.** Watai may suggest and extract memory, but the user can correct, suppress, delete, pause, export, and rebuild it.
3. **Simple language over system terms.** The UI says "Remembered", "Used for this response", "Don't use this", and "Update". Avoid exposing words like embedding, retrieval, atomic, vector, or salience in normal UI.
4. **Abstract memory is allowed.** Watai should remember preferences, working style, recurring correction patterns, project context, and durable goals, not only concrete facts.
5. **No information bubble.** Memory should not become a random pile of trivia. It is a curated context system with sources, confidence, currentness, and controls.
6. **Current message wins.** If the user says something that conflicts with memory, the UI and model behavior should privilege the current user turn and allow memory to update later.

## 3. User Mental Model

The product should explain memory as:

> Watai can remember useful context you choose to keep, such as preferences, work style, project details, and past work. You can review and change what it remembers at any time.

Avoid implying:

- Watai remembers everything.
- Memory is always used.
- The memory summary is a complete database.
- Deleting the summary deletes every source fact.

## 4. Memory Categories In The UI

The backend has precise `MemoryKind` values; the UI groups them into understandable categories:

| UI category | Backing kinds | Examples | Default display |
| --- | --- | --- | --- |
| Preferences | `preference`, `avoidance` | "Prefers concise implementation plans." "Do not suggest Electron auto-launch." | Memory list + top-of-mind eligible. |
| Work style | `work_style`, `procedure` | "Likes eval-driven proof before calling UI work done." "Wants Playwright screenshots for visual claims." | Memory list + summary. |
| Project context | `project_context`, `fact`, `entity` | "Watai uses Azure Functions for server-side runs." | Memory list + source panel. |
| Past work | `thread_summary` | "Server-run migration completed and deployed." | Thread-summary section. |
| Custom instructions | Settings fields | "How Watai should respond." | Separate from extracted memory. |

### Abstract Memory Examples

These should be valid memories if source-linked and useful:

- "User prefers direct implementation over proposals when requirements are clear."
- "User expects frontend claims to be verified with screenshots or DOM evidence."
- "User dislikes noisy, marketing-style dashboards for operational tools."
- "User often asks Watai to commit, push, and verify deployment after changes."
- "For this app, the user values server-authoritative architecture over browser-only behavior."

These should not be stored automatically:

- "User asked for a blue button today." (one-off)
- "User was frustrated." (emotion inference; not durable enough)
- "User pasted an API key." (secret)
- "User mentioned someone else's private detail." (third-party sensitive)

## 5. Settings IA

Memory lives under Settings > Personalization as a full subview, not a small inline list.

### 5.1 Personalization Hub Row

Existing Personalization settings should show:

- Custom instructions section.
- Memory section card with:
  - master toggle: **Memory**,
  - status text: "On", "Paused", "Off", or "Needs review",
  - row action: **Manage memory**.

Do not put the full memory list directly on the Personalization page. It becomes too dense and makes memory feel like a raw database.

### 5.2 Manage Memory Screen

Primary layout:

```text
Settings / Memory

[Memory toggle] [Pause]

Summary
  Watai's short, editable view of what it understands about you.
  [summary card] [Edit]

Remembered
  [Search memories]
  [All] [Preferences] [Work style] [Project context] [Past work] [Hidden]

  Memory row
  Memory row
  Memory row

Actions
  Export memory
  Import memory
  Rebuild from chat history
  Delete all memory
```

Expanded layout:

- Left side: category filters and memory rows.
- Right side: selected memory detail.

Compact layout:

- List first.
- Tapping a memory pushes to detail view.

## 6. Memory Row

Each row should be scannable and calm:

```text
[category icon] User prefers concise implementation plans.
              Preference · Used 3 times · From Jun 24
                                      [more]
```

Fields:

- text, max two lines,
- category label,
- source/date summary,
- status pill only when not normal: `Top of mind`, `Hidden`, `Outdated`, `Deleted`.

Do not show confidence, salience, score, embedding, or raw source ids in the row.

Row actions:

- Edit,
- Make top of mind / Move to background,
- Don't use this,
- Delete,
- View source.

## 7. Memory Detail

Detail view must answer: what is remembered, why, where it came from, and what can I do?

Sections:

1. **Memory text**
   - Editable text area.
   - Save/cancel.
2. **Category**
   - Select category: Preference, Work style, Project context, Past work.
3. **Use in responses**
   - Toggle: enabled/hidden.
   - Priority: Top of mind / Normal / Background.
4. **Source**
   - Manual, imported, settings, thread, or message source.
   - Link to source thread/message when available.
   - Bounded quote when available.
5. **History**
   - Created date, last used date, superseded-by or supersedes information.
6. **Danger zone**
   - Delete memory.

Acceptance:

- Editing text updates the server record and immediately affects future retrieval.
- Hiding/suppressing immediately excludes the memory from prompt context.
- Deleting immediately excludes it and removes it from normal list views.

## 8. Memory Summary UX

The summary is a reviewable synthesis, not the complete source of truth.

UI copy:

> This is Watai's compact view of useful context. It may not show every memory. Editing it changes the summary, while individual memories below remain source-linked.

Controls:

- Edit summary.
- Refresh summary.
- View memories used to build this summary.
- Reset summary from active memories.

Rules:

- Editing the summary should not delete atomic memories.
- Refreshing summary should be backgrounded and show status.
- Summary updates should have version history for rollback once versioning exists.

## 9. Response-Level "Memory Used" UX

When a response uses memory, show a compact affordance under the assistant message near source/tool affordances:

```text
Memory used
```

Do not show this when no memory was used. Do not show a persistent bubble on every response.

Opening it shows a panel:

```text
Memory used for this response

Preferences
  User prefers concise implementation plans.  [Correct] [Don't use] [Delete]

Project context
  Watai uses Azure Functions for server-side generation. [View source]

Why am I seeing this?
  Watai includes relevant memory only when it may improve the response.
```

Actions:

- Correct: opens memory detail edit.
- Don't use: suppresses this memory.
- Delete: deletes with confirmation.
- View source: opens source thread/message when available.
- Mark not relevant: records feedback for retrieval tuning, does not delete.

Acceptance:

- Used memories shown in the panel match `memoryRefs` on the assistant message.
- Suppress/delete from this panel prevents future use without refreshing the app.
- Shared/exported conversations do not expose hidden memory sources unless explicitly included in authenticated export.

## 10. Manual Remember / Forget Commands

Watai should support explicit commands in chat:

- "Remember that ..."
- "Don't remember that ..."
- "Forget that ..."
- "Don't mention/use ... again"

Behavior:

- Manual remember creates a memory immediately after validation.
- The assistant should confirm briefly: "Saved to memory." or "I can't save secrets to memory."
- Manual forget/suppress should update memory immediately and show confirmation.
- If matching memory is ambiguous, ask the user to pick from candidates.

This is the one memory write path allowed to be close to the user interaction. Automatic extraction remains backgrounded.

## 11. Empty, Loading, Error, And Paused States

### Empty

Copy:

> Nothing remembered yet.
> When memory is on, useful preferences, work style, and project context can appear here. You can also add something manually.

Actions:

- Add memory.
- Learn what memory can store.

### Loading

- Skeleton rows.
- Summary skeleton.
- Do not block Settings navigation.

### Error

Copy:

> Memory couldn't load.
> Your chats still work. Try again.

Actions:

- Retry.

### Paused

Copy:

> Memory is paused.
> Watai won't use or update memory until you resume it. Your saved memories stay here.

Actions:

- Resume memory.
- Delete all memory.

## 12. Touch And Mobile UX

Compact/mobile requirements:

- Memory list rows have 44px minimum hit targets.
- Row overflow actions use a menu, not hover-only affordances.
- Memory Used opens a bottom sheet, not a narrow popover.
- Source links push to a source detail view or open the thread at the message anchor.
- Destructive actions use confirmation sheets.
- Summary edit uses a full-screen editor with save/cancel app bar.

## 13. Accessibility

- Memory rows are buttons or links with clear accessible names.
- Status is not color-only; use labels such as Hidden, Top of mind, Outdated.
- Response-level Memory Used affordance is keyboard reachable.
- Bottom sheets/dialogs trap focus and close on Escape.
- Delete/suppress confirmations announce what will happen.
- Search/filter controls expose result counts.

## 14. Acceptance Checklist

Memory UX is implementation-ready only when these can be tested:

- User can add a manual memory and see it in the list.
- User can edit text/category/priority and see changes persist.
- User can hide/suppress a memory and it is excluded from retrieval.
- User can delete a memory and it is excluded immediately.
- User can pause memory without deleting stored memories.
- User can distinguish explicit saved memory from chat-history-derived memory.
- User can see Memory Used on a response and inspect the exact source-linked memories.
- User can correct/delete/suppress memory from the response source panel.
- Empty/loading/error/paused states are implemented.
- Mobile uses bottom sheets/full-screen editors rather than hover-only interactions.
- No UI exposes embeddings, raw scores, internal ids, or model extraction JSON to normal users.