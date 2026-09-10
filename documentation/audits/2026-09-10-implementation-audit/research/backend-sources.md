# Backend primary-source research ledger

**Access date: 2026-09-10.** These 15 sources were fetched and their relevant sections read during this audit. Research used public documentation only; no repository content, credentials, conversations, or customer data were submitted to external services. Dates below distinguish the publisher's visible `ms.date` from the separately exposed `updated_at` metadata. Neither establishes that every statement was substantively revised on that date.

“Current” means the documentation available on the access date, not an exhaustive search of everything published by then. OWASP pages did not expose a reliable publication/update date in the retrieved text. Some Microsoft pages contain feature-specific caveats or legacy examples; those caveats are retained rather than silently transferring a guarantee to Watai.

Category mappings: **C04** backend architecture/maintainability; **C05** durability/concurrency; **C06** AI/tool execution; **C09** security/privacy; **C10** assets/data lifecycle. Findings and baseline code evidence are in `..\03-backend-audit.md`.

## B01 — Azure Queue storage trigger for Azure Functions

- **Publisher/title:** Microsoft Learn, *Azure Queue storage trigger for Azure Functions*.
- **URL:** <https://learn.microsoft.com/en-us/azure/azure-functions/functions-bindings-storage-queue-trigger>
- **Visible dates:** `ms.date` 2023-04-04; `updated_at` 2026-07-21.
- **Read:** TypeScript v4 example, metadata, poison messages, peek lock, polling, concurrency, connections.
- **Supports:** Failed queue-trigger executions are retried, by default five attempts including the first, then sent to the named poison queue. Successful execution deletes the message. A host crash can leave a message invisible for ten minutes. Queue batching and scale-out permit concurrent work; batch size one is not a distributed singleton.
- **Applicability:** BE-03/04 distinguish Watai's run identity and business-side-effect idempotency from transport delivery. A returned application error record is not a thrown queue-trigger failure.
- **Caveat:** The page says the trigger prevents simultaneous processing of one queue message. This audit does **not** assert that one healthy host routinely executes that identical message twice. Duplicate jobs, retries after interrupted execution, and distinct concurrent submissions are separate concerns.
- **Categories:** C04, C05.

## B02 — Azure Functions scale and hosting

- **Publisher/title:** Microsoft Learn, *Azure Functions Scale and Hosting*.
- **URL:** <https://learn.microsoft.com/en-us/azure/azure-functions/functions-scale>
- **Visible dates:** `ms.date` 2025-12-09; `updated_at` 2026-08-12.
- **Read:** Hosting overview, function timeout duration, timeout table and its footnotes, scale overview.
- **Supports:** Function execution deadlines are configured through `functionTimeout`; exceeding a deadline can restart the language worker. Traditional Consumption has a five-minute default and ten-minute maximum; other plans have different limits and scale-in/platform-update grace periods. HTTP requests have a separate 230-second response constraint.
- **Applicability:** BE-04/06: an in-process generation loop must tolerate termination even when the initiating browser disconnecting is harmless. Deadlines should cover provider body consumption and finalization, not just HTTP headers.
- **Caveat:** No deployed plan, timeout, or live behavior was inspected. The table is conditional provider guidance, not a claim about Watai's actual hosting choice. No hosting migration is required merely because a newer plan exists.
- **Categories:** C04, C05.

## B03 — Cosmos transactions and optimistic concurrency

- **Publisher/title:** Microsoft Learn, *Database Transactions and Optimistic Concurrency Control — Azure Cosmos DB*.
- **URL:** <https://learn.microsoft.com/en-us/azure/cosmos-db/database-transactions-optimistic-concurrency>
- **Visible dates:** `ms.date` 2025-07-07; `updated_at` 2026-04-27.
- **Read:** Transactions, multi-item transactions, ETag/If-Match, global-distribution qualifications.
- **Supports:** ACID transactions are scoped to a container's logical partition. An explicitly supplied matching ETag enables conditional updates; a stale If-Match is rejected with 412. Merely reading an old value and upserting does not protect against lost updates.
- **Applicability:** BE-01/03/04/05/11/14. Watai's separate thread, message, and run containers cannot be treated as one atomic unit simply because some records contain the same thread ID. Its existing conditional thread-lock adapter supplies a useful migration seam.
- **Caveat:** This does not prove all uses of upsert are wrong. Idempotent materialized views can appropriately use upsert; admission, ownership, and terminal-state transitions need stronger invariants.
- **Categories:** C04, C05, C09, C10.

## B04 — SignalR disconnections and reconnection

