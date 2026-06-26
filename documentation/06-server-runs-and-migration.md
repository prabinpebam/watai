# 06 — Server-side Runs & Credentials: spec + migration plan

> **The source-of-truth build spec for the 2026 direction change.** It defines (A) the
> secure server-side credential vault, (B) the server-authoritative run engine, and (C) the
> phased migration that gets us there without breaking existing users.
> Context: [02-architecture.md](02-architecture.md) ·
> [03-api-integration.md](03-api-integration.md) · [04-data-model.md](04-data-model.md).

---

## 1. Scope, goals, non-goals

**Goal.** After a prompt is submitted, the assistant response is **generated and persisted
by the server in the correct chat structure regardless of the client.** The user may lock
the phone, background or close the app, or change networks, and find the finished message
on return — on any signed-in device.

**Sub-goals.**
- Move Azure OpenAI + Tavily credentials **server-side**, encrypted, synced per user,
  **never returned** to a client.
- Run the full agent loop (chat, tools, image generation) server-side, durably.
- Keep the client a thin renderer; keep hosting (GitHub Pages + Functions) unchanged.

**Non-goals (this epic).**
- Live voice/Realtime stays a client session (server-minted ephemeral token) — not made
  fire-and-forget. See [02](02-architecture.md) §8.
- No multi-user collaboration, no shared keys, no hosted "no-key" tier.

---

## 2. Credential vault (secure, synced, write-only)

### 2.1 Data model — `credentials` container (Cosmos, partition `/userId`)

One document per user. **Ciphertext only** — no plaintext secret ever persisted.

```jsonc
{
  "id": "cred",                     // single doc per user
  "userId": "<oid>",
  "baseUrl": "https://<res>.services.ai.azure.com/openai/v1", // non-secret
  "models": { "chat": "...", "image": "...", "transcribe": "...", "tts": "..." }, // non-secret
  "keyHint": "…a1b2",               // last 4 only, for the UI
  "aoai": { "ct": "<base64>", "iv": "<base64>", "tag": "<base64>", "kekVersion": "v1" },
  "tavily": { "ct": "...", "iv": "...", "tag": "...", "kekVersion": "v1" } | null,
  "tavilyHint": "…9f0c" | null,
  "updatedAt": "ISO",
  "createdAt": "ISO"
}
```

### 2.2 Encryption — envelope (AES-256-GCM under a Key Vault KEK)

- A **Key-Encryption-Key (KEK)** lives in **Azure Key Vault** (`watai-cred-kek`), never
  leaves it for the client.
- Per write, generate a random **Data-Encryption-Key (DEK)** + IV, `AES-256-GCM` encrypt the
  secret, then **wrap the DEK with the KEK** (Key Vault `wrapKey`) — store `{ct, iv, tag,
  wrappedDek, kekVersion}`. (Acceptable simpler variant for a single-tenant personal app: a
  single KEK used directly with a per-record IV; documented as a downgrade.)
- Decryption happens **only** inside the run activity that needs it: `unwrapKey` (Key Vault)
  → `AES-256-GCM` decrypt → use → zero the buffer. The Functions app authenticates to Key
  Vault via **Managed Identity** (no secret-to-reach-secrets).

### 2.3 API (all require an authenticated, invited identity)

| Method | Route | Body / result |
| --- | --- | --- |
| `PUT` | `/credentials` | `{ baseUrl, models, key, tavilyKey? }` → encrypt + store; returns **status only** (never the key). |
| `GET` | `/credentials/status` | `{ configured, baseUrl, models, keyHint, tavilyConfigured, tavilyHint, capabilities }`. |
| `DELETE` | `/credentials` | wipe the doc (and any cached capabilities). |
| `POST` | `/credentials/realtime-token` | mint a short-lived ephemeral token scoped to the realtime endpoint (live voice only). |

**Invariants (enforced + tested):**
1. No endpoint ever returns a decrypted secret. `GET /credentials/status` is asserted to
   omit ciphertext + plaintext.
2. The key is accepted over TLS once, encrypted **before** the first `await` that could log,
   and the plaintext variable is not passed to any logger/telemetry.
3. Errors from Azure OpenAI are redacted of any `Authorization` echo before persistence.

### 2.4 Threat model (summary)

