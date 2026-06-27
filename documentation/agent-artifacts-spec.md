# Agent Artifacts + Skills — Plan & Spec

Let the watai agent **produce downloadable files** (PDF, Word, Excel, PowerPoint, CSV,
charts, ZIP) by writing and running real code in the Azure OpenAI **code interpreter**
sandbox, and surface those files as first-class **artifacts** in the chat — viewable,
downloadable, and re-runnable. A **Skills** system gives the agent reusable, professional
"playbooks" (how to build a clean A4 PDF, a branded report, a pivoted spreadsheet) so the
output looks deliberate, not improvised.

This is the implementation contract. It builds directly on the existing run engine
(`api/src/application/runWorker.ts`), the Responses client (`api/src/ai/responses.ts`),
the agent orchestrator (`api/src/ai/orchestrator.ts`), and the thread-files pipeline.

---

## 1. Motivating scenario

> "I'd provided a PDF, extract the content, update it with these details and format it
> properly in a professional manner using the right skills, and create a new A4 PDF that I
> can download."

Today this fails: the user's PDF only feeds `file_search` (a vector store), the code
interpreter's **file outputs are discarded** (we read only its text logs), and there is no
notion of a downloadable "artifact" or of "skills". This spec closes all three gaps.

**Target experience:** the user uploads a PDF, types the request, watches a "Running code…"
card, and then sees an **A4 PDF artifact card** appear under the reply with a thumbnail,
filename, size, **Download**, and **Preview**. Closing the app mid-run does not lose it
(server-authoritative, same as images).

---

## 2. How code interpreter files actually work (verified)

From the OpenAI Responses **Code Interpreter** + **Containers** docs (Azure OpenAI mirrors
the Responses shape):

- **Container**: the tool runs in a sandboxed VM declared as
  `{ type: 'code_interpreter', container: { type: 'auto', memory_limit: '4g', file_ids: [...] } }`.
  Auto mode creates or reuses a container; the emitted `code_interpreter_call` output item
  carries the **`container_id`**.
