# 05 — Execution Plan

This document turns the specification into a buildable plan: guiding principles, the
tech stack summary, environments, a phased roadmap with deliverables and acceptance
criteria, the testing strategy, CI/CD, the risk register, the decisions log, and the
definition of done.

Cross-references: [README.md](README.md) · [01-product-spec.md](01-product-spec.md) ·
[02-architecture.md](02-architecture.md) · [03-api-integration.md](03-api-integration.md) ·
[04-data-model.md](04-data-model.md).

---

## 1. Guiding principles

1. **De-risk the unknowns first.** The biggest uncertainties (CORS/streaming directly to
   Azure OpenAI; the voice-output gap D4) are settled with spikes in Phase 1, before
   broad feature work.
2. **Thin vertical slices.** Each phase ships an end-to-end usable increment, not a
   horizontal layer. A working streaming chat beats a perfect-but-disconnected design
   system.
3. **Eval-driven.** Each capability ships with automated checks that prove the *product
   claim*, not just that code runs (see §6).
4. **Secrets discipline from day one.** Key handling, CSP, and sanitization are built in,
   not bolted on.
5. **Reproducible infra.** Every Azure resource is provisioned via IaC; no click-ops.

---

## 2. Tech stack summary

| Layer | Choice | Reference |
| --- | --- | --- |
| Frontend | React + TypeScript + Vite, PWA | [02-architecture.md](02-architecture.md) §2 |
| Styling | CSS variables + token layer | [01-product-spec.md](01-product-spec.md) §7 |
| AI clients | Custom typed clients over a shared HTTP layer | [03-api-integration.md](03-api-integration.md) |
| Hosting (frontend) | GitHub Pages + GitHub Actions | [02-architecture.md](02-architecture.md) §4, §10 |
| Auth | Microsoft Entra External ID | [02-architecture.md](02-architecture.md) §5 |
| Backend API | Azure Functions (Container Apps if proxy needed) | [02-architecture.md](02-architecture.md) §5 |
| Data | Cosmos DB (serverless) + Blob Storage | [04-data-model.md](04-data-model.md) |
| IaC | Bicep + Azure CLI / azd | [02-architecture.md](02-architecture.md) §9 |
| Testing | Vitest, Testing Library, Playwright, axe, Lighthouse CI | §6 |

---

## 3. Environments

| Env | Frontend | Backend | Purpose |
| --- | --- | --- | --- |
| **Local** | Vite dev server | Functions local + emulators (Cosmos/Storage) | Day-to-day dev. |
| **Dev** | Pages preview / branch | Azure `dev` resource group | Integration + E2E. |
| **Prod** | GitHub Pages (custom domain if O1) | Azure `prod` resource group | Live. |

AI plane uses the user's BYO key in all environments (no app-owned AI key by default).

---

## 4. Phased roadmap

```mermaid
flowchart LR
    P0[P0 Foundations] --> P1[P1 Core chat]
    P1 --> P2[P2 Persistence + auth]
    P2 --> P3[P3 Voice]
    P3 --> P4[P4 Images]
    P4 --> P5[P5 Polish + PWA]
    P5 --> P6[P6 Hardening + launch]
```

Phases are sequential but overlap where safe (e.g. design tokens in P0 continue through
P5). Each phase lists **goal**, **scope**, **deliverables**, and **acceptance**.

### Phase 0 — Foundations

- **Goal:** a deployable empty app and reproducible infra skeleton.
- **Scope:**
  - Repo scaffolding: Vite + TS + lint/format + test runners + commit hooks.
  - App shell, routing decision (hash vs history + SPA fallback), theming tokens,
    base path config for Pages.
  - PWA manifest + service worker skeleton.
  - GitHub Actions: build + deploy to Pages; OIDC to Azure.
  - IaC skeleton: Bicep modules + `azd`/`az` scripts that stand up an empty `dev` RG
    (Cosmos, Storage, Functions, Key Vault, App Insights, Entra External ID app reg).
  - Security baseline: CSP scaffold, dependency audit in CI, secret scanning.