- **Publisher/title:** Microsoft Learn, *Understanding Client Disconnections and Reconnection in Azure SignalR service*.
- **URL:** <https://learn.microsoft.com/en-us/azure/azure-signalr/signalr-concept-client-disconnections>
- **Visible dates:** `ms.date` 2025-10-29; `updated_at` 2025-12-23.
- **Read:** Entire guidance, including stateful reconnect, new connection IDs, and serverless qualification.
- **Supports:** Disconnections are expected. Applicable stateful reconnect can recover a brief window with the same connection ID; new connections need application state restoration and retrieval of missed data from an application store/event log.
- **Applicability:** BE-14/15. Persisted assistant snapshots are a sound foundation, but best-effort push alone is not durable replay; timestamp cursors must converge after reconnection.
- **Caveat:** No claim that stateful reconnect is enabled, supported by Watai's exact client/server combination, or a substitute for database synchronization.
- **Categories:** C04, C05.

## B05 — Azure OpenAI Responses API

- **Publisher/title:** Microsoft Learn, *Use the Azure OpenAI Responses API*.
- **URL:** <https://learn.microsoft.com/en-us/azure/foundry/openai/how-to/responses?view=foundry-classic>
- **Visible dates:** `ms.date` 2026-08-18; `updated_at` 2026-08-18. The served model list included September 2026 model-version entries; page metadata is not used as a per-feature release date.
- **Read:** Prerequisites/regions/models and limitations; response retrieval/deletion; compaction; streaming errors; function calling; Code Interpreter containers/limits; image/file inputs; background start/poll/cancel/resume; background limitations; encrypted reasoning.
- **Supports:** Availability is model/region/API dependent, not inferable from a hostname alone. Midstream errors can arrive inside HTTP 200 streams, including an event whose type is `error`. Response data is retained for 30 days by default. Background tasks have response IDs, polling, cancellation and resumable sequence positions; they require `store=true`, have higher first-token latency, and currently have streaming performance caveats. Synchronous cancellation requires closing the connection. Code Interpreter containers are ephemeral, with a 20-minute idle expiry; a request can include up to 50 file IDs and containers have separate charges.
- **Applicability:** BE-04/06/09/11/12/15: Watai uses ordinary streaming and in-memory response chaining, not the provider's background/replay contract. Background mode is an option to evaluate, not an automatic fix.
- **Caveat:** Provider retention is not a promise that Watai deletes all other copies at day 30. Azure-specific claims are not imported from OpenAI's non-Azure service. Tool availability and cost require the actual deployment's configuration.
- **Categories:** C05, C06, C09, C10.

## B06 — Web-Queue-Worker architecture

- **Publisher/title:** Microsoft Azure Architecture Center, *Web-Queue-Worker Architecture Style*.
- **URL:** <https://learn.microsoft.com/en-us/azure/architecture/guide/architecture-styles/web-queue-worker>
- **Visible dates:** `ms.date` 2026-01-06; `updated_at` 2026-06-12.
- **Read:** Architecture, suitability, benefits, challenges, and best practices.
- **Supports:** Separating HTTP work from resource-intensive asynchronous work is appropriate for relatively simple managed-service applications. Large worker/front-end components and hidden shared-schema dependencies are explicit risks. A database write followed by a queue send has a consistency gap; transactional outbox is a suggested remedy.
- **Applicability:** C04 rating credits Watai's chosen shape without recommending a microservice rewrite. BE-04/15 target its actual coordination and responsibility boundaries.
- **Caveat:** Architecture guidance supplies tradeoffs, not measured Watai reliability or an obligation to adopt a particular framework.
- **Categories:** C04, C05.

## B07 — OWASP prompt injection

- **Publisher/title:** OWASP GenAI Security Project, *LLM01: Prompt Injection*.
- **URL:** <https://genai.owasp.org/llmrisk/llm01-prompt-injection/>
- **Visible date:** No reliable publication/update date exposed in fetched text; current retrieved project guidance.
- **Read:** Direct/indirect and multimodal injection, mitigations, contextual impact and examples.
- **Supports:** External websites/files and images can influence model behavior; RAG and fine-tuning do not eliminate the issue. Separate untrusted content, validate outputs deterministically, constrain privileges, and require approval for high-impact actions. No foolproof prompt-only prevention is established.
- **Applicability:** BE-09/12: search results and user skills enter a tool-capable context. Recommendations concern deterministic authorization, not claims that a malicious prompt was demonstrated against Watai.
- **Caveat:** The examples are OWASP examples, not Watai incidents. A risk category alone is not evidence of exploitability in this application.
- **Categories:** C06, C09.

## B08 — OWASP excessive agency

