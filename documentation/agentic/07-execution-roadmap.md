# 07 — Execution Roadmap

A phased, buildable plan to ship the agentic capabilities, with provisioning, testing, cost
controls, risks, and a decisions log. Dovetails with the base plan in
[../05-execution-plan.md](../05-execution-plan.md) and respects the repo conventions in
[../../HANDOFF.md](../../HANDOFF.md) (strict TDD on the backend, no emoji, no auto-launching
dev servers, Conventional Commits).

---

## 1. Guiding principles

- **Additive & gated.** Every phase ships behind capability detection + a settings toggle;
  classic chat/image/voice keep working untouched.
- **Privacy preserved.** AI-plane calls stay browser-direct with the BYO credential; the
  persistence plane never sees the AI key.
- **Vertical slices.** Each phase delivers a usable end-to-end feature, not just plumbing.
- **Cheapest path first.** Function calling and prompt-expansion work on plain Azure OpenAI;
  project-only features (web search, deep research) come after the project decision (A7).

---

## 2. Phases

### Phase 0 — Foundations (no user-visible change)

- Add `responses.ts` (typed Responses client + SSE event mapping) reusing `http.ts`.
- Add the **orchestrator** skeleton with budgets and a normalized event stream.
- Extend types (`Message.toolCalls/citations`, `CapabilityMatrix`, `ApiConfig`,
  `Settings.tools`) — all optional/additive.
- Extend `capabilities.ts` with `probeAgentic` + `endpointKind` detection.
- Extend `mockAi.ts` with an agentic stream for offline dev/tests.
- **Exit:** unit tests green for client + orchestrator loop + probes (mocked); no UI change.

### Phase 1 — Client-side function calling (Path C, works on any endpoint)

- Implement the function-tool **registry** + `history`/`threads`/`memory` tools backed by
  `repo`, with destructive-action confirmation.
- Wire `useChat` to use the orchestrator when **agentic mode** is on; render **tool cards**.
- **Exit:** "find/summarize my thread about X", "save this to memory" work end-to-end; AI key
  stays in the browser; app token used for persistence calls. Acceptance: [03](03-agentic-chat-and-tools.md) #3,#7.

### Phase 2 — Web search grounding (Path A, Foundry project)

- Gate on the **A7 decision** (BYO project vs. Watai-operated). Default: BYO project.
- Implement `web_search` requests + **citation parsing/rendering** (website links + Bing
  query link, per terms). Add the **consent + cost** gate (A8).
- Capability-gate the web-search chip; explain when unavailable.
- **Exit:** grounded answers with visible citations. Acceptance: [03](03-agentic-chat-and-tools.md) #1,#4,#6.

### Phase 3 — Agentic image generation (05)

- Implement `imageAgent.ts`: Stage-1 prompt expansion (pure chat, works anywhere) + Stage-2
  `image_generation` tool with **streaming partials**, plus the **plain-Image-API fallback**.
- Extend `ImageRef` provenance; upgrade `ImagesView` + viewer with **edit/inpaint** and the
  visible engineered prompt.
- **Exit:** context-aware "make a hero image for that" works; edits keep lineage; fallback
  works on Profile-1. Acceptance: all of [05](05-agentic-image-generation.md) §9.

### Phase 4 — Code Interpreter & MCP

- Render `code_interpreter` cards (code + output + produced files/images).
- Settings → Tools: add **MCP servers** (label/url, secrets in `secureStore`,
  `require_approval` consent on first call).
- **Exit:** a math/data question returns a computed chart; an attached MCP tool is callable.

### Phase 5 — Deep Research (04)

- Implement `research.ts` (clarify → run → report) using `o3-deep-research` + web search,
  the `/research` route, progress UI, and the **report artifact**; persist locally (optionally
  add the backend `ResearchService`/store).
- Provisioning checklist + optional Bicep for the project/models/Bing.
- **Exit:** a non-trivial prompt yields a clarify step, live progress, and a cited report.
  Acceptance: all of [04](04-deep-research.md) §8.

### Phase 6 — Hardening

- Cost surfacing per turn; budget tuning; error taxonomy polish; a11y for tool cards/report;
  telemetry for tool success/latency; docs + dev-menu coverage.

---

## 3. Provisioning

### 3.1 BYO-project user (default) — setup checklist (surfaced in Settings)

1. Create a **Foundry project** (West US or Norway East if Deep Research is wanted).
2. Deploy models: chat (`gpt-5.4`/`gpt-5*`), an **orchestrator** (`gpt-4.1-mini`/`gpt-4o`),
   **`gpt-image-1`** (image tool), and — for research — **`o3-deep-research` 2025-06-26** +
   `gpt-4o`.
