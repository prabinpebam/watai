# 03 — Azure OpenAI Integration (server-side)

> **Rewritten for the server-authoritative direction.** Azure OpenAI is now called by the
> **server** (the Durable run engine), never the browser. The previous client-side
> contracts are archived at
> [archive/03-api-integration-v1-byo-client.md](archive/03-api-integration-v1-byo-client.md).
> The run engine and credential handling are detailed in
> [06-server-runs-and-migration.md](06-server-runs-and-migration.md).

This document specifies **how Watai calls Azure OpenAI from the server**: the shared HTTP
conventions, per-capability endpoints, and which surface invokes each. Model names are
**deployment names** the user configures, stored server-side (encrypted).

Cross-references: [02-architecture.md](02-architecture.md) ·
[06-server-runs-and-migration.md](06-server-runs-and-migration.md) ·
[azure-api-detail/azure-api-detail.md](azure-api-detail/azure-api-detail.md).

---

## 1. Where calls originate

| Capability | Endpoint (Azure OpenAI `…/openai/v1`) | Invoked by |
| --- | --- | --- |
| Chat / agent loop | `POST /responses` (preferred) or `/chat/completions` | **Run activity** (server) |
| Image generation/edit | `POST /images/generations`, `/images/edits` | **Run activity** (server) |
| Transcription (async) | `POST /audio/transcriptions` | **Run activity** (server) — when a voice note is attached to a prompt |
| Text-to-speech (read-aloud) | `POST /audio/speech` | **API** on demand (server) → returns audio asset |
| Live voice (Realtime) | Realtime socket | **Client**, using a server-minted ephemeral token ([02](02-architecture.md) §8) |

Everything except the live-voice transport is a **server** call. The browser only calls
the Watai API (Functions), never Azure OpenAI directly.

---

## 2. Shared server HTTP layer

A single Node HTTP layer (ported from the client `ai/http.ts`) wraps every capability:

- **Auth:** `Authorization: Bearer <decrypted user key>` — the key is read from the
  credential service in-memory for the duration of the call, then dropped.
- **Base URL:** the user's configured `…/services.ai.azure.com/openai/v1` (or the
  cognitive-services host for transcription), resolved from stored credentials.
- **Timeouts** per capability (chat/stream long; image longest — up to ~180 s; transcription
  bounded). Because the call runs in a Durable **activity**, the orchestration is not
  blocked and is checkpointed; a host recycle resumes the orchestration.
- **Retries:** idempotent failures (network, 5xx, 429) with exponential backoff + jitter,
  honoring `Retry-After`. Non-idempotent mutations are retried at most once.
- **Streaming:** the run activity consumes the SSE stream and writes incremental message
  updates to Cosmos (so the open client can poll/stream them). See
  [06](06-server-runs-and-migration.md) §3 and §5.
- **No secret logging:** keys and full prompts are redacted from logs/telemetry; errors are
  normalized before surfacing.

---

## 3. Request shapes (unchanged on the wire)

The Azure OpenAI request/response bodies are the same as v1 — only the **caller** changed
from browser to server. The canonical examples remain in
[azure-api-detail/azure-api-detail.md](azure-api-detail/azure-api-detail.md):

- **Chat/agent:** `POST /responses` with `tools` (web_search, code_interpreter,
  file_search, image_generation, plus app function-tools) and `stream: true`.
- **Image:** `POST /images/generations { model, prompt, size, n, output_format,
  output_compression }` → `{ data: [{ b64_json }] }`. The run activity decodes the base64,
  uploads the PNG to Blob, and records the `blobPath` on the message — so a locked phone
  never loses the image.
- **Transcription / TTS:** multipart upload / audio response, as before.

---

## 4. Capability detection

Capability probing (Responses vs chat-completions, image, file-search availability) moves
to the server and is computed from the **stored** credentials, cached per user with a short
TTL. The client reads capability flags via `GET /credentials/status` (or a `GET
/capabilities` endpoint) to drive which tool toggles it shows — it never probes Azure
OpenAI itself.

---

## 5. Tools (server-executed)

The agent's tools now execute inside run activities (ported from `src/ai/tools/*`):
`web_search` (Tavily key from the vault), `image_generation`, `file_search` (Foundry vector
store), `code_interpreter` (Responses server tool), plus app tools (`search_history`,
`get_thread_summary`, `add_memory`, `create_thread`, …). The **destructive** subset
(`delete_thread`, `update_setting`) is governed by the server policy in
[06](06-server-runs-and-migration.md) §4 (disabled in autonomous runs unless explicitly
pre-authorized), because there is no interactive confirmation server-side.

---

## 6. Errors

Azure OpenAI errors are normalized server-side into the app's stable error envelope
(`{ code, message }`), persisted on the failed message (`status: "error"`) so the client
shows a retryable error on next sync — exactly as it would have for a client-side failure,
but now durable.