- **Publisher/title:** OWASP GenAI Security Project, *LLM06:2025 Excessive Agency*.
- **URL:** <https://genai.owasp.org/llmrisk/llm062025-excessive-agency/>
- **Visible date:** 2025 edition identified by page URL; no reliable page-update date exposed.
- **Read:** Root causes, excessive functionality/permissions/autonomy, prevention, damage limitation.
- **Supports:** Model-generated calls must remain subject to downstream authorization and complete mediation. Offer only necessary functions, use user-scoped privileges, add human approval for high-impact operations, and use rate limits/monitoring to bound damage.
- **Applicability:** BE-12 credits Watai's small executor surface and user credentials while distinguishing its optional confirmation abstraction from a wired enforcement policy.
- **Caveat:** Current custom executors are search and image operations; this source does not justify claiming Watai exposes arbitrary administrative or shell operations on its Functions host.
- **Categories:** C06, C09.

## B09 — OWASP SSRF prevention

- **Publisher/title:** OWASP Cheat Sheet Series, *Server-Side Request Forgery Prevention Cheat Sheet*.
- **URL:** <https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html>
- **Visible date:** Undated in retrieved content.
- **Read:** Context, trusted-destination and arbitrary-destination cases, URL/domain/IP validation, DNS-pinning concerns, redirects and network-layer defenses.
- **Supports:** User-controlled fetch destinations need explicit application and network boundaries; trusted endpoints can use allowlists. URL-string checks alone do not ensure the connection's resolved address is public, and redirects can bypass validation.
- **Applicability:** BE-07 contrasts Watai's image URL checker with its unrestricted credential base URL and identifies where approved egress policy belongs.
- **Caveat:** Live DNS, Azure egress, metadata endpoints and internal hosts were not queried. Reachability and practical impact remain conditional.
- **Categories:** C09.

## B10 — Microsoft identity claims validation

- **Publisher/title:** Microsoft Learn, *Secure applications and APIs by validating claims*.
- **URL:** <https://learn.microsoft.com/en-us/entra/identity-platform/claims-validation>
- **Visible dates:** `ms.date` 2025-03-21; `updated_at` 2026-06-15.
- **Read:** Entire article: audience, tenant, subject and actor.
- **Supports:** Validate audience and appropriate tenant/subject/actor; immutable `tid`/`oid` are suitable authorization identifiers. The explicit warning says not to authorize using email, preferred_username, unique_name or UPN. Delegated operation permissions should be checked through scopes; app-only and ID-token cases differ.
- **Applicability:** BE-08 distinguishes strong JWT cryptographic validation from mutable-email invite/admin authorization and missing explicit access-token scope policy.
- **Caveat:** An exact configured issuer already constrains tenant identity; absence of a separate `tid` check is not asserted to be a proven tenant bypass. Issued-token shapes and identity-provider account controls were not inspected.
- **Categories:** C09.

## B11 — Envelope encryption with Key Vault

- **Publisher/title:** Microsoft Learn, *Client-side encryption for blobs — Azure Storage*.
- **URL:** <https://learn.microsoft.com/en-us/azure/storage/blobs/client-side-encryption>
- **Visible dates:** `ms.date` 2024-10-03; `updated_at` 2026-05-04.
- **Read:** Encryption versions, envelope-encryption/decryption steps, key identifiers/resolution and Key Vault caching/throttling considerations.
- **Supports:** Envelope encryption generates a one-time content key, encrypts data, wraps the content key under a KEK, and preserves metadata/key identity needed for decryption. Key resolution and availability are part of the design, not just cipher selection.
- **Applicability:** Credits `domain\crypto.ts` and versioned Key Vault unwrapping; informs BE-16's operational refresh/recovery proposal.
- **Caveat:** This describes Azure's Blob SDK encryption implementation. Watai implements its own credential envelope, not that SDK blob format. No SDK certification, automatic key rotation, or automatic encryption of Watai's conversation/library records is inferred.
- **Categories:** C04, C09.

## B12 — Blob lifecycle management

- **Publisher/title:** Microsoft Learn, *Azure Blob Storage lifecycle management overview*.
- **URL:** <https://learn.microsoft.com/en-us/azure/storage/blobs/lifecycle-management-overview>
- **Visible dates:** `ms.date` 2025-09-15; `updated_at` 2026-08-25.
- **Read:** Policy features/execution, current/previous-version/snapshot deletion, billing and limitations.
- **Supports:** Policies can target prefixes/tags and versions/snapshots; activation and processing are asynchronous. Soft-delete retention and immutable-container constraints affect deletion. Lifecycle processing is not an immediate application-level multi-store transaction.
- **Applicability:** BE-10/11/13: a reconciler plus explicit ownership/reference rules is needed; an age-based policy must not delete still-referenced Library content.
- **Caveat:** No actual lifecycle, retention, versioning or immutability settings were inspected. This is not a legal determination of erasure compliance.
- **Categories:** C10.

