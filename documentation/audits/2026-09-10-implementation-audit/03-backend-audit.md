# Non-memory backend implementation audit

**Baseline:** `f7dc195300c4039aae5b9a7a8fb1691327864ea1`  
**Audit/research date:** 2026-09-10  
**Scope:** application services/workers, domain/ports/adapters, HTTP/auth/composition, provider clients, orchestration, tools, skills, images, documents and Library. Memory algorithms and frontend implementation are assessed separately. Delivery/test execution belongs to the delivery audit.

## Executive assessment

Watai has a useful, understandable foundation: thin HTTP adapters, testable services, owner-partitioned stores, encrypted write-only credentials, asynchronous generation, incremental persisted replies, and explicit asset provenance. This is not merely a browser calling an LLM. Its architectural direction is appropriate for a personal/private beta.

The central problem is **a gap between intended guarantees and enforced guarantees**. “One active run,” “idempotent,” “cancel,” “thread-owned,” “bounded,” and “deleted” each have implementations that work in the normal sequential case but fail to establish the stronger meaning suggested by their comments or APIs. The highest-priority work is therefore ownership and state-transition correctness, not adding more agent capabilities.

Two especially important static findings are owner-unqualified child partitions despite caller-supplied thread IDs, and accepting raw blob references that are later signed with the application's storage authority. These are concrete authorization-boundary defects in the reviewed implementation; this audit did **not** execute an exploit, inspect another user's data, or establish a production incident.

### Ratings

Scores are whole-number engineering judgments, not measured efficacy: **0 absent; 2 prototype; 4 functional with material gaps; 6 credible personal beta; 8 production-proven; 10 exemplary sustained evidence**. An attractive average cannot waive the isolation, deletion or execution gates.

| Category | Score /10 | Basis and limiting evidence | Primary research |
| --- | ---: | --- | --- |
| **C04 Backend architecture/maintainability** | **6** | Good layers, dependency seams and managed-service fit; a 1,297-line run worker, duplicated HTTP logic and non-enforced state contracts raise change risk. | B03, B06, B11 |
| **C05 Durability/concurrency** | **4** | Queue execution and stable assistant IDs survive browser loss; atomic admission, durable handoff, leases, cancellation fencing and cursor ordering remain incomplete. | B01–B06 |
| **C06 AI/tool execution** | **5** | Real tool loop, structured routing, required-action checks and artifact capture; incomplete stream terminal handling, runtime capability assumptions and incomplete resource budgets. | B05, B07, B08, B14 |
| **C09 Security/privacy** | **4** | JWT verification, invite gates, owner reads, envelope encryption and narrow SAS are valuable; child namespaces, raw references, endpoint policy and mutable-email authorization prevent strong isolation claims. | B03, B07–B11, B13, B15 |
| **C10 Assets/data lifecycle** | **4** | Account Library, source IDs, safe DTOs, direct uploads and cleanup exist; deletion is not coordinated across stores and providers, and verification/readiness can remain incomplete. | B03, B05, B12–B15 |

The [backend source ledger](research/backend-sources.md) contains **15 actually read primary references**, dates, supported claims and applicability caveats. Each category has at least two. Current Microsoft guidance explicitly discusses outbox failure windows, new-connection replay, Responses background limitations and lifecycle delays; those provider capabilities are **not** attributed to Watai.

## Evidence boundaries and strengths

Discovery identified 229 backend TypeScript files including tests, not 229 production modules. Investigation followed the complete submission → queue → worker → provider → persistence chain, plus credential/authentication, storage grants, file/skill provisioning, Library ingestion, deletion and synchronization paths. Relevant tests were read to understand what their assertions actually prove. This is risk-driven deep review, not a claim that every line has been formally verified.

**Citation convention:** paths are relative to the repository or `api\src`. Unqualified `runWorker.ts`/`imageWorker.ts` mean the application workers, not function entry points; unqualified `*Store.ts` mean Cosmos adapters; `sasMinter.ts` means the Azure adapter. Other abbreviated basenames are unique within `api\src`. All line ranges refer to the baseline above.

**Observed** below means directly established by baseline source or a read test assertion. **Risk** means a consequence under the stated conditions, not a live reproduction. Confidence concerns the stated code behavior, not its production frequency. No P0 is assigned because critical harm was not demonstrated. P1 means fix before expanding use or relying on the affected guarantee; P2 means planned correction; P3 is conditional optimization.

Preserve these strengths:

- `api\src\functions\api.ts:8–25,28–343` centralizes route registration and invite/admin gates. `http\azureFunctions.ts:42–61` authenticates and authorizes before reading the body. `composition.ts:109–121` fails closed when authentication is not configured.
- `adapters\auth\entraTokenVerifier.ts:37–47` verifies issuer, audience and RS256 signatures through `jose`, returning a generic failure. Its tests exercise invalid signatures, issuer/audience, expiry and malformed tokens (`entraTokenVerifier.test.ts:43–70`).
- `domain\crypto.ts:24–58` uses a fresh AES-256-GCM data key/nonce, wraps the data key and clears that key buffer. `adapters\azure\keyVaultWrapper.ts:34–44` records and uses the versioned wrapping key. Credential tests verify ciphertext-only persistence and non-secret status (`application\credentialService.test.ts:52–73`). This is server-side credential protection, not end-to-end conversation encryption.
- The HTTP request returns after enqueue rather than waiting for generation. Stable assistant IDs and persisted snapshots (`application\runWorker.ts:745–772`) are a good basis for reconnect recovery. The conditional thread-lock service demonstrates that optimistic concurrency is already understood (`application\threadLockService.ts:38–64`).
- Tool success is not entirely trusted to prose: `ai\orchestrator.ts:176–186,243–248` refuses a required action that did not succeed. Skill packaging validates structure and paths; artifact capture filters internal outputs and persists deliverables outside ephemeral containers.
- Library records have deterministic ingestion IDs, explicit states and provenance; DTOs omit internal paths and issue fresh grants. The dry-run inventory model distinguishes missing/orphaned blobs and incomplete provenance (`application\libraryInventory.ts:36–77,115–169`). It is useful groundwork, not evidence of a running repair service.

## Findings

### BE-01 — Child data is not namespaced by owner

**P1 · High confidence · Observed authorization defect; production impact untested · C09/C05**

`domain\thread.ts:7–14` permits a caller-supplied thread ID. `application\threadService.ts:20–42` checks uniqueness only inside that user's thread partition. `adapters\cosmos\threadStore.ts:5,13–16` indeed uses `/userId`. However, messages and runs use `/threadId`, and their list queries do not include owner identity (`adapters\cosmos\messageStore.ts:5,23–42`; `runStore.ts:5,13–35`).

Consequently, two users can own distinct parent records with the same ID while addressing the same child partition. `MessageService.list` merely checks that the caller owns *a* thread with that ID and then lists the shared partition (`application\messageService.ts:27–32,135–137`). The same issue affects active-run discovery, message-ID idempotency and thread message deletion.

**Impact condition:** duplicate thread IDs, whether imported, deliberately chosen, or otherwise reused. Random IDs from a normal client reduce accidental occurrence; they do not establish authorization. Existing cross-user tests create only one owner's parent (`messageService.test.ts:96–100,214–218`), so they do not test this condition.

**Proposal:** make the internal thread key owner-qualified, and require owner identity in all child-store operations. Alternatively, retain public client IDs but resolve them to server-issued globally registered internal IDs. Migrate and quarantine ambiguous existing child records rather than guessing ownership.

**Acceptance:** two synthetic users can independently create the same public ID, append identical message IDs, submit/list runs and delete a thread without observing, blocking or deleting each other's children. Include store-adapter and cascade tests, not only controller mocks. B03/B10 inform the partition and identity boundaries.

### BE-02 — Raw blob references bypass the safer Library ownership path

**P1 · High confidence · Observed missing mediation; disclosure risk conditional · C09/C10**

`domain\message.ts:9–20,145–159` accepts arbitrary bounded blob-path strings. `application\messageService.ts:43–63` resolves and validates an explicitly supplied `libraryItemId`, but returns attachments without that ID unchanged. It can then index a client-provided path containing `/library/` under the current user's Library (`96–119`); the Library schema checks state/shape, not path ownership (`domain\library.ts:143–201`).

Later, `runWorker.ts:336–343` signs image references through `composition.ts:309–313`, whose callback has no user argument or ownership lookup. Library DTO generation also signs its stored path (`application\libraryDto.ts:28–49`). The SAS minter uses the application's managed identity, not the caller's authorization over that particular object.

**Impact condition:** an accepted record references an existing object outside the caller's authorized asset set. No foreign blob was accessed in this audit. B13/B15 explain why a correctly signed, narrowly scoped SAS can still authorize the wrong object.

**Proposal:** accept opaque upload/reservation/Library IDs, resolve canonical paths server-side, and require an owner-bearing asset reference at every signing boundary. For legacy paths, validate exact namespace and recorded ownership before use; a string prefix alone is insufficient for shared/reused objects.

**Acceptance:** synthetic foreign, malformed, legacy and mismatched Library/path references are rejected before persistence or SAS minting; all legal same-owner reuse cases continue to work.

### BE-03 — “One run per thread” and submission idempotency are sequential checks

**P1 · High confidence · Observed race-prone implementation · C05**

`application\runService.ts:39–71` queries active runs, appends a user message and creates a fresh run ID in separate operations. Two submissions can both see no active run. Repeating a completed request with the same `clientMessageId` avoids a duplicate user row but still creates another paid run. The test named “rejects a second concurrent run” actually awaits the first submission before the second (`runService.test.ts:85–88`).

There is a second race at `runService.ts:73–75`: after sending the queue message, submission writes the original `queued` snapshot back with an instance ID. A fast worker can already have changed that record. `CosmosRunStore.put` is unconditional upsert. The domain transition table (`domain\run.ts:24–34`) is not enforced at this write boundary.

**Proposal:** atomically reserve an owner-qualified thread execution slot and idempotency key, bind the key to a canonical request hash, and return the original run on a same-request retry. Patch only permitted fields using conditional state/version checks. Define intentional regeneration as a new operation.