- **Input files**: *"Any files in the model input get automatically uploaded to the
  container."* So providing the user's PDF as an `input_file` (by `file_id`) — or via
  `container.file_ids` — places it at `/mnt/data/…` inside the sandbox, ready for Python to
  read. The uploaded PDF **already has an AOAI `file_id`** (the thread file's `fileId`).
- **Output files**: when the model writes a file (e.g. `report.pdf`), it cites it with a
  **`container_file_citation`** annotation on the assistant message:
  `{ type: 'container_file_citation', container_id, file_id: 'cfile_…', filename }`.
- **Download**: fetch the bytes from
  `GET /v1/containers/{container_id}/files/{file_id}/content`.
- **Expiry (critical)**: a container is discarded after **20 minutes of inactivity** and
  its files become unrecoverable. The worker must **download outputs during the run**, then
  persist them to our own Blob Storage. Treat containers as ephemeral.
- **Supported outputs**: pdf, docx, xlsx, pptx, csv, png/jpg/gif, json, md, txt, zip, and
  source files — a broad artifact surface.

> **Verified on your stack (2026-06-27).** I probed your Foundry resource
> `ai-project-deployments-resource` (eastus2, `gpt-5.4`) directly and exercised the whole chain:
> - **Code interpreter runs** (streaming *and* non-streaming) and creates an auto container.
> - **Streaming exposes the `container_id` early**: on `response.output_item.added` the
>   `code_interpreter_call` item already carries `item.container_id` (also on
>   `response.output_item.done`). Progress events `response.code_interpreter_call.{in_progress,
>   interpreting,completed}` and code deltas `response.code_interpreter_call_code.{delta,done}`
>   also stream.
> - **Uploaded files mount into the sandbox**: a file uploaded with `purpose=assistants` and
>   passed via `container.file_ids` was read by Python in the container (it returned a value from
>   the CSV). This is the "I provided a PDF" link.
> - **Output retrieval works**: `GET /containers/{id}/files` listed the generated file
>   (`source: assistant`, `path: /mnt/data/…`) and `GET …/files/{fileId}/content` returned the
>   real bytes — a 4528-byte `%PDF-` document.
> - **The document toolchain is preinstalled** (reportlab, weasyprint, python-docx, openpyxl,
>   python-pptx, pdfplumber, pandas, matplotlib, jinja2 — full list in §11). No `pip` needed.
>
> **Retrieval lesson:** `container_file_citation` annotations are **not reliable** — they only
> appear when the model *cites* the file in prose (replying "done" yields zero annotations even
> though the file exists). So the pipeline keys off the **`container_id` + a container-file
> listing**, filtering `source === 'assistant'`; annotations are a secondary hint.

---

## 3. Product model — "Artifact" as a first-class object

An **Artifact** is a file the agent produced during a run, persisted independently of the
container, owned by the thread, and downloadable forever.

```ts
type ArtifactKind = 'pdf' | 'document' | 'spreadsheet' | 'presentation'
                  | 'image' | 'data' | 'archive' | 'code' | 'text';

interface Artifact {
  id: string;                 // our id
  threadId: string;
  messageId: string;          // the assistant message that produced it
  toolCallId?: string;        // the code_interpreter call it came from
  name: string;               // filename, e.g. "Acme-Report.pdf"
  mime: string;               // application/pdf, …
  kind: ArtifactKind;         // derived from mime (for icon + preview)
  bytes: number;
  blobPath: string;           // {userId}/{threadId}/{artifactId}.{ext}
  sourceFileIds?: string[];   // inputs it was derived from (lineage)
  version?: number;           // iteration count (see §10)
  createdAt: string;
}
```

Artifacts surface in **two** places (mirroring generated images):
1. On the **message** (`message.artifacts[]`) — rendered as cards under the reply.
2. In the **thread file list** (`ThreadFileMeta` with `kind: 'artifact'`) — the Files pane,
   synced across devices.

Principles:
- **Server-authoritative.** Bytes live in our Blob Storage; the container is throwaway. The
  client is a projection (same model as chat + the image studio).
- **One run can emit many artifacts.** A "build a report + the source CSV" request yields
  two cards.
- **Lineage is kept.** Each artifact records the input file(s) and the code-interpreter call
  that made it, so "regenerate" / "iterate" is possible (§10).
- **No emoji in UI** (repo rule) — Fluent icons + plain text.

---

## 4. Skills — making the agent *good*, not just *able*

A bare code interpreter will improvise; output quality is inconsistent. **Skills** are
curated, versioned playbooks that tell the model exactly how to do a class of task well.

```ts
interface Skill {
  id: string;                 // 'professional-pdf'
  name: string;               // 'Professional PDF documents'
  summary: string;            // one line for matching + UI
  keywords: string[];         // ['pdf','report','a4','letter','formatted']
  outputs: ArtifactKind[];    // ['pdf']
  body: string;               // the playbook (markdown): libraries, layout rules, snippets
  version: number;
}
```

**What a skill body contains** (example `professional-pdf`): use ReportLab Platypus with
`pagesize=A4` and 2 cm margins; a title block; running header/footer with page numbers; a
serif body at 10.5pt with 1.3 line spacing; section styles; tables with subtle borders;
embed images at print DPI; save to `/mnt/data/<name>.pdf`. The model follows the recipe
instead of guessing.

**Starter skill set** (bundled as TypeScript modules under `api/src/skills/`, versioned with
the repo): `professional-pdf` (ReportLab/WeasyPrint), `word-docx` (python-docx), `excel-xlsx`
(openpyxl, formulas, charts), `slides-pptx` (python-pptx), `data-viz` (matplotlib),
`pdf-extract` (pdfplumber/pypdf for reading the input PDF), `tabular-clean` (pandas). Every one
of these libraries is **preinstalled in the sandbox** (verified — §11), so a skill never needs
`pip install`.

**Selection — how the right skill gets used.** Two complementary mechanisms:

- **(A) Inject (Phase 2 default).** A cheap pre-step ranks skills against the request
  (keyword overlap first; embeddings later) and prepends the top 1–3 skill bodies to the
  system prompt for that run. Deterministic, no extra round-trips, and the model gets the
  recipe up front.
- **(B) Skill tools (Phase 4).** Expose `search_skills(query)` and `load_skill(id)` as
  function tools so the model can pull a skill mid-run (mirrors OpenAI's native "Skills" /
  "tool search" pattern). More flexible, more latency.

Skills are **admin-curated** content (start bundled; later an admin CRUD surface +
optional Cosmos `skills` container). The word "skill" stays internal-ish: users see
"Formatted with the *Professional PDF* skill" as a small provenance line, not a
configuration burden.

---

## 5. End-to-end flow (the PDF example)

```
User uploads report.pdf ──► threadFilesService.upload ──► AOAI file_id + vector store
User: "extract, update with these details, format A4, downloadable PDF"
        │
        ▼
RunService.submit ──► queue ──► runWorker.processRun
        │
   skill select: match → inject `pdf-extract` + `professional-pdf` bodies into system prompt
        │
   assemble tools: code_interpreter { container:{ type:'auto', file_ids:[report.pdf fileId] }}
   assemble input: prior turns + input_file(report.pdf fileId) so it lands in the container
        │
        ▼
   streamResponses (Responses API)
      • model writes Python: pdfplumber reads /mnt/data/report.pdf → text
      • edits content, builds A4 PDF with ReportLab → /mnt/data/Acme-Report.pdf
      • emits container_file_citation { container_id, file_id, filename }
        │
        ▼
   orchestrator emits { type:'artifact', containerId, fileId, filename, mime }
        │
        ▼
   runWorker (container still active): download bytes via
        GET /containers/{containerId}/files/{fileId}/content
     → uploadArtifact(userId,threadId,artifactId,bytes,mime) → blobPath
     → push MessageArtifact onto the message + ThreadFileMeta(kind:'artifact') onto thread.files
     → SignalR push (live card)
        │
        ▼
   Client: artifact card under the reply → Preview (pdf.js) / Download (read SAS)
```

Crash-proof: the download + persist happen in the queue worker, so closing the app never
loses the PDF.

---

## 6. Server architecture & changes

### 6.1 Responses parsing (`api/src/ai/responses.ts`)
- Add `container_id` to the `RawEvent.item` type and read it from the `code_interpreter_call`
  item on **`response.output_item.added`** (available immediately) and `…output_item.done`.
- Emit `{ type:'codeInterpreterStarted', containerId, callId }` on `added` and
  `{ type:'codeInterpreterDone', containerId, callId }` on `done` (dedupe by `callId`).
- Optionally surface progress (`response.code_interpreter_call.{in_progress|interpreting|
  completed}`) and streamed code (`…_code.{delta|done}`) to enrich the tool card.
- Parse `container_file_citation` annotations when present as a *secondary* hint only — never
  the source of truth (the model only emits them when it cites the file in prose).
- Keep `codeInterpreterDetail()` for the code/logs tool card (unchanged).

### 6.2 Orchestrator (`api/src/ai/orchestrator.ts`)
- Add to `AgentEvent`:
  `{ type:'artifact', containerId:string, fileId:string, filename:string, mime?:string, callId?:string }`.
- Forward `containerFile` → `artifact` events.

### 6.3 Input files → container
- **Primary (confirmed):** in `assembleTools()` (`runWorker.ts`), when code interpreter is
  enabled and the thread has uploaded files, set `container.file_ids` to their
  `ThreadFileMeta.fileId`s. The probe proved a `purpose=assistants` upload mounts at
  `/mnt/data/` and is readable by Python — and `threadFilesService` already uploads with
  `purpose=assistants`, so the `fileId`s are reused as-is.
- **Alternative:** add an `input_file` content part `{ type:'input_file', file_id }` to the
  user message (extends `toInputMessages()`/the turn model). This *also* auto-uploads the file
  to the container **and** injects the document into the model's context (more tokens; useful
  when the model should "see" the doc, not just have Python read it). For PDFs, Azure requires
  the `assistants` purpose (not `user_data`).