- **Deliverables:** "hello app" live on Pages; `dev` infra provisioned + torn down via
  one command.
- **Acceptance:** architecture criteria 1–2 and 6 in
  [02-architecture.md](02-architecture.md) §12.

### Phase 1 — Core chat (the critical spike + first real value)

- **Goal:** a working, streaming, markdown chat against `gpt-5.4` with local history.
- **Scope:**
  - **Spike (highest priority): verify direct browser → Azure OpenAI CORS + streaming.**
    Decide Option A vs proxy B1 ([02-architecture.md](02-architecture.md) §3).
  - BYO-key setup wizard + ApiConfig storage (IndexedDB) + Test connection
    ([01-product-spec.md](01-product-spec.md) §5.3, [04-data-model.md](04-data-model.md) §4).
  - Chat client with streaming, cancellation, retries, error taxonomy
    ([03-api-integration.md](03-api-integration.md) §2, §6).
  - Message list + composer + markdown/code/math rendering (sanitized)
    ([01-product-spec.md](01-product-spec.md) §5.4).
  - New thread, auto-title, local persistence (IndexedDB), history drawer (local),
    search (client index).
  - Local-only mode (D9) usable end-to-end without a backend.
- **Deliverables:** a person can configure their key and hold a full streaming
  conversation with history, entirely client-side.
- **Acceptance:** product criteria 1–2 ([01-product-spec.md](01-product-spec.md) §14);
  API criteria 1, 4, 6 ([03-api-integration.md](03-api-integration.md) §9).

### Phase 2 — Persistence + auth (cloud sync)

- **Goal:** accounts and cross-device history/image sync.
- **Scope:**
  - Entra External ID sign-in (PKCE), token handling, account-optional → synced merge.
  - Persistence API (Functions): threads/messages CRUD, settings, SAS minting, search/
    export/delete ([02-architecture.md](02-architecture.md) §5.2).
  - Cosmos schema + Blob layout ([04-data-model.md](04-data-model.md) §2–§3).
  - Sync engine: optimistic local writes, delta pull, LWW reconciliation, op-log queue
    ([04-data-model.md](04-data-model.md) §5).
  - Security: token validation, per-object ownership checks, input validation, scoped
    SAS ([02-architecture.md](02-architecture.md) §6.3).
- **Deliverables:** sign in on two devices, see the same history; data export + delete-all
  work.
- **Acceptance:** data-model criteria 1–6 ([04-data-model.md](04-data-model.md) §9);
  architecture criteria 4 ([02-architecture.md](02-architecture.md) §12).

### Phase 3 — Voice

- **Goal:** dictation and a full spoken conversation mode.
- **Scope:**
  - **Resolve D4** (TTS vs Realtime) — default: implement **TTS read-aloud** + turn-based
    voice mode ([03-api-integration.md](03-api-integration.md) §5).
  - Audio capture, waveform, VAD; dictation into composer
    ([01-product-spec.md](01-product-spec.md) §5.4.3, [03-api-integration.md](03-api-integration.md) §3).
  - Transcription client (`gpt-4o-transcribe`) with capability detection + graceful
    degradation.
  - Full-screen voice mode UI (orb/visualizer, captions, controls), writing turns back
    into the thread ([01-product-spec.md](01-product-spec.md) §5.7).
  - (Optional, flagged) Realtime prototype + session-token minting endpoint if pursued.
- **Deliverables:** dictate into the composer; run a hands-free spoken loop that persists
  to the thread.
- **Acceptance:** product criterion 3; API criterion 2.

### Phase 4 — Images