**Acceptance:** simultaneous submissions yield one admitted run; identical retries before and after completion return that run; changed payload under the same key conflicts; a worker started before enqueue acknowledgement cannot be overwritten to `queued`. B03 supports the required conditional writes, not the present check-then-upsert behavior.

### BE-04 — Queue transport is durable; the business workflow is not recoverably coordinated

**P1 · High confidence · Observed gaps; crash/cost consequences inferred · C05/C04**

Run persistence precedes enqueue (`runService.ts:71–75`), leaving a process-crash window that ordinary exception handling cannot repair. Image creation repeats this pattern (`application\imageService.ts:46–82`). Workers accept active records and start again without a claim token or persisted provider checkpoint (`runWorker.ts:697–702`; `imageWorker.ts:121–125`). Run heartbeat is written at start, not periodically renewed. No stale-run reconciler or run/image poison handler was found in the five function entry points.

The queue-trigger comment promises retry safety (`functions\runWorker.ts:6–20`), but ordinary provider exceptions are converted into terminal error records inside the worker (`runWorker.ts:1240–1294`; `imageWorker.ts:225–226`). Returning successfully acknowledges the queue message; only escaping failures receive transport retries.

**Impact conditions:** termination between database/enqueue operations, interrupted provider work, duplicate jobs, or failure before terminal persistence. B01 does not promise exactly-once business side effects. Merely reducing queue concurrency does not repair these windows.

**Proposal:** owner-qualified execution ledger with transactional outbox, conditional lease acquisition/renewal, attempt number and fencing token; persist provider response/tool checkpoints and explicit retryability. Outbox/slot/run mutations need an eligible shared container/partition or an explicitly reconciled multi-store protocol. Add a reconciler and poison-to-terminal/dead-letter handling. Keep provider-side effects separately deduplicated where their API permits.

**Acceptance:** injected termination at every persistence/enqueue/provider/finalization boundary converges to one documented terminal outcome, never a permanently active run; duplicate delivery cannot execute under two valid leases; ambiguous paid operations are surfaced instead of blindly rerun. B01/B02/B03/B06 supply the constraints.

### BE-05 — Cancellation does not stop work; deletion can be overwritten by a worker

**P1 · High confidence · Observed lifecycle race · C05/C09/C10**

`RunService.cancel` immediately marks a run terminal and frees admission (`runService.ts:100–104`); the queue starter's cancel is a no-op (`queueRunStarter.ts:51–53`). The worker checks cancellation only after streaming and artifact work (`runWorker.ts:1244–1246`), not before each tool or upload. The cancellation test deliberately emits more text after cancel and checks only final status (`runWorker.test.ts:1365–1375`).

The worker also retains the initial thread object from line 702 and unconditionally writes it back at `1264–1274`. Concurrent title/file/pin changes can be lost. If deletion wrote a tombstone meanwhile, the stale `deletedAt: null` can restore the thread and newly written messages. Cancellation during title generation after the last status read can likewise be overwritten by finalization.

**Proposal:** separate `cancel_requested` from acknowledged cancellation; propagate a run-scoped signal into providers and tools, check the fenced run/thread version before each side effect, and perform tombstone-preserving conditional finalization. Do not admit replacement work until the old attempt is fenced.

**Acceptance:** synthetic cancel at stream/tool/upload/title boundaries prevents subsequent authorized side effects; deletion during a run never resurrects a thread/message or exposes newly generated assets; edits made during generation survive. Provider cancellation capabilities in B05 are alternatives, not currently implemented behavior.

### BE-06 — Streaming deadlines and terminal errors are not enforced end-to-end

**P1 · High confidence · Observed protocol/control-flow defects · C05/C06**

`ai\http.ts:98–119` removes its abort forwarding and timeout as soon as `fetch` resolves—which normally means response headers, not body completion. `parseSse` checks abort only between `reader.read()` calls (`123–145`). A stalled body read therefore lacks the claimed request deadline, and the worker's watchdog cannot reliably abort an already-open underlying fetch after its listener was removed. The watchdog itself clears after any agent event (`runWorker.ts:647–680`).

Terminal handling is also incomplete: the normalizer recognizes `response.error`, not the generic `error` event documented by current Azure guidance; it ignores `response.failed`/`response.incomplete` and marks server-tool output items “done” without checking their actual status (`ai\responses.ts:191–224`). The orchestrator does not require a completion event before accepting stream EOF (`ai\orchestrator.ts:168–186`).

**Impact:** a hung run, or partial/empty output presented as complete, under stalled/truncated/error streams. Existing response tests cover happy-path event mapping and unknown-event ignoring (`responses.test.ts:5–39`), not these terminal cases.

**Proposal:** one transport abstraction that owns the signal until body consumption/cancellation finishes, plus connect/idle/total deadlines and explicit terminal-event validation. Normalize provider error/incomplete states without silently promoting them to success.

**Acceptance:** fake streams that stall after headers, end without completion, emit each documented failure, or abort during a blocked read finish within their budget and never persist `complete`. B02/B05 distinguish application deadlines from provider guarantees.