### 6.4 Container-file client (`api/src/ai/containerFiles.ts`, new)
- `listContainerFiles(creds, containerId): Promise<Array<{ id, filename?, source, bytes? }>>`
  → `GET /containers/{containerId}/files`. **Primary** discovery mechanism: keep the entries
  whose `source === 'assistant'` (model-generated), ignoring `user`-sourced inputs.
- `getContainerFile(creds, containerId, fileId): Promise<{ bytes, mime?, filename? }>` →
  `GET /containers/{containerId}/files/{fileId}/content`. Confirmed working (returned a real
  PDF). Infer `mime`/extension from the filename/path.
- Reuses `aiFetch`/vault creds; bounded timeout; size cap.

### 6.5 runWorker (`api/src/application/runWorker.ts`)
- Generalize `uploadImage` → also expose `uploadArtifact(userId,threadId,artifactId,bytes,mime)`
  (the existing `makeUploadImage` already mints a write SAS via `assetService.requestSas`
  with a thread + contentType — reuse it; artifacts are thread-scoped, so no new blob path
  scheme is needed, unlike the image studio).
- On `codeInterpreterDone` (or at run end): **list** the container's files (§6.4), and for
  each new `assistant`-sourced file, download bytes **immediately** (container is live), then
  `uploadArtifact`, append a `MessageArtifact` to the message and a `ThreadFileMeta`
  (`kind:'artifact'`) to `thread.files`, link the artifact to its `code_interpreter`
  tool-call (`artifactIds`), and `flush()` so the card streams in. De-dupe by container
  `file_id` so a re-listed file isn't stored twice. Best-effort: a failed download leaves the
  text answer intact (same pattern as image upload).
