# Image Studio — UX/UI + Architecture Spec

Server-authoritative image generation studio. A dedicated, full-page workspace for
generating, organizing, searching, and iterating on AI images. Generation runs on the
server (queue worker) so closing the app never interrupts a job.

This spec is the implementation contract. It replaces the BYO-era playground at
`src/features/images/ImagesView.tsx`.

---

## 1. Research — how the leaders do it, and where they fall short

Surveyed: ChatGPT image generation (GPT-Image), OpenAI Sora library, DALL·E,
Midjourney, Adobe Firefly, Ideogram.

| Pattern | ChatGPT | Sora / DALL·E | Midjourney | Our take |
| --- | --- | --- | --- | --- |
| Where you generate | Inline in chat | Dedicated composer | Discord / web composer | **Dedicated studio** + still available in chat |
| In-flight feedback | Shimmer placeholder inline | Grid tile spinner | Progress % per tile | **Status cards** (queued / generating shimmer / ready / error), live via push |
| Survives app close | No (tied to chat stream) | Partly | Yes (server side) | **Yes — server queue worker** |
| Library / history | Buried, hard to search | Grid library | Grid + folders | **First-class searchable gallery** |
| Iterate on a result | "make it bluer" follow-up | Remix | Vary / remix / upscale | **Remix** (prompt + optional image reference) + **Variations** |
| Aspect ratios | Square / portrait / landscape | Several | Many | Square / portrait / landscape (+ quality, format, count) |
| Provenance | Hidden | Shows prompt | Shows prompt | **Metadata panel** (prompt, revised prompt, size, model, date, lineage) |
| Multiple per prompt | 1 | 1–varies | 4 | **1–4 (count selector)**, independent cards |

**Gaps we fix:**
1. ChatGPT generation is coupled to the chat stream — closing the tab can drop it.
   We make generation a durable server job.
2. The history is hard to find and not searchable. We make the gallery the home of
   the studio, searchable by prompt with filters.
3. Iteration is implicit ("make it bluer"). We make **Remix** explicit, with visible
   lineage (this image came from that one) and pre-filled settings.

---

## 2. Product principles

- **Server-authoritative.** The image record + status live in Cosmos; the bytes live in
  Blob Storage. The client is a projection. Closing the app does not stop a job; reopening
  re-syncs current state.
- **Optimistic, never lying.** The moment you hit Generate, placeholder cards appear with a
  real server record behind them (status `queued`). The card reflects true server status.
- **One card = one image.** A "generate 4" request creates four independent records/cards so
  each can succeed, fail, or be remixed on its own.
- **Provenance is visible.** Every image keeps its prompt, the model's revised prompt, size,
  model, timestamp, and its source image (for remixes).
- **No emoji in UI.** Use Fluent system icons / plain text (repo rule).

---

## 3. Information architecture

Route `/images` (replaces the current playground). Single full-height view:

```
┌─────────────────────────────────────────────────────────────┐
│  Composer (sticky top)                                        │
│  ┌───────────────────────────────────────────────┐  [Aspect] │
│  │ Describe the image you want to create…         │  [Count]  │
│  └───────────────────────────────────────────────┘  [Quality]│
│                                            [Generate ▶]        │
│  (Remix banner appears here when remixing a source image)     │
├─────────────────────────────────────────────────────────────┤
│  Toolbar:  [Search prompts…]      [All ▾ size]  [Newest ▾]    │
├─────────────────────────────────────────────────────────────┤
│  Gallery (scrolls)                                            │
│  ┌──────┐ ┌──────┐ ┌──────────┐ ┌──────┐                     │
│  │ gen… │ │ ✓img │ │  ✓ img   │ │ err  │   aspect-aware       │
│  └──────┘ └──────┘ └──────────┘ └──────┘   grid               │
│  ┌──────┐ ┌──────────┐ ┌──────┐ ┌──────┐                     │
│  └──────┘ └──────────┘ └──────┘ └──────┘                     │
└─────────────────────────────────────────────────────────────┘
```

Clicking a ready card opens the **Lightbox** (full-screen overlay).

---

## 4. Composer

- **Prompt** — multi-line textarea, autosize, Enter to generate / Shift+Enter newline.
  Placeholder: "Describe the image you want to create…".
- **Aspect** — segmented control: `Square` (1024×1024), `Portrait` (1024×1536),
  `Landscape` (1536×1024). Maps to API `size`.
- **Count** — 1–4. Number of independent images for this prompt.
- **Quality** — `Low` / `Medium` / `High` (default Medium). Maps to API `quality`.
- **Format** — fixed `png` for v1 (download offers conversion later). Not surfaced.
- **Generate** — disabled when prompt is empty or no image model is configured. On submit:
  immediately creates `count` placeholder cards and clears the prompt (keeps aspect/quality).
- **Disabled state** — if the user has no image model configured, the composer shows an inline
  notice ("No image model is configured. Add one in Settings.") and Generate is disabled.

### Remix mode