### BE-07 — Credential endpoints and web-image URLs have inconsistent egress boundaries

**P1 · High confidence in code; environmental impact unverified · C09**

`domain\credentials.ts:16–25,36–50` bounds a base URL's string length but permits HTTP and leaves unparseable values intact. Provider requests use that destination with the user's saved credential (`ai\http.ts:98–116`). There is no reviewed endpoint registration/HTTPS-only/approved-host boundary, and changing an endpoint can preserve the previous key (`credentialService.ts:63–71`).

The web-image path is stronger: scheme and literal-private-host checks, manual redirects and a ten-second timer (`domain\webImage.ts:9–45`; `webImageService.ts:31–66`). However, it validates the URL hostname string rather than the actual resolved connection address. Existing tests cover literal internal hosts and redirect strings, not DNS resolution (`webImageService.test.ts:33–39,60–74`).

**Impact conditions:** an invited account chooses an unintended/internal endpoint, a public-looking hostname resolves internally, or an endpoint is edited without recognizing where the existing key will be sent. Actual network reachability and identity-provider abuse were not tested.

**Proposal:** preferred Azure mode with canonical HTTPS resource endpoints; explicit separately enabled compatible-provider mode with approved origins, ports, DNS/IP checks and controlled redirects. Couple key scope to endpoint identity and require acknowledgement/re-entry on origin changes. Add network egress controls as defense in depth.

**Acceptance:** local mocked-resolution tests reject private/reserved targets and redirect changes; valid configured endpoints still work. B09 recommends both application and network controls, not a longer regex.

### BE-08 — Cryptographic token validity is stronger than authorization identity policy

**P1 · High confidence in policy; abuse contingent on tenant configuration · C09**

JWT signature/issuer/audience checks are substantive. Nevertheless `application\accessService.ts:25–36` grants admin through either OID **or email**, and ordinary access through email. `auth\identity.ts:33–38` includes `preferred_username` and `emails[]`. These behaviors are explicitly asserted by `accessService.test.ts:24–29,61–66`.

Microsoft's current claims guidance, B10, warns against using mutable email/username claims for data authorization. In addition, the verifier has no explicit delegated-scope, actor or token-type policy (`entraTokenVerifier.ts:37–44`). An exact issuer already constrains tenant identity; this is **not** a claim that any other tenant can sign an accepted token. Practical abuse depends on registration/token issuance and account controls that were not inspected.

**Proposal:** use email only to deliver/redeem invitations, bind acceptance to immutable issuer/tenant/object identity, and make admin authorization immutable-ID/role based. Require the intended delegated API scope, with an explicit separate app-only policy if ever needed.

**Acceptance:** email changes preserve the correct user's access but cannot transfer administrator privileges; same-email distinct principals do not inherit access; wrong-scope/token-type/actor fixtures fail while supported CIAM flows pass. Coordinate registration changes with infrastructure rather than hard-coding an unverified token shape.

### BE-09 — Provider files and skill caches do not share Watai's ownership model

**P1 · High confidence · Observed scope defects; shared-endpoint effects conditional · C06/C09/C10**

`application\skillProvisioner.ts:18–45,53–65` identifies packages by `name + version` and caches only by base URL. Two Watai users sharing an Azure endpoint can have different same-named version-one custom skills, yet the second provision reuses the first file ID. The unversioned bootstrap filename also survives content changes. Tests confirm filename reuse and version bump behavior, not content/owner identity (`skillProvisioner.test.ts:35–70`).

The index never expires, file listing does not follow pagination (`ai\files.ts:64–76`), and catalog removal deletes the catalog/blob but not uploaded provider copies (`application\skillCatalogService.ts:209–216`).

`ThreadFilesService.remove` passes any supplied `fileId` to the provider's global file-delete endpoint after checking the parent thread, without requiring membership in its file list (`threadFilesService.ts:148–162`). Client create/update also accepts vector-store IDs (`domain\thread.ts:7–22`). Provider authorization limits these operations to the configured provider account, but that account is not necessarily one Watai user or thread.

**Proposal:** persistent provider-resource registry keyed by owner, canonical endpoint identity, content hash and package/runtime version. Verify membership/reference ownership before delete; default skills may share explicitly trusted content, custom skills may not. Hash the bootstrap and support stale-ID repair.

**Acceptance:** distinct users with same-name/version packages receive correct distinct content; repeated identical provisioning deduplicates; deleting an unrelated file ID never calls the provider; shared resources remain until their final reference is removed. B05/B07/B08/B14 explain the provider versus application trust boundary.

### BE-10 — Library retention and deletion semantics are not one coherent lifecycle

**P1 · High confidence · Observed inconsistency; retention policy requires product decision · C10/C09**

Thread deletion deliberately preserves account Library blobs: `threadDeletionCascade.test.ts:45–58` asserts that behavior. It is not correct to call every retained Library file an accidental orphan. However, `functions\api.ts:120–162` exposes Library reads/uploads, not trash/purge/restore; those domain states are not an implemented deletion workflow.