## B13 — Shared access signature guidance

- **Publisher/title:** Microsoft Learn, *Grant limited access to data with shared access signatures (SAS)*.
- **URL:** <https://learn.microsoft.com/en-us/azure/storage/common/storage-sas-overview>
- **Visible dates:** `ms.date` 2026-02-27; `updated_at` 2026-02-27.
- **Read:** SAS types/authorization, direct-upload tradeoffs, best practices.
- **Supports:** Prefer user-delegation SAS, HTTPS, narrow resources/permissions and short validity; plan for renewal/revocation. A SAS is a bearer capability and does not itself enforce application business rules or declared file size. Validate uploads before application use; storage/egress costs still accrue.
- **Applicability:** Credits Watai's HTTPS single-blob grants; BE-02/13/17 cover owner validation, actual-content verification and promised lifetime.
- **Caveat:** A user-delegation SAS minted by Watai's managed identity is not automatically bound to the logged-in Watai user. Keeping a path out of a DTO does not replace authorization of that path.
- **Categories:** C09, C10.

## B14 — File-search lifecycle guidance, explicitly classic

- **Publisher/title:** Microsoft Learn, *How to use Azure OpenAI Assistants file search (classic)*.
- **URL:** <https://learn.microsoft.com/en-us/azure/foundry-classic/openai/how-to/file-search?view=foundry-classic>
- **Visible dates:** `ms.date` 2026-08-21; `updated_at` 2026-08-26.
- **Read:** Upload/poll/readiness, vector-store operations, underlying file deletion, billing and expiration.
- **Supports:** File ingestion is asynchronous; callers should observe completion. Files and vector-store associations have distinct lifecycles; deleting an underlying file can affect multiple associations. Vector storage has costs distinct from model tokens.
- **Applicability:** BE-09/11's state/ownership model. Watai explicitly creates v1 vector stores and uploads `purpose=assistants` files.
- **Caveat:** The fetched page labels itself **classic**, and contains an Assistants retirement notice. Watai's own queue runs are **not** Assistants runs. Do not transplant the classic automatic seven-day thread-helper expiry, 60-second run wait, retirement notice or assistant/thread store-count limits onto Watai's Responses implementation. B05 is the current Responses contract; v1 Files/Vector Stores support needs its own deployment contract tests.
- **Categories:** C06, C10.

## B15 — User-delegation SAS protocol details

- **Publisher/title:** Microsoft REST reference, *Create a user delegation SAS*.
- **URL:** <https://learn.microsoft.com/en-us/rest/api/storageservices/create-user-delegation-sas>
- **Visible dates:** `ms.date` 2024-10-08; `updated_at` 2026-04-30.
- **Read:** Delegation authorization, key lifetime fields, signed response-header overrides, newer user-bound/header-binding qualifications.
- **Supports:** SAS permissions intersect with the signing principal's permissions; `ske` defines the delegation key's expiry. `rsct` overrides the response Content-Type rather than validating the blob's stored MIME. Newer user-bound/header-binding features have version/preview requirements.
- **Applicability:** BE-13 identifies why a HEAD using Watai's MIME-override read SAS cannot independently verify the stored MIME. BE-17 requires the grant expiry to fit the signing key's lifetime.
- **Caveat:** No claim that preview user-bound SAS is enabled or suitable for an AI provider fetching an image without the end user's Entra token. Do not adopt newer protocol features without SDK/service-version verification.
- **Categories:** C09, C10.

## Score-to-research traceability

| Category | Sources actually read and used | Judgment informed |
| --- | --- | --- |
| C04 | B03, B06, B11; supporting B01/B02/B04 | Sound layered web/queue design; missing coordination and operational contracts, not a need for microservices |
| C05 | B01, B02, B03, B04, B05, B06 | Queue delivery versus business idempotency, OCC, shutdown, cancellation and durable replay |
| C06 | B05, B07, B08, B14 | Provider capabilities versus application guarantees, strict tool mediation, bounded context and file readiness |
| C09 | B03, B07, B08, B09, B10, B11, B13, B15 | Owner namespaces, authorization, egress, prompt trust and the actual limits of envelope/SAS protection |
| C10 | B03, B05, B12, B13, B14, B15 | Explicit multi-store lifetimes, readiness, retention, content verification and download validity |

These mappings exceed the two-primary-reference minimum for every category. External sources establish constraints and alternatives; **all Watai scores remain implementation judgments**, not scores supplied by Microsoft or OWASP.