- Guard: total artifact bytes per run + per-file cap; mime allowlist.

### 6.6 Skills (`api/src/application/skillService.ts`, new)
- Phase 2: `selectSkills(prompt, enabledTools): Skill[]` — keyword rank over the bundled TS
  registry (`api/src/skills/index.ts` aggregating `<id>.ts` modules — esbuild does not bundle
  `.md`; see §11), cap 1–3, only when code interpreter is on.
- `systemPrompt()` in runWorker appends selected skill bodies under a "Skills" section.
- Phase 4: `search_skills` / `load_skill` function tools in `assembleTools()` + executor.

### 6.7 Endpoints
- No new run endpoints — artifacts ride the existing run + sync. (Optional later:
  `GET /threads/{id}/artifacts` for a dedicated pane.) Download reuses `POST /assets/sas`.

---

## 7. Data-model changes

| Type | File | Change |
| --- | --- | --- |
| `ThreadFileMeta.kind` | `api/src/ports/threadStore.ts` | add `'artifact'` |
| `MessageArtifact` (new) | `api/src/domain/message.ts` | `{ id, fileId?, name, mime, kind, bytes, blobPath, sourceFileIds?, version?, createdAt }`; add `artifacts?` to the message schema |
| `MessageToolCall` | `api/src/domain/message.ts` | add `artifactIds?: string[]` (link code_interpreter call → artifacts) |
| Client `Message` / `ThreadFile` | `src/lib/types.ts`, `src/data/cloud/types.ts` | mirror `artifacts` + `kind:'artifact'` |
| `ALLOWED_CONTENT_TYPES` | `api/src/domain/asset.ts` | add `application/zip` (others already present) |
| `parseBlobPath` (client) | `src/data/sync/syncRepository.ts` | infer contentType for pdf/docx/xlsx/pptx/csv/zip from extension |

Blob path: `{userId}/{threadId}/{artifactId}.{ext}` via the existing asset SAS scheme.

---

## 8. Client UX

### 8.1 Artifact card (under the assistant message)
- Type icon (pdf/doc/sheet/slides/data/archive), filename, size, and a one-line provenance
  ("Built with the *Professional PDF* skill" when a skill was used).
- Actions: **Preview**, **Download**, **Open in Files**. While the code runs, the existing
  `code_interpreter` tool card shows "Running code…"; the artifact card replaces/augments it
  when the file lands (live via SignalR, poll fallback).

### 8.2 Preview
- **PDF**: inline via `pdf.js` / `<iframe>` over the read-SAS blob URL.
- **Image**: inline (existing).
- **CSV / XLSX**: lightweight table preview (parse first N rows client-side; SheetJS for
  xlsx later).
- **DOCX / PPTX**: download-first in v1 (server-rendered thumbnail later).
- **Code / text / json / md**: syntax-highlighted viewer (existing code viewer).

### 8.3 Files pane
- New **Artifacts** section in `ThreadFilesPane.tsx` (alongside Documents + Images),
  newest-first, with the same preview/download actions.