- **Goal:** inline image generation, viewer, gallery, edits/variations.
- **Scope:**
  - Image client (`gpt-image-2`): generate (`b64_json`), persist to Blob, provenance
    ([03-api-integration.md](03-api-integration.md) §4, [04-data-model.md](04-data-model.md) §3).
  - Inline image cards + full-screen viewer (zoom/pan, save/share/regenerate/variations).
  - Per-conversation gallery; "use as input" for edits/inpainting where supported.
  - Content-filter handling and prompt-revision UX.
- **Deliverables:** generate an image in chat, open it, make a variation, and see it sync
  across devices.
- **Acceptance:** product criterion 4; API criterion 3.

### Phase 5 — Polish + PWA

- **Goal:** make it feel native and complete.
- **Scope:**
  - Full Settings (account, models/keys, personalization + memory, voice, data controls,
    appearance, about) ([01-product-spec.md](01-product-spec.md) §5.10).
  - Theming (system/light/dark), text size/density, reduced motion, i18n/RTL scaffolding.
  - PWA: installability, offline reading, app-shell caching, queued sends (optional).
  - Interaction polish: streaming/auto-scroll/jump-to-latest, transitions, haptics-equiv,
    keyboard shortcuts ([01-product-spec.md](01-product-spec.md) §6, §13).
  - Performance pass to hit the success metrics ([README.md](README.md) §6).
- **Deliverables:** installable PWA, complete settings, polished motion, meets perf
  budgets.
- **Acceptance:** product criteria 5–7; success metrics in [README.md](README.md) §6.

### Phase 6 — Hardening + launch

- **Goal:** ship with confidence.
- **Scope:**
  - Security review against the threat model
    ([02-architecture.md](02-architecture.md) §6.5): CSP tightening, sanitization audit,
    SAS scoping, IDOR tests, dependency/secret scans.
  - Accessibility audit (screen reader, keyboard, contrast, reduced motion) to WCAG 2.2 AA.
  - Observability: dashboards, alerts, budgets; runbooks.
  - Load/limits: Cosmos RU sizing, large-thread behavior, rate-limit UX under stress.
  - Full eval suite green; Lighthouse budgets; visual regression baseline.
  - Docs: user-facing privacy/security explainer; ops runbook.
- **Deliverables:** production launch on prod infra + custom domain (O1) if chosen.
- **Acceptance:** all phase acceptance criteria; success metrics; zero known high-sev
  security/a11y issues.

---

## 5. Milestones

| Milestone | Marks |
| --- | --- |
| **M0 — Skeleton live** | P0 done: app on Pages, infra reproducible. |
| **M1 — It talks (text)** | P1 done: streaming BYO-key chat with local history; CORS/proxy decided. |
| **M2 — It remembers** | P2 done: accounts + cross-device sync, export/delete. |
| **M3 — It listens & speaks** | P3 done: dictation + voice mode (D4 resolved). |
| **M4 — It draws** | P4 done: image gen, viewer, gallery, edits. |
| **M5 — It feels native** | P5 done: PWA, settings, polish, perf budgets. |
| **M6 — It ships** | P6 done: hardened, accessible, observable, launched. |

---

## 6. Testing strategy (eval-driven)

Testing proves **product claims**, not just code execution. Layers:

| Layer | Tooling | What it proves |
| --- | --- | --- |
| **Unit** | Vitest | Pure logic: streaming parser, token estimator, sync op-log, error mapping, crypto wrapping. |
| **Component** | Testing Library | Rendering: markdown/code/math, composer morphing button, message actions, states. |
| **Integration (AI mocked)** | Vitest + mock server | Capability clients against recorded Azure OpenAI fixtures: streaming, retries, 429/`Retry-After`, content filter, abort. |
| **E2E** | Playwright | Real user flows on a built app with a **mocked AI plane**: onboarding → BYO-key → chat → history → voice (stubbed) → image (stubbed) → settings. Owns the app instance/port it drives. |
| **Contract** | Schema tests | Persistence API request/response schemas; ownership/IDOR negative tests. |
| **Accessibility** | axe + Playwright | Roles, focus order, live regions, contrast, keyboard completeness. |
| **Performance** | Lighthouse CI | Budgets for shell load, TTI, PWA, a11y ([README.md](README.md) §6). |
| **Visual regression** | Playwright snapshots | Theme/layout stability across light/dark and breakpoints. |
| **Security** | SCA, secret scan, header/CSP check | No leaked secrets, sane CSP, current deps. |