Conversely, `ImageService.remove` deletes an image's blob and image record without updating its Library record (`imageService.ts:103–114`), leaving an active Library entry pointing to deleted content. An image worker deleted mid-generation uploads bytes and creates the Library item **before** noticing the removed studio record (`imageWorker.ts:178–213`). Its test checks only that the studio record stays absent (`imageWorker.test.ts:164–174`).

Thread cleanup suppresses errors, deletes messages best-effort, and does not delete run records or their copied prompt (`composition.ts:227–235`; `messageStore.ts:46–55`; `runService.ts:64`). Thus “delete thread” is neither a complete erasure operation nor a durable cleanup job.

Responses requests omit an explicit storage policy (`ai\responses.ts:247–268`). B05 documents default 30-day response retention; the reviewed thread deletion has no persisted-response-ID erasure path. This is additional provider-held state, not necessarily immediate deletion when a UI conversation disappears.

The per-user `30d`/`90d` retention choices are validated and persisted (`domain\settings.ts:8,42–46`; `application\settingsService.ts:13–16`), but no production backend consumer or retention-expiry job was found. Storing the preference does not implement scheduled erasure. Separately, `application\threadService.ts:20–23` correctly rejects temporary threads as local-only; ignoring the UI's temporary-default preference is a frontend wiring defect, not proof that the API accepts `temporary:true`.

**Proposal:** explicitly separate detach, account retention, trash and permanent purge. Use a durable deletion ledger covering messages/runs, Library references, blobs/derivatives and provider copies. Return truthful pending/partial status; retain repair identifiers after failures.

**Acceptance:** delete-during-generation and downstream failure tests converge; Library never remains active against a deliberately deleted primary blob; retained account assets are disclosed; requested purge has a verifiable inventory including run prompts and provider records; synthetic-clock tests prove the chosen retention scope expires as advertised. B05/B12/B14 preclude assuming immediate erasure from one delete call.

### BE-11 — Document and artifact ingestion can stop before convergence

**P2 · High confidence · Observed incomplete recovery paths · C10/C06**

Document upload performs provider upload, optional store creation, attachment/indexing, original-blob upload and thread update sequentially (`threadFilesService.ts:105–145`). Failures between steps have no durable compensation record. Concurrent first uploads can create different stores and overwrite each other's metadata. Index polling stops after twelve 1.5-second sleeps; `list` later returns stored metadata without refreshing it (`75–76,183–197`). A provider file that finishes later can remain locally “indexing,” excluding it from Code Interpreter's ready-file selection (`runWorker.ts:389–392`).

Changing/deleting credentials can also strand provider cleanup, which always uses current credentials (`threadFilesService.ts:165–180`). Artifact discovery reads one provider page (`ai\containerFiles.ts:47–73`) and retry capture stops after any artifact is persisted (`runWorker.ts:883–891`), not after all expected deliverables are found. Library-reused document metadata has no blob path (`threadFilesService.test.ts:124–138`), while artifact provenance collects only ready files with one (`runWorker.ts:718–720`).

**Proposal:** resumable ingestion jobs with recorded endpoint/resource IDs, conditional thread attachment, status refresh and per-step compensation. Track expected artifact outputs or bounded inventory completion, and distinguish “mounted sources” from actual derivation.

**Acceptance:** slow indexing eventually becomes ready without reupload; parallel uploads preserve both files; failures never lose cleanup identity; paginated/multi-file outputs are captured or reported incomplete; reused documents remain in source provenance. B05/B14 support readiness and ephemeral-output constraints, without importing classic Assistants automatic waits.

### BE-12 — Iteration limits are not complete cost or tool-authorization budgets

**P2 · High confidence · Observed controls gap, workload impact unmeasured · C06/C09**

The six-iteration default is useful (`ai\orchestrator.ts:93–102`) but does not cap calls per iteration, aggregate image/search spend, input history, total elapsed time or provider usage. Every pending function call is executed (`189–240`). Main generation does not pass `maxOutputTokens`, although the Responses client supports it (`runWorker.ts:1072–1086`; `responses.ts:247–253`). Full history is loaded and sent to routing and generation (`runWorker.ts:917–980,1054–1059`).

The executor checks known tool names/configuration, not membership in this attempt's allowed tool set (`runWorker.ts:446–532`). `allowDestructive` is stored but not wired into the orchestrator; confirmation is optional and its gate depends on a confirmation callback existing (`orchestrator.ts:199–214`). Current production custom tools are search and image generation, **not administrative deletion tools**. This is a guardrail gap, not evidence of arbitrary host command execution.

**Proposal:** deterministic per-run tool policy, schema validation, call-count/token/time/byte budgets and provider-usage accounting; allow only configured deployments where intended. Treat search/file/skill content as untrusted data. Require fail-closed consent before adding higher-impact tools.

**Acceptance:** unoffered/malformed/over-budget calls never reach an executor; budget exhaustion yields a typed terminal reason; ordinary long conversations fit a measured context budget; synthetic indirect-instruction cases cannot widen tool permissions. B05/B07/B08 support these controls.

### BE-13 — Some size limits and upload verification occur after the expensive/trusted step