### 8.4 Download
- Reuse `resolveAssetUrl()` → `requestSas` (read) → cached blob URL → `download()`
  (`Attachments.tsx`). No new transport.

---

## 9. Security

- Container files are downloaded **server-side** with the user's vault key; the client never
  sees the key (consistent with all AI proxying).
- **Mime allowlist** on persist; **per-file** (e.g. 25 MB) and **per-run total** caps.
- Read SAS only — short-lived, single-blob, single-op (existing `AzureSasMinter`).
- The sandbox is OpenAI-managed; we persist only declared outputs (cited files), never
  arbitrary container contents.
- Skill bodies are trusted, admin-curated content (no user-injected code execution beyond
  what code interpreter already allows).
- Prompt-injection note: an uploaded PDF could contain instructions; skills + system prompt
  must instruct the model to treat file contents as data, not commands.

---

## 10. Capability expansion ("make it more capable")

1. **Multi-artifact runs** — report + its source data + a chart, as separate cards.
2. **Iteration / versioning** — "make the header navy and re-export": the next run reuses
   the prior artifact as input (`sourceFileIds`), increments `version`, and the card shows a
   version switcher.
3. **Regenerate / convert** — per-artifact actions: "Regenerate", "Convert to DOCX",
   "Make a 1-page summary".
4. **Templates** — letterhead / branded report / invoice skills with slots (logo, colors,
   address) pulled from settings.
5. **Dashboards & charts** — matplotlib/plotly artifacts; multi-page PDF reports.
6. **Spreadsheets with formulas & pivots** — openpyxl skill producing real formulas, not
   flattened values.
7. **Bundles** — zip several outputs into one downloadable.
8. **Skill marketplace** — admin CRUD + per-user enable/disable; usage analytics to refine
   skill bodies (EDD loop).
9. **Artifact search** — find past artifacts by name/type/date (like the image studio).

---

## 11. Feasibility: tech-stack, deployment & subscription (verified)

Every layer was checked against the live system; nothing here is aspirational.

- **Azure OpenAI / model (your resource).** `ai-project-deployments-resource` (eastus2) runs
  `gpt-5.4`, a Responses-API + code-interpreter capable model in a supported region;
  `ai-stuffs` (eastus, `gpt-5.4-mini`) is a viable second. Code interpreter, container-file
  listing, and content download were all exercised end-to-end here (§2).
- **Subscription.** Visual Studio Enterprise (`0675b2b4-…`). Code interpreter adds per-session
  charges (a session is active up to 1 h, 20-min idle) plus tokens — covered by the monthly
  Azure credits at personal scale. **No SKU/quota upgrade needed**; the capability is already
  live on the existing resource. Default container `memory_limit` 1 GB suffices for document
  generation.
- **Functions runtime (Flex Consumption FC1).** `instanceMemoryMB: 2048`,
  `maximumInstanceCount: 40`; no `functionTimeout` set → Flex default **30 min**, far above a
  code-interpreter run (the PDF probe finished in seconds). The queue trigger auto-renews
  message visibility while processing, so a multi-minute run is not redelivered mid-flight; the
  worker is idempotent regardless. Artifact capture adds only HTTP downloads + blob writes.
- **No new server dependencies.** The pipeline is HTTP (`aiFetch`) + Blob
  (`@azure/storage-blob`, present) + Queue (present). esbuild bundles with
  `--packages=external`; nothing to install. The heavy Python lives in OpenAI's sandbox, not in
  our Function.
- **Document libraries are preinstalled in the sandbox (no pip / no internet).** Probed the
  container (Python 3.11): reportlab 4.4.5, weasyprint 53.3 (HTML→PDF), fpdf 2.8.3,
  python-docx 1.2, openpyxl 3.1.5, python-pptx 1.0.2, pdfplumber 0.6.2, pypdf 6.3 / PyPDF2 /
  PyMuPDF, pandas 1.5.3, matplotlib 3.6.3, Pillow 9.1, jinja2 3.1.6, lxml, bs4, cairosvg,
  svglib. Every proposed skill is covered with no install step.