3. Create + connect a **Grounding with Bing Search** resource (paid/PAYG subscription).
4. In Watai Settings: paste the **project endpoint** + deployment names; click **Detect
   capabilities**; accept the **web data-boundary + cost** consent.

### 3.2 Watai-operated project (only if A7 chooses it) — `infra/`

- Add a Bicep module for: Foundry project, model deployments, Bing connection, and role
  assignments for the existing Function App MI / users. Reuse the patterns and gotchas in
  [../../HANDOFF.md](../../HANDOFF.md) §6/§10 and `infra/main.bicep`.
- Admin control: web search can be toggled per-subscription via
  `az feature register/unregister --name OpenAI.BlockedTools.web_search --namespace Microsoft.CognitiveServices`.

> Re-verify model versions, regions, and tool availability at build time (preview surface).

---

## 4. Testing strategy

- **TDD frontend** for `responses.ts`, `orchestrator.ts`, tool registry (incl. destructive
  confirm), citation parsing, capability probes, and `imageAgent` Stage-1 — all with mocked
  fetch/streams (extend `mockAi.ts`); vitest + jsdom, `src/test/setup.ts`.
- **TDD backend** (strict, per HANDOFF) for any validator/service/store additions; offline +
  Cosmos integration mirroring existing adapters.
- **Capability-matrix tests**: simulate Profile-1 (AOAI) and Profile-2 (project) configs and
  assert correct gating/degradation.
- **Manual e2e** against a real project for web search, image tool, and deep research before
  each phase exits; smoke the deployed API as in HANDOFF §0.

---

## 5. Cost controls

- **Budgets** per turn: max tool calls, recursion depth, wall-clock, tokens; hard-stop with a
  clear message.
- **Consent gates** before any Bing-billed action (web search, deep research) with an
  **estimated cost range**; deep research shows a stronger warning.
- **Capability gating** avoids calling region/endpoint-incapable tools (no wasted 4xx spend).
- **Quality defaults** tuned (e.g. image `quality:'low'` for quick previews; `medium` web
  `search_context_size`); user can opt up.
- **Telemetry** on tool usage/latency/cost signals for tuning (no secret/prompt logging).

---

## 6. Risks & mitigations

| Risk | Impact | Mitigation |
| --- | --- | --- |
| **A7 unresolved** (BYO vs. operated project) | Blocks Phases 2/5 | Decide before Phase 2; default BYO project; Phase 1 + Stage-1 image expansion ship regardless. |
| Preview APIs change | Breakage | Pin API version; feature-flag; capability-probe; re-verify at build. |
| Bing cost/data-boundary surprises users | Trust/cost | Explicit consent + cost notice (A8); off by default. |
| Prompt injection via tool output | Security | Treat tool output as untrusted; allow-list client tools; confirm destructive ops; never auto-act on web content. |
| Region lock for deep research | Feature unavailable | Detect + explain; offer web-search-only research as a lighter alternative. |
| Latency of multi-step runs | UX | Stream progress + partial images; budgets; "continue in chat". |
| Scope creep into Computer Use/Browser tools | Risk/complexity | Explicitly out of scope this iteration. |
| Key leakage across planes | Security regression | Keep AI credential and app token strictly separate; tests assert no AI key in backend calls. |

---

## 7. Definition of done (per feature)

- Capability-gated, with graceful degradation and a clear explanation when off.
- Privacy invariant tested (AI key never sent to the Watai backend).
- Tool actions visible/auditable in the transcript; citations rendered per terms.
- Budgets + consent enforced; errors mapped to the taxonomy.
- Unit tests green; backend additions TDD'd; acceptance criteria in the feature doc met.
- No emoji; Watai tokens/Fluent icons; Conventional Commit(s).

---

## 8. Decisions log

| # | Decision | Status |
| --- | --- | --- |
| A1 | Responses API is the primary agentic surface (browser-direct, BYO key). | Assumed |
| A2 | Server-side tools in the service; client-side function tools in the browser. | Assumed |
| A3 | Detect endpoint kind; capability-gate advanced tools. | Assumed |
| A4 | Deep Research = `o3-deep-research` + web search (standalone tool deprecated). | Assumed |
| A5 | Agentic images via Stage-1 prompt expansion + `image_generation` tool, with plain-API fallback. | Assumed |
| A6 | Persist bounded tool/citation/research/image provenance; never raw payloads. | Assumed |
| **A7** | **BYO Foundry project vs. Watai-operated project.** | **OPEN — decide before Phase 2** |
| A8 | Web search / deep research behind explicit cost + data-boundary consent. | Assumed |
| A9 | Computer Use / Browser Automation out of scope this iteration. | Assumed |
| A10 | Voice-mode agent tool use deferred. | Assumed |

Open items A7 (and cost-UX, voice-agents, hosted-agent productization) are carried here until
resolved; update this table as they close.