When the user hits **Remix** from the lightbox, the composer enters remix mode:
- A banner shows the source thumbnail + "Remixing this image".
- The prompt is pre-filled with the source prompt; aspect/quality copied.
- A toggle: **Use as reference** (image-to-image edit) vs **Prompt only** (fresh generation
  with the same settings). Default: Use as reference.
- Generate produces new records with `sourceImageId` set. A `Clear` (X) exits remix mode.

---

## 5. Gallery + cards

- **Layout** — responsive grid; each card sizes to the image's aspect ratio (CSS aspect-ratio
  from `size`). Newest first.
- **Card states:**
  - `queued` — neutral tile, small "Queued" label, subtle pulse.
  - `generating` — animated shimmer/skeleton with "Generating…" label.
  - `ready` — the image (lazy-loaded via the record's read-SAS `url`). Hover reveals a
    one-line prompt caption + quick actions (Remix, Download, Delete).
  - `error` — error tile with the message and a **Retry** action (re-submits same params) and
    Delete. `moderation_blocked` errors are shown verbatim and are NOT auto-retried.
- **Click** a ready card → Lightbox. Click a queued/generating card → no-op (or a small toast).
- **Empty state** — a friendly prompt-to-start panel with a few example prompts that pre-fill
  the composer.

---

## 6. Lightbox

Full-screen overlay; image on the left/center, metadata + actions on the right.

- **Image** — fit-to-screen; click outside or Esc closes. Left/Right arrows page through the
  current (filtered) gallery.
- **Metadata panel:**
  - Prompt (full, copyable).
  - Revised prompt (if the model returned one) — labeled "Model interpretation".
  - Size, quality, model, created date.
  - Lineage — if `sourceImageId`, a "Remixed from" thumbnail that navigates to the source.
- **Actions:**
  - **Download** — saves the original bytes (fetched from the SAS url).
  - **Copy prompt** — copies prompt to clipboard.
  - **Remix** — opens composer in remix mode with this image as source.
  - **Variations** — shortcut: remix with the same prompt + "use as reference", count 1.
  - **Delete** — confirm, then removes the record + blob; closes lightbox if it was the last.

---

## 7. Search + filters (toolbar)

- **Search** — text box; matches prompt text (server-side `CONTAINS` on `prompt`,
  case-insensitive). Debounced. Empty = all.
- **Size filter** — All / Square / Portrait / Landscape.
- **Sort** — Newest / Oldest.
- Filters compose with search. Results paginate (infinite scroll via continuation cursor).

---

## 8. Server architecture (mirrors the run engine)

```
POST /images ─► ImageService.create ─► N ImageGenRecord(queued) in Cosmos
                                   └─► N jobs ─► Storage Queue `image-jobs`
                                                      │
                       (queue trigger) imageWorker ◄──┘
                                   │
                 processImageJob:  read record ─► generating ─► SignalR push
                                   ─► creds.getDecrypted(userId)
                                   ─► generateImage | editImage (remix)
                                   ─► upload bytes (SAS write) ─► blobPath
                                   ─► ready (+revisedPrompt, +read url) ─► SignalR push
                                   └─ on failure ─► error ─► SignalR push
GET /images?q&size&sort&cursor&limit ─► ImageService.list (+read-SAS urls)
GET /images/{id} ─► ImageService.get (+read-SAS url)
DELETE /images/{id} ─► ImageService.remove (record + blob)
```

### 8.1 Data model — Cosmos container `images`, partition `/userId`

```ts
type ImageStatus = 'queued' | 'generating' | 'ready' | 'error';

interface ImageGenRecord {
  id: string;
  userId: string;            // partition key
  batchId: string;          // groups images created in one request
  status: ImageStatus;
  prompt: string;
  revisedPrompt?: string;
  size: string;             // '1024x1024' | '1024x1536' | '1536x1024'
  quality?: 'low' | 'medium' | 'high';
  outputFormat: 'png' | 'jpeg' | 'webp';
  model: string;
  blobPath?: string;        // set when ready: `${userId}/images/${id}.png`
  sourceImageId?: string;   // remix lineage
  useReference?: boolean;   // remix used the source image as an edit reference
  error?: { code: string; message: string };
  createdAt: string;
  updatedAt: string;
}
```

The HTTP layer enriches each `ready` record with a short-lived read `url` (read-SAS for
`blobPath`, TTL ~1h). The `url` is never persisted.

### 8.2 Infra

- **Cosmos**: add `{ name: 'images', pk: '/userId' }` to `infra/main.bicep` and deploy.
- **Queue**: `image-jobs` is created on demand by the starter (`createIfNotExists`) — no infra
  change, mirrors `run-jobs`.
- **Blob**: reuse the `media` container; image path `${userId}/images/${id}.png`. The worker
  mints a write SAS directly via `SasMinter` (no thread record needed — `AssetService.requestSas`
  requires a thread, which standalone images don't have).

### 8.3 New / changed files (server)

- `domain/imageGen.ts` — types, status helpers, `parseImageCreateInput` (zod).
- `ports/imageStore.ts` — `ImageStore` port.
- `adapters/cosmos/imageStore.ts` — `CosmosImageStore` (get/put/list/search/delete).
- `adapters/azure/queueImageStarter.ts` — `QueueImageStarter` + `IMAGE_QUEUE='image-jobs'` +
  `decodeImageJob`.
- `application/imageService.ts` — `ImageService` (create/list/get/remove + read-url enrichment).
- `application/imageWorker.ts` — `processImageJob(deps, userId, imageId)`.
- `functions/imageWorker.ts` — `app.storageQueue('imageWorker', …)`.
- `http/imagesController.ts` — `create/list/get/remove`.
- `ai/image.ts` — add `editImage(...)` for remix (POST `/images/edits`, multipart).
- `functions/api.ts` — routes `images` (GET/POST) + `images/{id}` (GET/DELETE).
- `composition.ts` — wire store, service, controller, `imageWorker` deps; `images` in
  `ApiContainer`.

### 8.4 Worker behavior

`processImageJob(userId, imageId)`:
1. Read record; if missing or status not `queued`/`generating`, no-op (idempotent redelivery).
2. Set `generating`; push.
3. `creds = credentials.getDecrypted(userId)`; if no `models.image`, set `error`
   (`no_image_model`), push, return.
4. If `sourceImageId` + `useReference`: read the source blob bytes (read SAS + fetch),
   `editImage({ image, prompt, size })`. Else `generateImage({ prompt, size, quality })`.
5. Upload returned bytes to `${userId}/images/${id}.png` via write SAS.
6. Set `ready` with `blobPath`, `revisedPrompt`; push.
7. On thrown error: set `error` with a safe `{code,message}`; push. Errors are not retried by
   the queue beyond the platform's default (idempotent: a terminal record short-circuits).

### 8.5 SignalR

- Worker pushes `signalr.sendToUser(userId, 'image', { image: ImageGenRecord })` on each status
  change. The pushed record carries a read `url` when `ready`.
- Client `RealtimeClient.on('image', handler)` updates the matching card in the store.

### 8.6 Endpoints (all invite-gated)

| Method | Route | Body / query | Returns |
| --- | --- | --- | --- |
| POST | `/images` | `{prompt, size?, count?, quality?, sourceImageId?, useReference?}` | `202 {images: ImageDTO[]}` |
| GET | `/images` | `?q=&size=&sort=&cursor=&limit=` | `200 {images: ImageDTO[], cursor?}` |
| GET | `/images/{id}` | — | `200 ImageDTO` |
| DELETE | `/images/{id}` | — | `204` |

`ImageDTO = ImageGenRecord & { url?: string }` (url present when `ready`).

---

## 9. Client architecture

### 9.1 New / changed files (client)

- `src/data/cloud/apiClient.ts` — add `createImages`, `listImages`, `getImage`, `deleteImage`.
- `src/features/images/imageStudioStore.ts` — Zustand store: `images`, `query`, `filters`,
  `composer` state, `remixSource`, actions (`generate`, `loadMore`, `search`, `remove`,
  `applyServerImage`), SignalR wiring.
- `src/features/images/ImagesView.tsx` — rewritten as the studio (composer + toolbar + gallery).
- `src/features/images/components/` — `Composer.tsx`, `Gallery.tsx`, `ImageCard.tsx`,
  `Lightbox.tsx`, `Toolbar.tsx`.
- `src/data/cloud/realtime.ts` — add `'image'` to the realtime event fan-out.

### 9.2 Store + sync

- On mount: `listImages()` (first page) → `images`. Subscribe to realtime `'image'`.
- `generate()`: call `createImages` → server returns `queued` records → prepend to `images`
  (placeholder cards). Realtime pushes drive each card to `generating`/`ready`/`error`. A poll
  fallback (every ~4s while any card is non-terminal) re-fetches those ids if push is absent.
- `remove(id)`: optimistic remove + `deleteImage`; rollback on failure.
- Records are not persisted to IndexedDB in v1 (server is the source of truth; the gallery
  re-fetches on load). The read `url` is ephemeral.

### 9.3 Rendering

- `<img loading="lazy" src={record.url}>` for ready images. On a 403 (expired SAS), the card
  re-fetches `getImage(id)` for a fresh url.
- Aspect ratio from `size` drives the card box (`aspect-ratio: w / h`).

---

## 10. Acceptance criteria

1. Submitting a prompt creates server records and shows placeholder cards immediately; the cards
   transition queued → generating → ready driven by the server (verified by closing and
   reopening the app mid-generation — the image still completes and appears).
2. Generating N (2–4) creates N independent cards.
3. Ready images render from a server read-SAS url; Download saves the original bytes.
4. Search filters by prompt text server-side; size/sort filters work and paginate.
5. Delete removes the record and the blob; the card disappears.
6. Remix pre-fills the composer, sets `sourceImageId`, and (with reference) uses the source image
   as an edit input; lineage is visible in the lightbox.
7. With no image model configured, the composer is disabled with a clear notice; no job is
   created.
8. No emoji anywhere in the UI; Fluent icons / plain text only.
9. Server: `npm run typecheck` + `npx vitest run` green; client: `npm run build` green.
```