**P2 · High confidence · Observed bounds/verification weaknesses · C10/C09**

`skillPackager.ts:55–63,89–103` fully and synchronously decompresses an archive before enforcing unpacked-size/count limits. `webImageService.ts:52–57` buffers the complete body before checking actual size when the declared length is missing/unreliable. Container downloads similarly enforce 25 MB only after receiving all bytes (`runWorker.ts:813–821`). JSON/base64 bodies are materialized before these checks (`http\azureFunctions.ts:13–26`; `http\skillsController.ts:12–20`). These are accepted-size limits, not reliable peak-memory limits.

Library completion checks length, MIME and a client-set metadata hash (`libraryService.ts:115–130`). The hash is not recomputed from bytes. More subtly, its HEAD URL requests `contentType: item.mime`; the minter adds `rsct`, which overrides the response MIME (`sasMinter.ts:77–78`, B15). That comparison cannot independently establish the blob's stored MIME. The write SAS remains reusable until expiry.

**Proposal:** stream/count network and archive input with bounded expansion; quarantine direct uploads, inspect actual properties without response overrides, verify bytes/hash/type as required, and promote an immutable/version-pinned object. Expire abandoned reservations and enforce account admission quotas.

**Acceptance:** compressed and chunked oversized fixtures are stopped before large allocation; mismatched actual content cannot become verified merely by matching metadata; post-completion overwrite cannot change an active object's trusted version. B13/B15 explicitly separate SAS delegation from business/content validation.

### BE-14 — Snapshot persistence lacks a durable ordering/replay contract

**P2 · High confidence · Observed cursor/order limitations · C05**

Message deltas use `createdAt > since`, and thread deltas `updatedAt > since` (`messageStore.ts:23–37`; `threadStore.ts:23–35`). Independent writers using equal millisecond timestamps, or a later commit with an earlier application timestamp, can fall behind a cursor already advanced by another write. The worker's monotonic timestamp fix applies only to one invocation (`runWorker.ts:732–742`), not all writers or restarts.

There is a separate chronology mismatch: `MessageService` intentionally stores logical `orderAt` distinct from append-time `createdAt` (`messageService.ts:89–94`), yet worker history comes directly from the append-time-ordered store (`runWorker.ts:917–930,308–347`). Late-synced old turns can appear newest to the model even if the client displays logical chronology.

**Proposal:** separate immutable chronology, revision and durable synchronization cursor. Prefer a commit-ordered change log/feed or another explicit recoverable revision protocol. A timestamp-plus-ID cursor alone does not solve late commits behind a high-water mark. As an interim mitigation, overlap reads, deduplicate revisions and reconcile periodically.

**Acceptance:** equal timestamps, delayed commits, worker restart and reconnect converge without missing/reverting content; provider history follows documented logical ordering. B04 recommends application-store replay after a new connection, not assuming push delivery fills gaps.

### BE-15 — Centralized architecture is appropriate, but provider and worker responsibilities are entangled

**P2 · High confidence · Observed maintainability/correctness debt · C04/C06**

`application\runWorker.ts:692–1296` mixes execution state, model routing, credentials, memory integration, prompt assembly, tool execution, artifact capture, Library writes, titling, sync and logging. Application code imports a concrete-adapter-owned `SignalRSender` type. `ai\chat.ts:34–81` duplicates URL/SSE logic from `ai\http.ts:31–58,122–145`; their timeout behavior already differs.

Capabilities are inferred from hostname and configured models (`credentialService.ts:116–135`), not verified model/region/API support. In particular the Foundry-host predicate excludes `*.openai.azure.com`, which B05 uses in its current examples. Comments claiming client capability probing and universal provider deadlocks should not be treated as current guarantees (`runWorker.ts:350–369,1062–1070`). With a semantic route, the alleged “reduced tools” retry returns the same tools.

SignalR sends are awaited in the persistence hot path, have no request deadline, ignore HTTP status and swallow thrown failures without telemetry (`adapters\azure\signalr.ts:69–82`). Library pagination fetches every item in the state partition before sorting/slicing (`libraryStore.ts:129–149`).

Push is explicitly conditional on the exact `AzureSignalRConnectionString` environment setting (`composition.ts:169–171`). When absent, composition passes no sender to run/image/memory workers (`182,270,278`), and negotiation returns HTTP 200 with empty URL/token (`http\negotiateController.ts:12–18`). The backend therefore provides no push notifications in that configuration; its documented fallback is store synchronization/polling. Whether the deployment provisions/configures SignalR belongs to the delivery audit, not an inferred guarantee from README claims.

**Proposal:** extract transport, execution policy, context builder, artifact ingestor and terminal coordinator behind narrow ports; persist typed failure/usage/timing data. Use a versioned capability profile with bounded optional verification. Move Library filtering/pagination server-side and make notification delivery deadline-bounded.

**Acceptance:** behavior-preserving contract tests cover existing flows; changing a provider or notifier does not alter state semantics; per-page work is bounded; endpoint/model capability failures are distinguishable from network failures. B03/B04/B05/B06 justify targeted extraction, not a microservice rewrite.