- **Storage / blob.** Artifacts reuse the existing `media` container + asset SAS scheme
  (`{userId}/{threadId}/{assetId}.{ext}`); `AzureSasMinter` already mints SAS for
  pdf/docx/xlsx/pptx/csv. Only `application/zip` needs adding to `ALLOWED_CONTENT_TYPES` for
  ZIP bundles.
- **Cosmos.** No new container — artifacts ride on `thread.files` (`ThreadFileMeta`) and
  `message.artifacts`, both already synced. Serverless billing unaffected.
- **Skills packaging.** esbuild does **not** bundle `.md`. Ship each skill as a TypeScript
  module (`api/src/skills/<id>.ts` exporting `{ id, name, keywords, outputs, body }`, `body` a
  template-literal string) with a generated `index.ts` registry — compiled into
  `dist/index.cjs`, zero runtime file I/O.
- **Client.** Phase 1 needs no new deps (download via the existing SAS flow + `<a download>`).
  Inline PDF preview (Phase 3) adds `pdfjs-dist`; CSV/XLSX table preview adds a small parser
  (SheetJS) — both deferred, both standard Vite deps.

---

## 12. Phasing

- **Phase 0 — Spike (Azure de-risk): DONE / CONFIRMED (2026-06-27).** Verified against the
  live Foundry resource that `code_interpreter` runs on `/responses`, creates a container,
  writes a PDF, and that `GET /containers/{id}/files` + `…/{fileId}/content` return the real
  bytes. Retrieval will use container-file **listing** (not annotations). No fallback sandbox
  needed.
- **Phase 1 — Core artifact pipeline (covers the PDF ask):** capture `container_id` from the
  `code_interpreter_call`; on completion **list** container files + download `assistant`-sourced
  outputs; `uploadArtifact`; persist on message + thread; mount uploaded files via
  `container.file_ids`; basic artifact card + Download. (No skills yet — quality depends on the
  model.)
- **Phase 2 — Skills (inject):** bundled skill registry + keyword selection + system-prompt
  injection; provenance line in the card. This is what makes the A4 PDF *look professional*.
- **Phase 3 — Rich previews + Files-pane Artifacts section + versioning/iteration.**
- **Phase 4 — Skill tools (`search_skills`/`load_skill`), templates, conversions,
  dashboards, bundles, artifact search.**

---

## 13. Testing (EDD, per `documentation/06-delivery/`)

- **Server unit:** `container_id` capture from the streamed `code_interpreter_call`;
  container-file **listing** + download (mocked fetch) with dedupe + `assistant`-source filter;
  runWorker artifact path (list → download → upload → message.artifacts + thread.files +
  toolCall.artifactIds; idempotent; download-failure leaves text intact; size/mime guards);
  skill selection ranking.
- **Server integration (gated):** real run that asks for a tiny PDF/CSV and asserts a
  non-empty persisted blob of the right mime.
- **Client:** artifact card states (running → ready → error), preview routing by kind,
  download via SAS, sync of `artifacts` across reload.
- **Semantic invariant:** an artifact request yields a *real, openable file of the requested
  type* (assert magic bytes: `%PDF`, `PK\x03\x04` for docx/xlsx/zip), not just a tool card.

---

## 14. Open questions / risks

1. **Azure availability** of code-interpreter containers + the container-files endpoints —
   **RESOLVED**: confirmed working on the live Foundry resource (see §2). Retrieval uses
   container-file listing, since `container_file_citation` annotations proved unreliable.
2. **Container expiry timing** — must download within the run; long multi-step runs could
   approach the 20-min window. Mitigate by downloading on each `artifact` event, not at the
   end.
3. **Input-file mounting** — **RESOLVED**: `container.file_ids` with an `assistants`-purpose
   upload mounts the file into the sandbox and Python can read it (probed). `input_file` in the
   message is an alternative that also injects the doc into model context.
4. **Large files** — streaming download + blob upload; enforce caps.
5. **Mime/extension inference** for the client read-SAS path (`parseBlobPath`).
6. **Cost/latency** — code interpreter + larger memory tiers are billed; surface run cost in
   usage tracking; default `memory_limit` to 1g, bump only when needed.
7. **Cleanup** — deleting a thread/message should delete artifact blobs (extend existing
   thread-files cleanup).