| Threat | Mitigation |
| --- | --- |
| Cosmos read breach | Only ciphertext + wrapped DEK; KEK is in Key Vault (separate trust boundary). |
| Log/telemetry leak | Redaction; plaintext lifetime bounded to one activity; lint/test gates. |
| Cross-user access | Partition `/userId`; identity from token, never the body. |
| Stolen account | Attacker can spend only that user's **own** Azure quota; run-rate + concurrency caps; key is rotatable via `PUT`. |
| KEK compromise | Rotate KEK in Key Vault; `kekVersion` enables lazy re-wrap on next write. |

---

## 3. Run engine (Durable Functions)

### 3.1 Topology

```mermaid
flowchart TD
    SUBMIT[HTTP: POST /threads/id/runs] -->|append user msg, create Run(queued), start| ORCH
    ORCH[[Orchestrator: runConversation]] --> A1[Activity: loadContext\n(history + settings + creds)]
    ORCH --> A2[Activity: runModelTurn\n(stream call → incremental Cosmos upserts)]
    A2 -->|tool calls?| A3[Activity: executeTool\n(web/image/file/code/app)]
    A3 --> ORCH
    A2 -->|final| A4[Activity: finalizeMessage\n(status complete/error, release lock)]
    CANCEL[HTTP: DELETE /runs/runId] -. raiseEvent 'cancel' .-> ORCH
```

- **Orchestrator (`runConversation`)** is deterministic: it sequences activities and loops
  the agent turns; it holds no secrets and does no I/O directly.
- **Activities** do all side effects (Azure OpenAI calls, tool execution, Cosmos/Blob
  writes, credential decryption). At-least-once → all writes are **idempotent upserts**
  keyed by the (stable) assistant message id.
- **`runModelTurn`** consumes the streamed Responses/chat call and **upserts the evolving
  assistant message to Cosmos** on a throttle (≈ every 500–800 ms or N tokens), so a polling
  client sees progress. It returns the turn outcome (text, tool calls, usage).
- **Image generation** is an activity that decodes base64 → uploads to Blob → records
  `blobPath` on the message. A locked phone cannot lose it.

### 3.2 Run record — `runs` container (partition `/threadId`)

```jsonc
{
  "id": "<runId>", "threadId": "...", "userId": "...",
  "assistantMessageId": "<stable id>",      // the message the run is producing
  "status": "queued|running|complete|error|canceled",
  "instanceId": "<durable instance>",        // to query/terminate
  "tools": ["web_search","image_generation"],// allowlist for THIS run
  "error": { "code": "...", "message": "..." } | null,
  "createdAt": "ISO", "startedAt": "ISO?", "endedAt": "ISO?",
  "heartbeatAt": "ISO"                        // for stale detection
}
```

### 3.3 State machine

```
queued ──start──▶ running ──finish──▶ complete
   │                 │  ├─ error ─▶ error
   │                 │  └─ cancel ─▶ canceled (message → interrupted)
   └─ (validation fail) ─▶ error
```

- **Lock = "no active run on this thread."** `POST /runs` rejects with `409 conflict` if a
  `queued|running` run exists for the thread. This replaces the client-coordinated lock with
  a server-authoritative one (reuses the existing lock UX on the client).
- **Cancellation:** client `DELETE /runs/{runId}` raises a `cancel` external event; the
  orchestrator stops the loop and finalizes the message as `interrupted`.
- **Crash recovery:** Durable replays the orchestrator and re-runs incomplete activities
  after a host restart; idempotent upserts make this safe → the run **resumes**, satisfying
  "completes regardless of the client (or the host)."
- **Timeouts/retries:** per-activity timeout (image ≤ ~180 s fits a single activity);
  network/5xx/429 retried with backoff inside the activity; a hung run is failed by a
  monitor when `heartbeatAt` goes stale.

---

## 4. Tools & the destructive-action policy

Tools execute in `executeTool` activities (ported from `src/ai/tools/*`):
`web_search` (Tavily key from the vault), `image_generation`, `file_search` (Foundry vector
store), `code_interpreter` (Responses server tool), `search_history`, `get_thread_summary`,
`add_memory`, `create_thread`.

