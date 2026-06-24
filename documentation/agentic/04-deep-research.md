# 04 — Deep Research

A distinct, long-running task type: the user poses a non-trivial question, Watai
**clarifies the scope**, runs a **multi-step web investigation**, and returns a
**structured, fully-cited report**. This is Watai's equivalent of ChatGPT/Foundry "Deep
Research".

Cross-references: [01-foundry-capabilities.md](01-foundry-capabilities.md) §6 (models,
regions, deprecation), [02-architecture-and-adoption.md](02-architecture-and-adoption.md)
(Path B managed agents), [03-agentic-chat-and-tools.md](03-agentic-chat-and-tools.md)
(shared tool-card/citation UI).

---

## 1. What it is (and the deprecation note)

The original standalone **Deep Research tool is deprecated**. The current, supported pattern
is to use the **`o3-deep-research` model together with the web search tool**:

- A **`gpt-4o`** model first **clarifies the question and scopes** the task (asks follow-ups,
  narrows ambiguity).
- The **`o3-deep-research`** model then performs the **multi-step research** over public web
  data via **Grounding with Bing**, evaluating sources and iterating.
- The output is a **structured report**: the comprehensive answer **plus** source citations
  **plus** a description of the model's reasoning path — auditable end to end.

This makes Deep Research a **first-class task type** in Watai, separate from a normal chat
turn because it is slower, costlier, and produces a document-like artifact.

---

## 2. Prerequisites (Profile 2 only)

Deep Research requires a **Foundry project** (not a plain Azure OpenAI key):

- **Models deployed in the same project & region:**
  - `o3-deep-research` (version `2025-06-26`), Global Standard.
  - a `gpt-4o` deployment for scope clarification.
- **Region:** **West US** or **Norway East** only (where `o3-deep-research` is available).
- **Grounding with Bing Search** resource connected to the project.
- **Access:** automatic if the subscription already has Azure OpenAI `o3`; otherwise via the
  deep-research access request form.
- **Subscription:** paid/PAYG (Bing grounding is not available on free-credit subscriptions).

Watai **capability-detects** all of this and only surfaces Deep Research when satisfied;
otherwise the entry point is hidden with an explanatory tooltip.

---

## 3. Flow

```mermaid
sequenceDiagram
    participant U as User
    participant W as Watai (browser)
    participant C as gpt-4o (clarify)
    participant D as o3-deep-research + web_search
    participant B as Grounding with Bing

    U->>W: "Research the state of solid-state EV batteries in 2026"
    W->>C: clarify scope (Responses)
    C-->>W: 2-3 clarifying questions
    W->>U: show clarifying questions
    U->>W: answers / "go ahead"
    W->>D: start deep research (stream, conversation)
    loop multi-step
        D->>B: web search queries
        B-->>D: curated sources
        D-->>W: progress events (steps, partial findings)
        W-->>U: live progress (steps + sources so far)
    end
    D-->>W: final structured report + citations
    W->>U: render report; persist as artifact
```

### 3.1 Scope clarification

Before the expensive run, a quick `gpt-4o` Responses call asks **1–3 clarifying questions**
(time range, geography, depth, sources to prefer/avoid). The user can answer or skip
("proceed"). This mirrors the platform's intended use of `gpt-4o` for scoping and keeps cost
predictable.

### 3.2 The research run

A Responses call (Path B: an `o3-deep-research` **agent reference**, or inline with
`WebSearchPreviewTool`) with `stream: true` and a server-managed `conversation` id so the UI
can render progress. The orchestrator surfaces:

- the **current step** ("Searching…", "Reading 6 sources", "Synthesizing"),
- **sources discovered so far** (deduplicated), and
- any **partial findings** the model emits.

### 3.3 The report artifact

The final output is rendered as a **document**, not a chat bubble:

- Title, executive summary, sectioned body with inline citations.
- A **Sources** appendix (numbered, with title + URL) and the **Bing query** links
  (display obligation per [01](01-foundry-capabilities.md) §5).
- A **Reasoning path** disclosure (collapsible) describing how the model investigated.
- Actions: copy, export (Markdown/PDF later), "continue in chat" (open a normal thread
  seeded with the report), and "re-run with changes".

---

## 4. Data model

A research task is persisted so it survives reloads and syncs. See
[06-data-model-and-frontend.md](06-data-model-and-frontend.md) for the exact TS; shape:

```jsonc
// ResearchTask (new entity, stored like a Message/thread artifact)
{
  "id": "ulid",
  "threadId": "ulid",
  "prompt": "…",
  "clarifications": [{ "q": "…", "a": "…" }],
  "status": "clarifying" | "running" | "completed" | "error" | "interrupted",
  "steps": [{ "at": "iso", "label": "Searching", "detail": "…" }],
  "sources": [{ "title": "…", "url": "…", "bingQueryUrl": "…" }],
  "report": { "markdown": "…", "reasoningPath": "…" },
  "model": "o3-deep-research",
  "usage": { "promptTokens": 0, "completionTokens": 0, "toolCalls": 0 },
  "createdAt": "iso", "completedAt": "iso"
}
```

Progress (`steps`, `sources`) updates locally during the run; the final `report` is persisted
and synced via the persistence plane like other content (raw tool payloads are **not**
stored — only the curated report + sources).

---

## 5. UI

- **Entry points:** a "Deep research" action in the composer's Tools menu and a dedicated
  `/research` route (sibling of `/images`). Gated by capability detection.
- **Clarify step:** a compact card with the model's questions and quick-answer inputs +
  "Proceed".
- **Progress:** a live, ordered **step list** with a spinner on the current step and a
  growing **Sources** list; an elapsed timer; a **Stop** button.
- **Report:** full-width document view with sticky table-of-contents on desktop; inline
  citation superscripts; Sources + Reasoning appendices.
- **History:** completed reports appear in the thread and in history/search like other
  artifacts.

All visuals use Watai tokens and Fluent icons; no emoji (HANDOFF §11).

---

## 6. Cost, consent, and safety

- **Consent (A8):** Deep Research is behind the same **Bing cost + data-boundary** consent
  as web search, with an **additional** notice that deep research makes **many** searches and
  can be **noticeably more expensive**; show an estimated range before starting.
- **Budgets:** caps on total searches, steps, wall-clock (e.g. ≤ 10 min), and tokens; the run
  stops gracefully and returns a partial report if exceeded.
- **Untrusted sources:** report content is derived from the public web — Watai presents it as
  *researched*, not authoritative, and always shows sources for verification.
- **Region/quled limits:** respect `o3-deep-research` quotas; surface 429s with backoff.

---

## 7. Provisioning (summary; full steps in [07](07-execution-roadmap.md))

For a **BYO project** user, Watai provides a **setup checklist** (and optional Bicep snippet)
to:

1. Create a Foundry project in West US or Norway East.
2. Deploy `o3-deep-research` (`2025-06-26`) and a `gpt-4o` deployment.
3. Create + connect a Grounding with Bing Search resource.
4. Paste the project endpoint + deployment names into Watai Settings.

For a Watai-operated project (deferred, decision A7), this is provisioned once via Bicep in
`infra/`.

---

## 8. Acceptance criteria

1. A non-trivial prompt triggers a **clarify step** before the expensive run.
2. The run shows **live steps and accumulating sources**.
3. The final artifact is a **structured, cited report** with a Sources appendix and Bing
   query links rendered per terms.
4. The report **persists** and reopens after reload; appears in history/search.
5. Deep Research is **hidden** when the endpoint/region/models are not available, with a clear
   explanation.
6. Consent + cost notice is shown before the first run; budgets stop runaway cost.