### 6.1 Capability evals (semantic, not plumbing)

Each AI capability has an eval that asserts the *behavior*, with fixtures rich enough to
reveal real differences (not degenerate smoke data):

- **Chat:** a streamed response renders correct markdown/code/math; cancellation
  preserves the partial; context truncation keeps the system prompt + recent turns.
- **Transcription:** a known audio fixture yields expected text; VAD auto-stop triggers;
  dictation never clobbers user-typed text.
- **Image:** a prompt yields an image that persists to (mocked) Blob with correct
  provenance; variation differs from the original; edit path is gated by capability.
- **Voice mode:** a scripted STT→chat→TTS loop writes the right turns to the thread; mic
  permission denial degrades to text.
- **Sync:** concurrent edits on two simulated clients reconcile to last-write-wins with
  no lost appends.

### 6.2 Negative & safety gates

- IDOR: a user cannot read/write another user's thread/message/asset (must fail closed).
- Secret leakage: assert the BYO key never appears in network logs to the persistence
  API, telemetry, error payloads, or exports.
- Content filter: a filtered prompt surfaces the right normalized error, not a crash.

### 6.3 CORS/streaming spike test (Phase 1)

A dedicated, runnable probe against a real Azure OpenAI `dev` deployment that confirms
(a) browser CORS is permitted and (b) SSE streaming parses correctly. Its result selects
Option A vs B1 and is recorded in the decisions log.

---

## 7. CI/CD

See [02-architecture.md](02-architecture.md) §10 for pipeline definitions. Gates:

- PR: typecheck + lint + unit + component + integration (mocked) + a11y + Lighthouse
  budgets + security scans must pass.
- Merge to `main`: deploy frontend to Pages; run E2E (mocked) post-deploy smoke.
- Infra changes: validate Bicep → apply to `dev` → integration tests → promote to `prod`
  on tagged release. CI authenticates to Azure via OIDC (no stored cloud creds).

---

## 8. Risk register

| ID | Risk | Likelihood | Impact | Mitigation |
| --- | --- | --- | --- | --- |
| R1 | Azure OpenAI blocks browser CORS → direct calls fail. | Medium | High | Phase 1 spike; proxy fallback (B1) behind config flag ([02-architecture.md](02-architecture.md) §3). |
| R2 | Voice output undefined (D4) blocks "talk". | High (already open) | Medium | Default to TTS read-aloud; Realtime as flagged follow-up ([03-api-integration.md](03-api-integration.md) §5). |
| R3 | BYO key leakage via XSS/logging. | Low | Critical | CSP, sanitization, IndexedDB, optional at-rest encryption, no-log scrubber, code review gate. |
| R4 | Model names (`gpt-5.4`, `gpt-image-2`) unavailable as named. | Medium | Medium | Treat as user-configured deployment names; capability detection + clear setup errors (D10). |
| R5 | GitHub Pages SPA deep-link 404s. | Medium | Low | Hash routing default or 404 fallback ([02-architecture.md](02-architecture.md) §4). |
| R6 | Cosmos large-thread partition limits. | Low | Medium | Per-thread partition; post-v1 archival/summarization ([04-data-model.md](04-data-model.md) §2.2). |
| R7 | Streaming behind some proxies/CDNs buffers. | Low | Medium | Verify in spike; Container Apps proxy if Functions streaming is poor. |
| R8 | Auth redirect/CSP friction on `*.github.io` subpath. | Medium | Low | Prefer custom domain (O1); document redirect URIs. |
| R9 | Cost surprises (Cosmos RU, image storage). | Low | Medium | Serverless + budgets/alerts; lifecycle rules; usage view. |
| R10 | Realtime credential exposure (if Path 2). | Medium | High | Short-lived session tokens via minting endpoint; never expose long-lived key to realtime channel. |
| R11 | Scope creep toward GPTs/plugins/teams. | Medium | Medium | Non-goals fixed in [README.md](README.md) §3.2; park in post-v1 backlog. |