### BE-16 — Credential update and wrapping-key refresh semantics need completion

**P2 · High confidence · Observed correctness and operational gaps · C09**

`parseCredentialsInput` maps blank Tavily keys and knowledge-base IDs to `undefined` (`domain\credentials.ts:55–64`); the service interprets undefined as “preserve existing” (`credentialService.ts:72–87`). Consequently the apparent clear branches cannot be reached with blank input. A user can unintentionally retain a search credential or account knowledge-base attachment after trying to clear it.

The Key Vault wrapper caches the current wrapping client promise indefinitely (`keyVaultWrapper.ts:23–31`). Existing versions correctly remain decryptable, but a warm process need not adopt a new wrapping version; an initial rejected lookup remains cached until process recreation. This is not a break of AES-GCM or an assertion that rotation is currently deployed.

**Proposal:** explicit absent/preserve, value/replace, null/clear semantics; concurrency-safe credential revisions tied to endpoint identity. Refresh current KEK identity on a bounded schedule, evict failed initialization, and document old-version retention/rewrap and recovery. Consider additional authenticated context binding for owner/field/schema when evolving the envelope.

**Acceptance:** clearing each optional integration truly disables it without deleting the main key; update races do not restore removed values; synthetic KEK rotation/retrieval failure recovers without restart and old records remain readable. B10/B11 inform durable identity and key-resolution responsibilities.

### BE-17 — Asset URL contracts have expiry and addressing mismatches

**P2 · High confidence in code; download/expiry effects not live-tested · C10**

`AzureSasMinter.getDelegationKey` reuses a one-hour key until only one minute remains (`sasMinter.ts:37–47`). `mint` independently chooses `now + requested TTL` (`50–59`). Library requests one-hour read grants (`libraryDto.ts:4,33–39`), so a newly issued URL can advertise validity well beyond that key's `ske`. B15 documents the key's own expiry boundary; requested token duration cannot extend the signing authority's lifetime.

This creates an avoidable reconnect/download failure mode, particularly late in a warm instance's cache cycle. It also makes service-side `expiresAt` misleading for clients that rely on it. The source-level issue is clear; no real SAS or storage credential was generated for this audit.

Separately, regular attachment writes use `user/library/derivedId.ext`, while reads with the original thread/asset IDs still use `user/thread/asset.ext`; the response contains no Library ID (`application\assetService.ts:7–11,25–41`). Frontend FE-10 traces the legacy fallback parser interpreting the `library` path segment as a thread ID. This affects **uncached, un-enriched references**, not every fresh-device attachment: new server message appends add Library IDs and index the blob (`messageService.ts:79–119`), allowing the Library resolver to bypass that fallback. Existing-record idempotency returns before enrichment (`38–40`).

**Proposal:** refresh the delegation key whenever it cannot cover the requested interval plus skew, or clamp the grant and return its actual expiry. Deduplicate refreshes. Return a canonical owner-verified asset/Library reference with uploads and resolve that reference rather than reconstructing storage paths.

**Acceptance:** fake-clock tests prove grants fit signing-key validity; concurrent mints share one refresh; renewal works without reload. Fresh-device regular-attachment tests include a newly cloud-enriched successful control plus uncached legacy/imported/un-enriched references. No valid supported reference should require local bytes to mask a path-contract mismatch. B13/B15 support accurate delegated-access contracts.

## Category proposals and PR-sized sequence

These are **proposals**, not application changes made by this audit. Measurable targets below are initial engineering acceptance gates, not published service SLAs.

### C04 — Keep the layered monolith; reduce coordination concentration

**Preferred:** retain Functions, ports and the composition root. Extract the shared HTTP transport first because BE-06 is a correctness issue, then introduce an execution coordinator that alone owns run transitions. Artifact ingestion and notification delivery should become independently testable collaborators. Do not begin with a broad directory reorganization.

**Alternative:** Durable Functions or another durable workflow engine can own orchestration state. It adds operational/model complexity and does not make external tool side effects exactly once. Choose it only after a small implementation proves simpler recovery than the outbox/lease approach.

**PR slices:** transport contract/fixtures → execution coordinator → artifact port → capability profile → indexed Library pagination. Each PR keeps public DTO behavior stable except an explicitly versioned correction. Target: no production provider transport duplicates; no unbounded notifier await; adding one tool requires no changes to persistence transitions.

### C05 — Establish an execution ledger before adding retries

**Preferred:** owner-qualified identity, atomic admission/idempotency, transactional outbox, fenced lease, cancellation acknowledgement and terminal reconciliation. Keep snapshots for rendering; add a reliable revision/replay contract rather than persisting every token blindly.

**Alternative:** selectively use provider background Responses for suitable long jobs. B05 requires storage and initial streaming for replay, warns of higher first-token latency and streaming performance issues, and does not run Watai's local function tools durably. Provider response IDs/cursors would need persistence and retention disclosure. A blanket migration would exchange one set of failure modes for another.