**Destructive tools** (`delete_thread`, `update_setting`) have no interactive confirmation
server-side. Policy:
- **Default: disabled** in autonomous runs.
- **Opt-in per run:** the client may pass an `allowDestructive` allowlist in `POST /runs`
  (e.g. the user explicitly asked "delete this thread"), scoped to that single run and
  re-validated server-side.
- Every destructive execution is recorded on the message's tool-activity log for auditability.

---

## 5. Live updates to the open client

Source of truth is Cosmos; live streaming is delivered via **Azure SignalR Service**.

- **Push (primary):** each run activity emits token/tool/image deltas to a per-run SignalR
  group (`run:{runId}`); the open client subscribes via a negotiated SignalR connection and
  renders the assistant message in real time. The client gets a connection from
  `POST /signalr/negotiate` (auth-gated) and joins the groups for the threads it is viewing.
- **Poll (reconnect/replay fallback):** on (re)open or if the socket drops, the client reads
  `GET /threads/{id}/runs/{runId}` + message deltas via the existing sync, so no update is
  ever lost — Cosmos remains authoritative.

The existing `orderAt` chronology and message-merge logic on the client are reused verbatim
— the assistant message simply arrives via sync instead of a local `runStore`.

---

## 6. Data-model additions

| Container | Partition | New? | Purpose |
| --- | --- | --- | --- |
| `credentials` | `/userId` | **new** | Ciphertext AOAI/Tavily creds + non-secret config. |
| `runs` | `/threadId` | **new** | Run lifecycle records (status, instanceId, tools). |
| `messages` | `/threadId` | existing | Now **written by the server**; `status` flows `streaming → complete/error/interrupted`; assistant content upserted incrementally. |
| `threads` | `/userId` | existing | `lock` field retained but now reflects the server run (or is derived from an active `runs` row). |

Message schema is unchanged on the wire (reuses `orderAt`, citations, toolCalls, images,
attachments). See [04-data-model.md](04-data-model.md).

---

## 7. Subsystem migration inventory (client → server)

Port `src/ai/*` to `api/src/ai/*` (Node fetch, server config source). Delete from the client
after cutover.

| Client module | Destination | Notes |
| --- | --- | --- |
| `ai/http.ts` | `api/src/ai/http.ts` | Bearer from vault; same timeouts/retries. |
| `ai/chat.ts`, `ai/responses.ts` | `api/src/ai/*` | Streamed in `runModelTurn`. |
| `ai/orchestrator.ts` | `api/src/application/runOrchestrator.ts` | Split into deterministic orchestrator + activities. |
| `ai/capabilities.ts` | `api/src/ai/capabilities.ts` | Probed server-side, cached per user. |
| `ai/image.ts` | `api/src/ai/image.ts` | Activity uploads to Blob. |
| `ai/transcribe.ts`, `ai/tts.ts` | `api/src/ai/*` | Async transcription in-run; TTS on demand. |
| `ai/tavily.ts`, `ai/fileSearch.ts` | `api/src/ai/*` | Keys/stores from vault/thread. |
| `ai/tools/*` | `api/src/ai/tools/*` | Executed in `executeTool`; destructive gated (§4). |
| `data/secureStore.ts` | **deleted** | Replaced by the credential vault + status API. |
| `features/chat/runStore.ts` | **deleted** | Replaced by `POST /runs` + sync rendering. |

Client keeps: rendering, sync engine, drafts/attachments, settings UI (now writes
credentials server-side), and the live-voice client (ephemeral-token).

---

## 8. API surface (new/changed)

| Method | Route | Purpose |
| --- | --- | --- |
| `PUT`/`GET`/`DELETE` | `/credentials`, `/credentials/status` | Vault (write-only) (§2.3). |
| `POST` | `/credentials/realtime-token` | Ephemeral live-voice token. |
| `POST` | `/threads/{id}/runs` | Submit prompt → append user msg, create Run, start orchestration; `202 { runId }`. |
| `GET` | `/threads/{id}/runs/{runId}` | Run status + progress. |
| `DELETE` | `/threads/{id}/runs/{runId}` | Cancel (→ interrupted). |
| `GET` | `/threads/{id}/runs?active=1` | Resume view: any in-flight run on open. |

Existing message/thread/settings/asset/invite/thread-lock endpoints remain; `appendMessage`
stays for sync/back-compat but user prompts now flow through `/runs`.

---

## 9. Security checklist (OWASP-aligned, gating release)

