# Watai Library — Proposal Specification (Draft 1)

**Status:** Approved direction; implementation contract is
[library-implementation-spec.md](library-implementation-spec.md)

**Date:** 2026-07-19

**Scope:** A unified, account-level home for files and media uploaded to or created by Watai.

---

## 1. Executive summary

Watai should add a first-class **Library**: an account-owned catalog of durable files and media that users can find, inspect, reuse, download, trace back to their source conversation, and delete independently of chat history.

The Library is not just a gallery and not just a storage manager. It serves three primary jobs:

1. **Find and understand** — locate something created or uploaded in the past, view it in a format suited to its type, and understand where it came from.
2. **Reuse and continue** — attach it to a new or existing thread, remix it, copy its prompt/recipe, or return to the exact source message.
3. **Control and clean up** — understand storage use, review large or stale items, delete safely, and know what will happen in affected threads.

The recommended architecture makes files **account-owned Library items** and chat appearances **references** to those items. This decouples file lifetime from thread lifetime and avoids two bad outcomes:

- deleting a thread unexpectedly destroys useful work; or
- deleting a file leaves broken, unexplained holes in chat history.

The first release should unify uploaded chat files/images, generated chat images, Image Studio images, code-interpreter artifacts, and persisted thread documents. It should exclude external web-image results until the user explicitly saves/uses them, transient dictation audio, citations, memories, and skill packages.

---

## 2. Research review

### 2.1 ChatGPT Library

Current ChatGPT Library behavior (OpenAI Help, reviewed 2026-07-19):

- Uploaded and created files are automatically saved to an account-level Library.
- Library is independent of chats: deleting a chat does **not** delete its saved files.
- Users can browse in one place, search, and filter by Uploaded/Generated and file type.
- Files can be added to a chat through **Add from library**.
- Multi-select download is supported.
- A Storage view reports total use, remaining capacity, and over-limit status.
- Files remain until manually deleted.
- Recently deleted items can be restored or permanently deleted; permanent system deletion is scheduled within 30 days.
- Temporary Chat uploads are not saved.
- Generated images remain in a separate Images surface.

**What to adopt:** independent file lifecycle, automatic capture, reuse from the composer, search/source/type filters, multi-select actions, visible storage use, and reversible deletion.

**What to improve:** avoid splitting generated images and other files into disconnected libraries; preserve richer provenance; show source context; make deletion effects explicit inside chat.

Sources:

- [OpenAI Help, “File storage and Library in ChatGPT”](https://help.openai.com/en/articles/20001052-library-for-chatgpt)
- [OpenAI Help, “Chat and File Retention Policies in ChatGPT”](https://help.openai.com/en/articles/8983778-chat-and-file-retention-policies-in-chatgpt)
- [OpenAI Help, “Images in ChatGPT”](https://help.openai.com/en/articles/11084440-chatgpt-image-library)

### 2.2 Claude Artifacts

Current Claude Artifacts behavior (Claude Help, reviewed 2026-07-19):

- Significant self-contained outputs open in a dedicated workspace beside chat.
- Type-specific experiences include documents, code, websites, SVG, diagrams, and interactive components.
- Users can edit/iterate, switch versions, copy content, view source, and download.
- Multiple artifacts can coexist in one conversation and be explicitly selected for follow-up changes.
- A dedicated Artifacts section provides an organized collection, but conversation-created artifacts are promoted there only when published.
- Artifacts emphasize reusable work products rather than every attachment.

**What to adopt:** type-appropriate viewing, explicit iteration/version lineage, selecting a specific artifact for follow-up, and a strong detail workspace.

**What not to copy directly:** requiring “Publish” before an artifact is discoverable. Watai should capture durable uploads/outputs automatically, then let users star, organize, or hide them.

Source:

- [Claude Help, “What are artifacts and how do I use them?”](https://support.claude.com/en/articles/9487310-what-are-artifacts-and-how-do-i-use-them)

### 2.3 WhatsApp Manage Storage

Current WhatsApp cleanup behavior (WhatsApp Help, reviewed 2026-07-19):

- Total storage use is shown first.
- Users review media globally or per chat.
- Items can be sorted by Newest, Oldest, or Largest.
- Item size is visible directly in the grid.
- Opening an item exposes its chat and timestamp; **Show in chat** restores context.
- Long press enables multi-select and Select all.
- Cleanup emphasizes large items, frequently forwarded items, and duplicates.
- Deletion warnings explain permanence, copies, and whether chat/device copies remain.

**What to adopt:** storage summary, largest-first review, per-thread grouping, context navigation, batch selection, duplicate awareness, and precise deletion language.

Source:

- [WhatsApp Help, “How to free up storage on WhatsApp”](https://faq.whatsapp.com/5503646096388294)

### 2.4 Product synthesis

Watai’s Library should combine:

- ChatGPT’s **account-level retention and reuse**;
- Claude’s **rich artifact workspace and version lineage**; and
- WhatsApp’s **storage review and cleanup ergonomics**.

It should not present storage cleanup as a dramatic cost-saving feature when the actual cost is negligible at current scale.

---

## 3. Current Watai baseline

### 3.1 Persisted content today

| Content | Current metadata owner | Bytes owner | Existing provenance |
| --- | --- | --- | --- |
| User chat attachment | Nested on `MessageRecord.attachments[]` | Blob `{userId}/{threadId}/{id}.{ext}` | Thread/message, filename, MIME, bytes |
| Generated chat image | Nested on `MessageRecord.images[]` | Thread-scoped Blob path | Prompt, size, format, message |
| Code-interpreter artifact | Nested on `MessageRecord.artifacts[]`; duplicated into `thread.files[]` | Thread-scoped Blob path | Tool call, filename, MIME, bytes |
| Thread document | `ThreadRecord.files[]`; Azure OpenAI file/vector store | Azure OpenAI plus optional original Blob | Thread, file ID, status |
| Image Studio image | Separate `images` Cosmos container | Blob `{userId}/images/{id}.{ext}` | Prompt, revised prompt, model, settings, remix source |
| Web search image | Nested external URL | External site | Source URL; no durable Watai bytes |
| Skill package | `skills` Cosmos container | Blob `skills/{userId}/{id}.zip` | Skill/version metadata |
| Memory | `memory` container | Text only | Source thread/message where available |

### 3.2 Important gaps

- No account-wide query across message-nested assets.
- Chat-generated and Studio images use different metadata/storage paths.
- Most blob ownership is thread-scoped; deleting a thread cascades its blobs.
- Generated chat images do not yet persist complete reference-image lineage.
- Code artifacts record their source tool call but not all input file IDs.
- No item-level trash/restore lifecycle.
- No storage aggregation or orphan reconciliation.
- No consistent item-specific preview workspace.
- No cross-thread “attach from Library” workflow.

### 3.3 Current measured storage and cost

Measured on 2026-07-19 from the production `media` container:

- Storage account: StorageV2, Hot tier, Standard LRS, East US 2.
- 389 blobs.
- 596,126,638 bytes (568.51 MiB).
- The container inventory currently includes 388 thread assets and 1 skill package; skill-package
  bytes are not Library-eligible and must be excluded from user-facing Library totals.
- Blob soft delete: disabled.
- Blob versioning: disabled.
- Current Hot LRS capacity meter: approximately **$0.0184 per GB-month** for the first volume tier.
- Estimated current capacity cost: approximately **$0.0102/month**.

Other billable dimensions remain variable:

- Blob write/list/read operations (for example, current write/list meters are roughly $0.05 per 10,000 operations).
- Internet egress outside any included allowance.
- Cosmos serverless request units ($0.25 per 1M RU at the reviewed price) and metadata storage (roughly $0.25/GB-month).

**Product implication:** at current personal scale, cleanup will save fractions of a cent to a few cents per month. The primary value is findability, reuse, privacy, and control. Cost becomes meaningful only at much larger media volumes or with frequent downloads/derivatives.

The UI must label estimates as **storage capacity only**, not “your bill,” and should not use alarming quota language unless a real product quota exists.

Pricing references: [Azure Blob Storage pricing](https://azure.microsoft.com/en-us/pricing/details/storage/blobs/)
and [Azure Cosmos DB pricing](https://azure.microsoft.com/en-us/pricing/details/cosmos-db/serverless/).

---

## 4. User needs and jobs to be done

### N1. Recover past work without remembering its chat

> “I know Watai made/uploaded this, but I do not remember where.”

Needs:

- Search by filename, prompt, generated description, thread title, and date.
- Filter by type, origin, creator (uploaded/generated), thread, size, and recency.
- Visual recognition for images; scannable metadata for files.

### N2. Inspect content in the right medium

> “Let me see enough to know whether this is the item I need.”

Needs:

- Image gallery/lightbox.
- PDF page preview.
- Text/code/Markdown viewer.
- CSV/spreadsheet table preview.
- Presentation/document metadata and download-first fallback until rendering exists.
- Audio player only for deliberately persisted audio attachments.

### N3. Reuse an item as context

> “Use this in a new request without downloading and uploading it again.”

Needs:

- **Use in new chat**.
- **Add to current chat** from the composer.
- For images: **Remix/edit**, preserving selected reference IDs.
- For documents: attach as a file and index only when needed.
- Preserve the item’s stable ID so provenance and deduplication survive reuse.

### N4. Return to creation context

> “What did I ask for, and why was this generated?”

Needs:

- Show source thread title, message timestamp, and a prompt excerpt.
- **Show in chat** jumps to and highlights the exact message.
- If the source thread is gone, say so without making the item unusable.

### N5. Understand and reproduce generation

> “How was this image/file made, and can I make another?”

Needs:

- Copy original prompt.
- Copy a richer **generation recipe**: prompt, model, size/quality/format, and selected reference items.
- Show reference images as a navigable strip, including deleted-reference tombstones.
- Show parent/derived items and versions.

### N6. Manage clutter and storage safely

> “Show me what is large or no longer useful, and tell me exactly what deletion will do.”

Needs:

- Total active bytes, trash bytes, item count, and estimated capacity cost.
- Largest/oldest filters and per-thread breakdown.
- Multi-select delete/download.
- Recently deleted with restore and purge date.
- Permanent-delete option for immediate space recovery.
- Clear derivative/reference impact before deletion.

### N7. Preserve readable chat history after deletion

> “Deleting a file should not make the conversation look broken or misleading.”

Needs:

- Stable tombstone cards that retain filename/type/size or prompt provenance.
- Distinguish “in Recently deleted” from “permanently deleted.”
- Never show a dead image icon or endless loading state.
- Never imply a deleted file is still attached to model context.

### N8. Trust privacy and retention behavior

> “I should know what is durable, temporary, shared, or deleted.”

Needs:

- Temporary threads do not automatically populate Library.
- Library is private to the signed-in account in v1.
- Short-lived SAS URLs; no public blob URLs.
- Explicit retention and deletion wording.

---

## 5. Product principles

1. **One Library, multiple views.** Images, PDFs, uploads, and generated artifacts share one catalog, but not one generic viewer.
2. **Account-owned, context-linked.** A file belongs to the user’s Library; a chat references it and preserves provenance.
3. **Never lie about availability.** Deleted, missing, generating, and failed items have explicit states.
4. **Reuse without re-upload.** Library items are stable references, not copied bytes by default.
5. **Deletion is explainable and reversible first.** Normal delete moves to Recently deleted; permanent delete is explicit.
6. **Derivatives survive source deletion.** Deleting a reference image does not silently delete generated descendants.
7. **Storage facts, not fear.** Show measured bytes and honest capacity estimates; distinguish estimate from total Azure cost.
8. **Dense, operational UX.** This is a repeated-use catalog, not a marketing gallery.
9. **Mobile parity.** Search, filter, preview, select, download, reuse, and delete must all work without hover.
10. **No screenshots as component substitutes and no emoji.** Follow the existing design-system rules.

---

## 6. Scope

### 6.1 Included in v1

- User-uploaded chat images and files that are persisted to cloud storage.
- User-uploaded thread documents.
- Chat-generated images.
- Image Studio generated/remixed images.
- Code-interpreter output artifacts (PDF, DOCX, XLSX, PPTX, CSV, images, archives, code/text).
- Direct uploads made from Library.

Code-interpreter artifacts are message outputs, not reusable skill packages. Skills remain in the
dedicated Skills management surface.

### 6.2 Excluded from v1

- External web image results. Their URL metadata may remain persisted on a message, but Library
  ingestion must explicitly ignore `MessageRecord.webImages`. Once the user selects **Use** or
  **Save to Library**, the resulting durable attachment becomes Library-eligible.
- Search citations and fetched web pages.
- Transient voice/dictation recordings.
- TTS playback audio unless explicitly saved.
- Memories.
- Skill packages (managed in Skills, not Library).
- Model/container scratch files.
- Temporary-thread attachments unless explicitly saved before the thread expires.
- Shared/public libraries or collaborative folders.

### 6.3 Later candidates

- Saved web sources.
- OCR/content indexing.
- AI tags and semantic search.
- Collections/folders.
- Physical deduplication by content hash.
- Organization sharing and retention policies.

---

## 7. Information architecture

### 7.1 Entry points

- New primary navigation item: **Library**.
- Route: `/library`.
- Composer add menu: **Add from Library**.
- Message/file actions: **View in Library**.
- Image Studio gallery converges into `/library?kind=image`; `/images` redirects there. Image
  creation remains a dedicated action/subview backed by the same catalog, so there are not two
  competing image galleries.
- Settings > Storage links to `/library/storage`.

### 7.2 Main Library screen

Operational layout:

```text
┌─────────────────────────────────────────────────────────────────────┐
│ Library                                      [Upload] [Storage]      │
│ [Search files, prompts, and chats…]                                 │
│ All | Images | Documents | Spreadsheets | Presentations | Other     │
│ Source: All / Uploaded / Generated   Sort: Newest / Oldest / Largest│
├─────────────────────────────────────────────────────────────────────┤
│ Mixed list or type-specific gallery                                 │
│ thumbnail | name/prompt | type | source chat | date | size | actions│
└─────────────────────────────────────────────────────────────────────┘
```

Recommendations:

- **All:** dense list with thumbnail/icon, title, origin, date, size, and context.
- **Images:** aspect-aware gallery with prompt/title overlay and selection mode.
- **Documents/files:** compact list/table; do not force PDFs and spreadsheets into decorative image cards.
- Filter controls collapse into a mobile sheet.
- Selection mode exposes Download, Use in chat, and Delete.

### 7.3 Item detail workspace

Common header:

- Back to Library.
- Item name/title.
- Download.
- Use in chat.
- Show in chat.
- More menu: rename, star, delete.

Common metadata:

- Type/MIME and bytes.
- Uploaded or generated.
- Created date.
- Source thread/message.
- Model/tool where applicable.
- Lifecycle state.

Type-specific body:

| Type | Primary detail experience |
| --- | --- |
| Image | Full viewer, prompt, generation recipe, reference strip, dimensions, model, remix |
| PDF | Page preview + metadata + download |
| Text/Markdown/code/JSON | Searchable text/source viewer + copy |
| CSV | Bounded rows/columns table preview |
| XLSX | Phase 1: metadata + download-first fallback; Phase 5: workbook/sheet summary and first-sheet preview |
| DOCX/PPTX | Metadata and download-first in v1; rendered preview later |
| Audio | Player + duration when persisted |
| Archive/binary | Metadata + contents manifest if cheap; otherwise download |

### 7.4 Image provenance

Generated image detail should show:

- Original user prompt.
- Revised/expanded prompt, clearly labeled as model interpretation.
- Model, size, quality, format, and generation date.
- **Copy prompt**.
- **Copy recipe** (structured text including settings and reference item IDs/names).
- Reference images in order with role labels where known (template, character, style, source).
- Parent image and derived images.
- Source chat jump.

The semantic manager already chooses stable reference image IDs, but current `MessageImage` and
`ImageGenRecord` schemas do not persist the complete selected list. Before Library ingestion ships,
both chat `runWorker` and Image Studio `imageWorker` must write reference IDs onto generated-image
metadata. Existing items without this field must show **Reference history unavailable** rather than
inventing or inferring a recipe.

---

## 8. Core workflows

### 8.1 Find and inspect

1. Open Library.
2. Search or choose type/source filters.
3. Sort by Newest, Oldest, or Largest.
4. Open an item in the appropriate detail viewer.
5. Download, reuse, or show source context.

### 8.2 Start a new thread from an item

1. Select **Use in new chat**.
2. Watai creates a new thread and stages the Library item in the composer.
3. For an image, optional modes are **Use as reference** or **Attach for analysis**.
4. User adds instructions and sends.
5. The new message stores the same `libraryItemId`; bytes are not duplicated.

Do not auto-send. The user must be able to add intent before invoking the model.

### 8.3 Add from Library while composing

1. Composer + menu > **Add from Library**.
2. Compact picker opens with Recent, Images, Documents, and Search.
3. User selects one or more compatible items.
4. Selected items appear as normal composer attachments with a Library provenance marker.

Compatibility in v1:

- Images: attach for analysis or select as image-generation references.
- PDF, text, Markdown, CSV, JSON, DOCX, PPTX, XLSX: attach/index using the existing file pipeline.
- Audio: attach only where the existing chat pipeline supports persisted audio.
- Archives, executable binaries, and unsupported artifact formats: download-only until the model
  input pipeline explicitly supports them.

### 8.4 Show in chat

1. Detail action navigates to the source thread.
2. Chat scrolls to `sourceMessageId`.
3. Target message receives a brief focus highlight.
4. If the thread was deleted, show “Source conversation was deleted” and keep the item usable.

Image Studio and direct Library uploads have no source chat. Their action is **Open in Image Studio**
or no context action, respectively; do not render a disabled or misleading Show in chat command.

### 8.5 Storage cleanup

1. Storage view shows active bytes, Recently deleted bytes, item count, and estimated storage capacity cost.
2. Review lanes: Largest, Oldest, By type, By thread, and Potential duplicates.
3. User opens an item or multi-selects items.
4. Delete confirmation reports:
   - total bytes selected;
   - number of source chats affected;
   - number of derived items that will remain;
   - trash retention/purge date; and
   - when space will actually be reclaimed.
5. Normal delete moves items to Recently deleted.
6. Permanent delete immediately attempts blob removal and space recovery.

### 8.6 Delete a thread

Current thread-prefix blob deletion must change.

Recommended confirmation:

> Delete this conversation?
>
> The conversation will be deleted. Its 6 Library items (24.8 MB) will be kept.
>
> [Delete conversation] [Delete conversation and move its Library items to Recently deleted]

Default: preserve Library items, matching the account-owned model.

The second action must include only items whose creation origin is thread-owned and whose immutable
`source.threadId` equals the deleted thread: `chat_upload`, `chat_generated_image`, or
`code_artifact`. An Image Studio/Library item reused in that thread remains owned by its original
source and must not be trashed.

---

## 9. Deletion and missing-content semantics

### 9.1 Lifecycle states

```ts
type LibraryItemState =
  | 'pending'
  | 'active'
  | 'trashed'
  | 'purging'
  | 'purged'
  | 'missing'
  | 'failed';
```

- `pending`: metadata reservation exists; durable bytes are not yet committed and the item is not
  shown in the normal Library.
- `active`: available normally.
- `trashed`: hidden from main Library; blob retained and restorable.
- `purging`: permanent delete in progress.
- `purged`: bytes removed; minimal tombstone metadata retained.
- `missing`: metadata exists but blob reconciliation cannot find bytes.
- `failed`: generation/upload never produced durable bytes.

### 9.2 Recommended trash retention

Locked for this implementation cycle: **7 days**, because Watai is a personal cost-conscious
deployment and immediate capacity recovery matters more than long enterprise retention. The UI shows
the exact purge date.

### 9.3 Chat rendering after deletion

Never remove the entire attachment/image block without explanation.

**Trashed:**

```text
[Image icon] IMG_7876.jpg
In Recently deleted · Restorable until Jul 26
[Restore] [View details]
```

**Purged:**

```text
[Image icon] Image deleted from Library
Original: IMG_7876.jpg · 2.5 MB
```

For generated images, retain bounded provenance in the message:

```text
Generated image deleted from Library
Prompt: “Create a miniature bridge…”
[Copy prompt]
```

For other classes, retain class-appropriate snapshots:

```text
[PDF icon] Document deleted from Library
Original: report.pdf · 2.8 MB

[Spreadsheet icon] Generated file deleted from Library
Original: forecast.xlsx · 156 KB · Created with code interpreter

[Attachment icon] Attachment is in Recently deleted
Original: notes.docx · Restorable until Jul 26
[Restore]
```

Rules:

- Do not render broken `<img>` elements.
- Do not keep retrying expired/missing SAS URLs indefinitely.
- Do not include purged files in model context.
- Purging a source image does not purge descendants; descendant detail shows a source tombstone.
- Restoring a trashed item restores all message/library references automatically.
- Local IndexedDB caches must be evicted when a purge event syncs, otherwise “deleted” bytes remain on devices.

---

## 10. Storage UX and cost communication

### 10.1 Storage dashboard

Show:

- Active Library bytes.
- Recently deleted bytes.
- Total persisted item count.
- Breakdown by Images / Documents / Other.
- Breakdown by Uploaded / Generated.
- Largest threads by originated bytes.
- Estimated capacity cost/month.
- “Variable operations and download costs are not included.”

At current measured usage, example copy should be understated:

> 568.5 MB stored
>
> Estimated Blob capacity: about $0.01/month at the current Hot LRS rate. Downloads, operations, metadata, and taxes are separate.

### 10.2 Cost calculation

```text
capacityEstimate = billableBlobBytes / 1 GiB × regionalHotLrsRate
```

- Fetch Azure Retail Prices API server-side and cache daily, or use a deployment setting.
- Store the rate, currency, region, SKU, and retrieval timestamp with the estimate.
- Never present capacity estimate as the final Azure bill.
- Cosmos metadata costs should be described, not estimated per item in v1.

### 10.3 Usage aggregation

Do not enumerate Blob Storage on every page load.

- Query aggregate `bytes` from active/trash Library records within the `/userId` partition.
- Reconcile against Blob Storage periodically or on-demand from an admin/maintenance action.
- Expose “Last checked” on storage stats.
- Track orphan bytes separately; they are invisible clutter that item deletion cannot reclaim.

### 10.4 Duplicates

V1: compute SHA-256 at ingestion and flag exact duplicate content, but keep independent item records and blobs unless deduplication is explicitly implemented.

Later: content-addressed physical blobs with reference counts. Do not introduce physical deduplication until delete/reference semantics are transactional and tested.

---

## 11. Proposed data model

### 11.1 New `library` Cosmos container

Partition key: `/userId`.

```ts
type LibraryKind =
  | 'image'
  | 'pdf'
  | 'document'
  | 'spreadsheet'
  | 'presentation'
  | 'data'
  | 'audio'
  | 'archive'
  | 'code'
  | 'text'
  | 'other';

type LibraryOrigin =
  | 'chat_upload'
  | 'library_upload'
  | 'chat_generated_image'
  | 'studio_generated_image'
  | 'code_artifact'
  | 'thread_document';

interface LibraryItemRecord {
  id: string;
  userId: string;
  state: LibraryItemState;
  /** Stable source-scoped idempotency key, e.g. chat_attachment:<attachmentId>. */
  ingestionKey: string;

  kind: LibraryKind;
  origin: LibraryOrigin;
  name: string;
  mime: string;
  bytes: number;
  blobPath?: string;
  contentHash?: string;

  createdAt: string;
  updatedAt: string;
  trashedAt?: string;
  purgeAfter?: string;
  purgedAt?: string;

  source?: {
    surface: 'chat' | 'image_studio' | 'library';
    threadId?: string;
    messageId?: string;
    runId?: string;
    toolCallId?: string;
  };

  image?: {
    width?: number;
    height?: number;
    size?: string;
    format?: 'png' | 'jpeg' | 'webp';
    prompt?: string;
    revisedPrompt?: string;
    model?: string;
    quality?: 'low' | 'medium' | 'high';
    referenceItemIds?: string[];
  };

  artifact?: {
    sourceItemIds?: string[];
    version?: number;
  };

  userMetadata?: {
    title?: string;
    starred?: boolean;
    tags?: string[];
  };
}
```

### 11.2 Message/thread references

Add `libraryItemId` to:

- `MessageAttachment`.
- `MessageImage`.
- `MessageArtifact`.
- `ThreadFileMeta` where a durable original exists.

Keep bounded snapshots (name, MIME, bytes, prompt) on messages for offline rendering and tombstones. The Library record is canonical for availability and lifecycle; the message snapshot is canonical for historical presentation.

### 11.3 Blob ownership

New blobs should use an account-level path:

```text
{userId}/library/{libraryItemId}.{ext}
```

Do not place new durable Library bytes under a thread prefix.

Why:

- Thread deletion can no longer own file deletion.
- One item can be reused in many threads without byte copies.
- Storage accounting and item purge become direct.

### 11.4 Relationship model

V1 keeps:

- one primary creation context (`source.threadId/messageId`);
- forward lineage (`referenceItemIds` / `sourceItemIds`); and
- chat usages implicitly through message `libraryItemId` references.

Do not embed an unbounded `usedInThreads[]` array on the item. If reverse usage queries become necessary, add a separate `libraryRefs` container or query a dedicated materialized reference index.

---

## 12. Server architecture

### 12.1 Services

- `LibraryStore` — get/list/search/upsert/transition/aggregate.
- `LibraryService` — authorization, listing, storage stats, trash/restore/purge.
- `LibraryIngestionService` — creates item records from uploads, generated images, and artifacts.
- `LibraryPurgeWorker` — deletes blobs after retention and writes minimal tombstone state.
- `LibraryReconciler` — detects missing/orphan blobs and repairs counters.

### 12.2 Ingestion integration points

- `MessageService.append`: register cloud-persisted attachments.
- `runWorker`: first persist selected image reference IDs and code-artifact input item IDs, then
  register generated chat images and code-interpreter artifacts.
- `imageWorker`: first persist all remix/reference item IDs on `ImageGenRecord`, then register Image
  Studio outputs/remixes.
- `ThreadFilesService`: register original persisted documents.
- Library upload endpoint: register direct uploads.
- Explicitly ignore `MessageRecord.webImages`; only durable attachments enter Library.

Every thread-derived ingestion call must carry the thread’s `temporary` flag. When true, automatic
Library ingestion is skipped. An explicit **Save to Library** action creates a new Library-owned item
before the temporary thread expires. M1 backfill must exclude items whose source thread is marked
temporary; if that thread no longer exists, classify the source as unknown and report it for review
rather than auto-ingesting it.

Use a deterministic `ingestionKey` per source object and idempotent upserts. Recommended sequence:

1. Upsert `pending` Library metadata using the stable source ID.
2. Commit and verify durable bytes.
3. Transition the same record to `active` with `blobPath`, bytes, hash, and provenance.
4. If byte persistence fails, transition to `failed`; never expose it as active.
5. If bytes succeed but the active transition fails, the reconciler completes the transition from
   source metadata/blob evidence instead of creating a second item.

The same ingestion key must always produce the same Library item ID. Never publish an active item
pointing at uncommitted bytes.

### 12.3 APIs

| Method | Route | Purpose |
| --- | --- | --- |
| GET | `/library` | Cursor list/search/filter/sort |
| POST | `/library/uploads` | Begin direct upload / obtain write grant |
| GET | `/library/{id}` | Detail + fresh preview/download URL |
| PATCH | `/library/{id}` | Rename/star/tags |
| DELETE | `/library/{id}` | Move to Recently deleted |
| POST | `/library/{id}/restore` | Restore |
| DELETE | `/library/{id}/permanent` | Purge now |
| POST | `/library/batch` | Batch download metadata/delete/restore/purge |
| GET | `/library/storage` | Aggregates, breakdown, estimate, last reconcile |
| GET | `/library/{id}/usages` | Later: contexts where reused |

Read/download URLs remain short-lived user-scoped SAS grants.

### 12.4 Query/filter contract

```text
GET /library?
  q=
  kind=image,pdf
  origin=uploaded|generated
  state=active|trashed
  threadId=
  minBytes=
  maxBytes=
  createdAfter=
  createdBefore=
  sort=newest|oldest|largest|name
  cursor=
  limit=50
```

Search v1 covers normalized name, prompt/revised prompt, and source thread title snapshot. Full document-content search is later.

### 12.5 Events and sync

SignalR/library events:

```ts
{ type: 'library.item.updated', item }
{ type: 'library.item.trashed', itemId, purgeAfter }
{ type: 'library.item.purged', itemId }
{ type: 'library.storage.updated', summary }
```

Client actions:

- Update Library cache.
- Replace message media with trash/purge tombstones.
- Evict local blob cache on purge.
- Refresh storage summary.

---

## 13. Migration plan

### M0. Inventory and safety gates

- Add cross-source migration tests.
- Count existing message assets, Studio images, thread files, and blobs.
- Detect duplicate IDs/paths and orphan blobs.
- Freeze current thread-prefix deletion behavior behind a compatibility branch.

Migration is blocked until the dry run proves:

- 100% of message attachments/artifacts with `blobPath` resolve to a blob or are explicitly reported
  as missing.
- 100% of ready Image Studio records resolve to a blob.
- Zero duplicate proposed Library IDs or ingestion keys exist across origins.
- Every blob is classified as indexed content, known non-Library content (for example skills), or an
  investigated orphan; no unidentified blob is deleted automatically.
- Existing items with unrecoverable image/artifact reference lineage are counted and marked as
  partial provenance.
- Inventory classifies both known path families explicitly: thread-owned
  `{userId}/{threadId}/{id}.{ext}` and Image Studio `{userId}/images/{id}.{ext}`. The latter must
  never be reported as a thread orphan merely because it sits outside a thread prefix.

### M1. Create Library index for existing metadata

Backfill `LibraryItemRecord` from:

- message attachments/images/artifacts;
- Image Studio records; and
- thread document metadata.

Initially records may reference legacy blob paths.

### M2. Migrate blob ownership

For each legacy item:

1. Copy blob to `{userId}/library/{itemId}.{ext}`.
2. Verify length/hash.
3. Patch Library record and message `libraryItemId`.
4. Delete legacy blob only after verification.
5. Record resumable checkpoint.

The migration must handle both existing path families: thread-owned
`{userId}/{threadId}/{id}.{ext}` attachments/chat images/artifacts, and account-owned
`{userId}/images/{id}.{ext}` Image Studio outputs.

### M3. Change new-write paths

All new uploads/outputs go directly to Library-owned paths and emit message references.

### M4. Change thread deletion

- Stop prefix-deleting Library-owned blobs.
- Delete only legacy/unindexed thread assets during compatibility period.
- Offer “delete thread and trash originated items.”

### M5. Enable item deletion/tombstones

Only after every rendering path handles `trashed/purged/missing` safely.

### M6. Reconcile and retire compatibility paths

- Verify no active Library record points to a legacy thread path.
- Remove legacy deletion exceptions.
- Run orphan report before deleting unidentified blobs.

---

## 14. Phased product delivery

### Phase 1 — Read-only unified Library

- Account-wide list/search/filter.
- Type-specific image and basic file details.
- Download, copy prompt, show in chat.
- Storage summary based on metadata.
- No item delete yet.

**Why first:** proves indexing/provenance without risking data loss.

### Phase 2 — Reuse

- Add from Library composer picker.
- Use in new chat.
- Image remix with persisted reference IDs.
- Direct Library upload.

### Phase 3 — Safe lifecycle

- Account-owned blob paths.
- Recently deleted, restore, permanent delete.
- Chat tombstones.
- Thread-delete choice.
- Local cache eviction and purge worker.

### Phase 4 — Storage management

- Largest/oldest/per-thread views.
- Multi-select cleanup.
- Cost estimate and potential savings.
- Duplicate detection.
- Orphan reconciliation.

### Phase 5 — Rich artifact workspace

- PDF/text/table previews.
- Version/derivative graph.
- Rename/star/tags/collections.
- Full content or semantic search if justified by usage.

---

## 15. Acceptance criteria for first implementation slice

1. All persisted uploads, generated chat images, Studio images, and code artifacts appear once in Library.
2. Search matches filename and prompt; source/type filters and newest/largest sort work.
3. Images use a gallery; mixed/files use a dense list; both work on mobile.
4. Opening an item shows type-appropriate preview or a deliberate download-first fallback.
5. Download uses fresh SAS and existing iOS-safe save behavior.
6. Show in chat opens and highlights the exact source message for chat-originated items; Image
  Studio items expose Open in Image Studio, and direct uploads expose no source-context action.
7. Copy prompt copies the stored original prompt, not alt text or revised prompt.
8. Copy recipe includes model/settings and valid recorded reference item IDs. Historical items with
  incomplete lineage explicitly label the missing provenance.
9. Use in new chat stages the same Library item without duplicating bytes or auto-sending.
10. Storage summary equals Library metadata aggregates and shows “last checked.”
11. Temporary-thread items do not enter Library unless explicitly saved.
12. No deletion ships until trash/purge/missing tombstones are validated across every message renderer.

---

## 16. Evaluation plan

### Product tasks

- Find an image generated two months ago without knowing the thread.
- Find the largest PDF and open its source message.
- Start a new thread from a prior generated image and two old references.
- Copy a generation prompt and recipe.
- Delete five large items, restore one, permanently purge the rest.
- Open old threads after source and output media have been deleted.
- Delete a thread while preserving its Library items.

### Semantic invariants

- Reusing an item does not duplicate blob bytes.
- One Library item ID resolves consistently across threads/devices.
- Purged content is absent from model context and local cache.
- Chat never renders a broken media element for trashed/purged/missing content.
- Deleting a source does not delete descendants.
- Storage aggregates equal active/trash item metadata within a documented tolerance.
- Show in chat always resolves the stored source message or explicitly reports that it was deleted.

### Evidence

- API/domain tests for lifecycle transitions and authorization.
- Migration replay/idempotency tests.
- Browser mobile/desktop tests for filters, selection, detail, tombstones, and composer reuse.
- Blob/Cosmos reconciliation report.
- Cost estimate fixture using a fixed regional retail rate.

---

## 17. Risks and mitigations

| Risk | Mitigation |
| --- | --- |
| Migration deletes or duplicates blobs | Copy + verify hash/length before deleting; resumable checkpoints; dry-run report |
| Thread delete still removes Library bytes | Move writes to account-owned paths; migration gate; explicit integration tests |
| Library index drifts from Blob Storage | Idempotent ingestion, lifecycle state machine, reconciliation job |
| Full-thread provenance arrays grow unbounded | Store primary origin on item; message refs for usage; separate reverse index only if needed |
| SAS expiry creates broken previews | Refresh item detail URL on 403; map 404/410 to tombstone |
| Batch cleanup deletes useful references | Show source/descendant counts; trash first; restore window |
| Cost UI overstates savings | Show capacity-only estimate, measured bytes, rate timestamp, and exclusions |
| Too many generic cards | Type-specific views and detail workspaces |
| Duplicates inflate storage | Content hashes and duplicate review; physical dedupe deferred until safe |
| Temporary/private content becomes durable | Explicit Library eligibility policy; temporary threads excluded |

---

## 18. Decisions resolved by the implementation contract

The detailed build contract locks these choices for this cycle:

1. Recently deleted retention is 7 days.
2. All eligible durable chat uploads/outputs are indexed automatically; temporary-thread content is excluded unless explicitly saved.
3. Thread deletion preserves Library items by default.
4. `/library` is canonical; `/images` redirects to the image-filtered Library and creation remains a subview/action.
5. Rename and star ship before tags/folders.
6. Phase 1 previews images, PDFs, text/Markdown/code/JSON, and CSV; XLSX/DOCX/PPTX/archive are download-first.
7. Application-level trash is product state; Blob soft delete is not the UX state machine.
8. No artificial product quota ships in this cycle.
9. Copy recipe defaults to human-readable text with optional JSON.
10. Source purge keeps no hidden source copy; descendants show a source tombstone.

See [library-implementation-spec.md](library-implementation-spec.md) §1 for the authoritative table.

---

## 19. Recommended next step

Do **not** begin with deletion or a large frontend build.

Build a read-only architecture spike:

1. Define `LibraryItemRecord` and a cross-source projection function.
2. Run it against a production metadata export in dry-run mode.
3. Produce counts/bytes by origin/type plus duplicate/orphan/conflict reports.
4. Validate source-message navigation for a representative sample.
5. Prototype two real views only: mixed dense list and image gallery/detail.
6. Decide migration/blob-ownership mechanics from the report before implementing destructive lifecycle actions.

This sequence tests the central claim—one trustworthy catalog—without putting existing user data at risk.