**PR slices:** BE-01 namespace → BE-03 admission → BE-04 handoff/lease → BE-05 cancel/delete fence → BE-06 protocol termination → BE-14 replay. Target: fault-injection at every durable boundary; zero double-admitted runs; no active record older than its documented recovery window. Start with a synthetic five-minute stale-run recovery target and validate it against the chosen plan, rather than claiming it is already achieved.

### C06 — Make execution policy deterministic, provider behavior observable

**Preferred:** a versioned tool registry containing input schema, permitted actions, resource budgets, timeout and idempotency/confirmation requirements. Record normalized provider status, output usage and terminal reason; bound history/images/files and distinguish graceful degradation from silent capability loss.

**Alternative:** use direct task-specific handlers for known image/document operations, with an LLM routing decision only where useful. Compare this with the current manager step on a small synthetic task corpus. Do not remove semantic routing on intuition or introduce multiple agents without measured benefit.

**PR slices:** stream terminal fixtures → tool policy/budget enforcement → endpoint-scoped capability cache → provider resource registry → bounded context selection. Target: a wrong/unsupported tool never executes; all tool calls have an accounted outcome; at least simple chat, web grounding, image edit and multi-artifact tasks have deterministic transport/authorization tests plus separately consented provider evaluations.

### C09 — Close authorization gaps before widening invitations

**Preferred:** BE-01/02 first, then immutable invitation/admin identity, explicit scope policy and endpoint/egress rules. Keep the existing encrypted credential abstraction. Add redacted structured audit events for admission, cancellation, ownership rejection and deletion; do not log conversation bodies, provider secrets or SAS URLs.

**Alternative:** restrict the application to a single trusted principal and approved Azure endpoints while fixing multi-user contracts. This is risk containment, not proof of multi-user readiness, and does not repair deletion or failure recovery.

**PR slices:** owner-key migration/guards → canonical asset references → invitation binding/token policy → endpoint changes/key-scope consent → credential clear/KEK refresh. Acceptance must include two users with colliding public IDs and shared provider endpoints. No real private data or live internal-address probes are required for these tests.

### C10 — Make Library the lifecycle authority, not another independent copy

**Preferred:** separate the stable object from each surface's reference; coordinate studio/thread removal through that authority. Implement pending-upload expiry, verified immutable activation, reversible trash and a retryable purge ledger. Track provider files, vector stores, generated artifacts and derivatives by owner/resource identity. Turn the existing inventory into a bounded reconciliation job only after its rules are agreed.

**Alternative:** if a full Library lifecycle is premature, disable unsupported destructive semantics and clearly offer “remove from this view; retained in Library.” This must not leave the current studio-delete path physically deleting a retained Library object.

**PR slices:** deletion policy/impact DTO → studio-reference correction → resumable ingestion → actual-content verification → trash/purge/reconciliation → provider cleanup and retention evidence. Target: every stored object is classified as active, retained, quarantined or cleanup-pending; no active record references a deliberately purged blob; interrupted cleanup is repairable from persisted identifiers. Blob lifecycle rules are a cost/retention backstop, not the coordinator.

## Validation status and handoff

This work changed **documentation only**. It did not modify application code, add test tools, run provider evaluations, deploy, query production, read secret files or create commits. It read existing tests but did not rerun the parent's full suite; execution results belong in the shared validation evidence.

The [validation workstream's recorded results](evidence/validation.md) show **76 API test files / 557 tests passing**, with **5 integration files / 11 tests intentionally skipped**, and successful API typecheck/build. The full browser matrix was not green; a passing targeted follow-up does not replace it. These baseline passes do not establish live cloud behavior or cover the specific concurrency, authorization and interruption fixtures proposed here.

The strongest regression gaps are specific, not “add more tests”: equal public thread IDs across owners; raw foreign asset references; simultaneous admission; enqueue acknowledgement racing worker state; termination between workflow steps; cancel/delete during side effects; hanging/error/truncated SSE; same-named custom skills on a shared endpoint; late indexing; delete-during-image-generation including Library/blob state; real-MIME versus SAS-override verification; and signing-key expiry.

Cross-scope handoff: BE-01 affects memory's thread/message lookup namespace; BE-05/10 affect memory and frontend deletion expectations; BE-14 affects client reconciliation and prompt chronology; BE-07/08 need infrastructure/identity configuration agreement; BE-04/06/15 require synthetic fault tests and operational metrics. Client message append also accepts `artifacts`/`webImages` in `domain\message.ts:177–179` but omits them from `MessageService`'s persisted projection (`65–95`); the frontend audit should reconcile that browser-sync compatibility issue with its observed call paths.

The frontend settings-hydration/backfill finding also matches backend PATCH semantics: supplied keys overwrite stored section values (`domain\settings.ts:100–109`), followed by unconditional full-document upsert (`adapters\cosmos\settingsStore.ts:31–34`). A valid full local-default snapshot therefore replaces existing cloud preferences, including supplied memory settings. The backend GET exists (`http\settingsController.ts:10–14`); omitted keys preserve current values, but there is no revision/conflict guard against a stale complete snapshot.

**Decision:** preserve the architecture and useful features, but do not claim robust multi-user isolation, exactly-once execution, effective cancellation or complete deletion until the associated P1 acceptance gates pass.