- [ ] No endpoint returns a decrypted secret (asserted in tests).
- [ ] Secret encrypted before any logger/await; redacted in errors/telemetry.
- [ ] Key Vault reached via Managed Identity; KEK never in app config or client.
- [ ] Cosmos access partitioned by `/userId`; identity from token only.
- [ ] Destructive tools disabled unless per-run allowlisted + re-validated.
- [ ] Run-rate + per-thread concurrency limits enforced.
- [ ] SAS for assets remains short-lived, scoped, read-only for the client.
- [ ] Realtime ephemeral token is short-TTL and endpoint-scoped.

---

## 10. Phased migration plan (EDD-gated, backward compatible)

Each phase ships behind a flag, is independently deployable, and has an eval/acceptance gate
(EDD per the repo's delivery conventions). Backend deploys precede frontend.

### Phase 0 — Spikes & decisions (no user impact)
- Validate **Durable Functions** on the existing Node Functions app; confirm streaming
  inside an activity + incremental Cosmos upserts; confirm **Key Vault + Managed Identity**
  wrap/unwrap.
- Decide the open questions in §11.
- **Gate:** a throwaway orchestration generates an image and writes it to Cosmos/Blob with
  the host killed mid-run and resuming.

### Phase 1 — Credential vault (additive)
- `credentials` container + envelope encryption + Key Vault KEK (Managed Identity).
- `PUT/GET status/DELETE /credentials`; settings UI writes the key server-side (still also
  kept locally for now, so v1 client generation keeps working).
- **Gate:** key round-trips (encrypt→store→decrypt in a test activity); `status` never leaks;
  security checklist §9 items for creds pass.

### Phase 2 — Run engine behind a flag
- Durable orchestration + activities; port `ai/*` and `tools/*` to `api/`.
- `POST /threads/{id}/runs` etc.; server enforces the run lock; incremental message upserts.
- Flag `serverRuns` (per-user) routes the composer to `/runs`; default off.
- **Gate (the core EDD):** with `serverRuns` on, submit a prompt, **close the tab**, reopen
  on another device → the completed message is present and correctly ordered; image
  generation survives a simulated lock/disconnect; cancel works.

### Phase 3 — Cutover
- Default `serverRuns` on; composer always uses `/runs`; client `runStore`/`ai/*` no longer
  invoked. Live updates via poll (SignalR optional).
- One-time migration: prompt users to confirm their server-stored key; stop writing the key
  locally.
- **Gate:** mobile failure-rate for image generation drops to ~persistence-only levels;
  no regression in chronology/lock evals.

### Phase 4 — Decommission client generation
- Delete `src/ai/*`, `data/secureStore.ts`, `features/chat/runStore.ts`; remove the local
  key entirely; live voice switches to the ephemeral-token flow.
- **Gate:** clean build with the AI client code removed; security checklist fully green.

---

## 11. Decisions (locked 2026 — best-UX, no-compromise)

All resolved toward the best experience supported by the subscription.

| # | Decision | **Locked choice** |
| --- | --- | --- |
| K1 | Credential encryption | **Key Vault KEK + per-record wrapped DEK** (AES-256-GCM envelope). Strongest at-rest model. |
| K2 | Live updates | **Azure SignalR Service** push for token-level streaming; polling kept only as a reconnect/replay fallback. |
| K3 | Hosting tier | **Functions + Durable + SignalR Service** (SignalR output binding works on the existing plan; no SSE needed). |
| K4 | Realtime voice | **Server-minted ephemeral token** (`POST /credentials/realtime-token`); the key never reaches the browser. |
| K5 | Run quotas | **3 concurrent runs/user**, **200 runs/user/day** (configurable app settings); 1 active run per thread. |
| K6 | Transcription | **Server transcription endpoint** for fast dictation-into-composer **and** run-time async transcription of attached audio — both server-side (no client key). |

---

### Appendix — why this is the only architecture that meets the requirement

Client tabs are evictable and network-bound; mobile OSes freeze/kill backgrounded or locked
pages and their in-flight requests. The only process that can finish a generation after the
client is gone is one the client does not own. That process must authenticate to Azure
OpenAI, which requires the credential to be reachable server-side. Hence: **encrypted
server-side credentials + a durable server run engine** — everything else in this document
follows from that single constraint.