---

## 9. Decisions log (ADR-lite)

Records material choices. Status: Accepted (default proceeding) or Open (needs confirm).
Defaults mirror [README.md](README.md) §7.

| ADR | Decision | Status | Notes |
| --- | --- | --- | --- |
| ADR-001 | Two-plane architecture (AI plane vs persistence plane). | Accepted | Keeps keys off the backend. |
| ADR-002 | BYO-key stored client-side only; never on servers. | Accepted | Central privacy invariant. |
| ADR-003 | Direct browser → Azure OpenAI by default; proxy B1 fallback. | Accepted (verify P1) | Gated by CORS/streaming spike. |
| ADR-004 | React + TS + Vite PWA. | Accepted | Swappable for Svelte; arch is agnostic. |
| ADR-005 | Functions + Cosmos (serverless) + Blob + Entra External ID. | Accepted | Low-ops, scale-to-zero. |
| ADR-006 | IaC via Bicep + Azure CLI / azd; CI via OIDC. | Accepted | No click-ops, no stored creds. |
| ADR-007 | Account-optional local-only mode. | Accepted | Privacy fallback (D9). |
| ADR-008 | Model strings are user-set deployment names. | Accepted | Future-proofs model swaps (D10). |
| ADR-009 | Voice output engine (TTS vs Realtime). | **Open (D4/O3)** | Default TTS for v1; Realtime evaluated. |
| ADR-010 | Custom domain for Pages. | **Open (O1)** | Affects auth redirects + CSP. |
| ADR-011 | Sync conflict policy = last-write-wins. | Accepted (revisit O2) | Conversations are append-heavy. |
| ADR-012 | Data residency/region + retention defaults. | **Open (O4)** | Set at provisioning. |
| ADR-013 | At-rest encryption of BYO key behind passphrase. | **Open (O5)** | Offered optionally in setup. |

---

## 10. Definition of Done (per increment)

A slice is done when:

1. It satisfies the relevant acceptance criteria in the spec docs.
2. Unit + component + integration (mocked) + applicable E2E evals pass in CI.
3. Accessibility checks pass for the touched surfaces (keyboard + screen reader + contrast).
4. No secret appears in logs, telemetry, network-to-backend, or exports.
5. Performance budgets for touched surfaces hold.
6. Docs updated where behavior changed (this folder), and the decisions log reflects any
   new choices.
7. Infra changes (if any) are codified in Bicep and applied via the pipeline, not by hand.

---

## 11. Post-v1 backlog (parked)

- Realtime full-duplex voice mode (if not in v1).
- Custom assistants / saved prompts / "projects".
- Server-side search via Azure AI Search at scale.
- Shared/published conversation links.
- Cross-device real-time presence and field-level merge.
- Attachment types beyond image/audio (documents, code files) with retrieval.
- Cost dashboard and per-thread budgets.
- Native wrappers (if PWA proves insufficient).

---

## 12. Immediate next actions

1. Confirm the **Open** decisions: D4 (voice output), O1 (custom domain), O4 (region/
   retention), O5 (key encryption). These shape Phases 1–3.
2. Stand up Phase 0: repo scaffold + Pages deploy + IaC skeleton for `dev`.
3. Run the **Phase 1 CORS/streaming spike** against a real Azure OpenAI deployment and
   record the result in ADR-003.
4. Build the BYO-key wizard + streaming chat slice to reach **M1 — It talks**.
