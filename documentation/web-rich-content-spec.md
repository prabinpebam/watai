# Rich Web Content & Web Images as Chat Files — Design, Architecture & Plan

Status: design + phased build. Owner: this workstream. Audience: implementers.

---

## 1. Problem & motivating scenario

Observed session (verbatim flow):

1. "Can Tavily return images in search results?" → assistant: yes (`include_images`, `include_image_descriptions`).
2. "search the image of a cat" → assistant returned **text links only** (Canva/Pixabay/…), no images.
3. "Find a single image of a cat and display it inline" → assistant emitted a raw markdown image (`![](unsplash-url)`).
4. "Now draw cute kawaii doodles over it" → assistant: *"I need the actual cat image uploaded here first… the image-edit tool needs an uploaded/reference image in chat."*
5. "Can't you use code interpreter to fetch the image?" → assistant: *"code interpreter here has no outbound internet."*
6. "Use the image URL from earlier" → assistant: *"no outbound internet… upload the cat image."*

**The dead-end:** web search can surface images, but (a) the app never shows them, and (b) an image that *is* shown inline is just an external URL — **not a usable chat file**, so the image tool can't edit it without the user manually re-uploading. The whole point of "find an image and do X to it" collapses.

**Root capability gap:** an image only becomes *usable* (vision context + `edit_reference` for the image model) when its **bytes** live in our blob store as an `Attachment`. An external `https://…jpg` is never that.

---

## 2. Goals / non-goals

**Goals**
- G1. Web search can **return images**, rendered **inline** as subtle, attributed rich content.
- G2. A web image becomes a **usable chat file with one tap** — no manual download/upload. "Web images" are a first-class chat-file source.
- G3. Once ingested, a web image works with the **existing** pipeline: vision context + `generate_image` `edit_reference` (so "make it kawaii" just works).
- G4. Rich content is **subtle**, on-brand (design tokens, no emoji, reduced-motion aware), and degrades gracefully.
- G5. Security: server-side fetch is **SSRF-guarded**, size/time-bounded, image-only.

**Non-goals (this workstream)**
- N1. Full social-style link unfurling/embeds for every URL (link preview cards are Phase 2, optional).
- N2. Giving code interpreter internet access (out of scope; not needed once images are ingestable).
- N3. Video/audio rich content.
- N4. Persisting raw external URLs as permanent records (we ingest **bytes**, not URLs).

---

## 3. Scenario catalog — when users want rich web content

| # | User intent | Today | Desired |
|---|---|---|---|
| S1 | "show me pictures of X" | text links | inline image strip with sources |
| S2 | "find an image of X and edit/use it" | dead-end (manual upload) | tap **Use** → it's a chat file → edit |
| S3 | "what's the latest on X" (Q&A) | text answer + source chips | answer + richer source cards |
| S4 | "quote the relevant passage" | plain blockquote | attributed quote/snippet card |
| S5 | model emits `![](url)` inline | shows image, but unusable | shows image **+ Use affordance** |
| S6 | comparison ("X vs Y") | text | side-by-side source cards (Phase 2) |

Primary value (and the reported pain): **S1, S2, S5**. Secondary polish: **S3, S4**.

---

## 4. Rich-content taxonomy

1. **Inline web images** (primary) — image results from web search, shown as a horizontal, attributed thumbnail strip on the assistant message. Each: lazy thumbnail, source domain/favicon, **Use** action, click → lightbox.
2. **Usable markdown images** — when the assistant emits `![](url)`, the rendered image gains a hover **Use** affordance (and a Use button in the lightbox).
3. **Source cards** (enhancement of existing chips) — favicon + title + domain + snippet; optional thumbnail when the citation carries one.
4. **Quote / snippet card** (Phase 2) — a styled pull-quote with favicon + domain attribution, for when the assistant cites a passage.
5. **Link preview card** (Phase 2, optional) — title/description/thumbnail for a single URL.

Everything is **additive** to the existing message render (markdown body → web images → tool cards → sources → actions).

---

## 5. UX / UI design (mapped to the design system)

Design language constraints honored: subtlety over vibrancy, surfaces (`--color-surface-1/2`, `--radius-md`, `--elevation-1`), spacing on the `--space-*` grid, **no emoji** (Fluent/Material icons via `<Icon>`), `prefers-reduced-motion` respected, WCAG-AA contrast, touch targets ≥ 40px.

### 5.1 Inline web image strip (`.web-images`)
- Placement: directly under the markdown answer, **above** the sources strip.
- Layout: horizontal scroll strip of `.web-image` cards (thumbnail ~120×120, `--radius-md`, `1px --color-border`). On wide screens, wrap to a 2–3 row mini-grid if ≤ 6.
- Each card:
  - Lazy `<img loading="lazy">` (object-fit: cover), click → existing `Lightbox`.
  - Hover/focus overlay (bottom): a small **Use** pill button (`Icon name="add-image"` + "Use") and a source link chip (favicon + domain, opens the source page).
  - States: loading shimmer (reuse `.attach-thumb--loading`), broken-image fallback (hide the card if the image 404s — `onError`).
- Subtle header row: `Icon name="image"` + "Images from the web" caption in `--color-text-secondary` + count.

### 5.2 "Use" affordance on markdown images (`.md-img`)
- On hover/focus of an assistant `.md-img`, a small floating **Use** button (top-right). In the lightbox, a **Use image** button in the bar.
- Tap → ingest → toast "Added to your message" → image appears in the composer pending attachments.

### 5.3 Use → composer
- Ingest returns bytes; the frontend builds a `File` and calls the composer's existing `addFiles`. The image shows as a normal pending thumbnail (`.composer-thumb`). The user types an instruction and sends — **identical** to a manual upload from here on.
- If the composer isn't mounted/focused for that thread, route to the thread and add it (edge handled by a shared "stage attachment" action in the UI store).

### 5.4 Source cards (enhancement)
- Keep the existing `.source-chip` + `SourcePane`. When a citation has a thumbnail (future), show it; otherwise unchanged. Low risk, mostly CSS.

### 5.5 Empty/failure states
- No images found → no strip (silent).
- Ingest failure (SSRF block / too big / not an image / timeout) → inline toast with the reason; the image stays viewable, just not ingested.

---

## 6. Architecture

### 6.1 Data model additions

**Frontend `src/lib/types.ts`** — new `WebImage` + `Message.webImages?`:
```ts
export interface WebImage {
  id: Id;
  url: string;            // external image URL (display + ingest source)
  description?: string;   // from Tavily include_image_descriptions
  sourceUrl?: string;     // page the image came from, when available
}
// Message gains: webImages?: WebImage[];
```

**Backend `api/src/domain/message.ts`** — strict, bounded zod (mirrors `citationSchema`):
```ts
const webImageSchema = z.object({
  id: z.string().min(1).max(64),
  url: z.string().url().max(2048),
  description: z.string().max(1000).optional(),
  sourceUrl: z.string().url().max(2048).optional(),
}).strict();
// appendSchema + record schema gain: webImages: z.array(webImageSchema).max(12).optional()
```
`messageFromRecord` / `appendBodyFromMessage` map it 1:1 (like `citations`).

> Note: any new **synced** field MUST be added to the backend strict schema or the whole message append 400s (recorded gotcha). `webImages` is synced, so both schemas change together.

### 6.2 Web search returns images (Tavily)
- `tavilySearch` opts gain `includeImages`, `includeImageDescriptions`; body adds `include_images: true`, `include_image_descriptions: true`. Response type gains `images?: Array<string | { url: string; description?: string }>` (Tavily returns `string[]` normally; objects when descriptions are on). A small `normalizeTavilyImages(resp)` maps either shape → `{ url, description? }[]` (pure, unit-tested).
- web_search executor (`makeExecute`) returns `{ output, citations, webImages }`. The `output` text also lists the image URLs so the model is *aware* of them (and may reference them). `webImages` are capped (e.g., 8) and deduped by URL.

### 6.3 Orchestrator / worker plumbing (mirror citations)
- `ToolResult` gains `webImages?: WebImage[]`.
- `orchestrator.runAgent`: after `execute()`, forward `result.webImages` as a new event `{ type: 'webImages', webImages }` (parallel to how `citations` are emitted).
- `AgentEvent` union gains `webImages`.
- `runWorker`: accumulate `webImages` onto the message (dedup by url, cap 12), `flush(true)` on arrival — exactly like `citations`.

### 6.4 Web-image ingestion endpoint (the crux)
New invite-gated endpoint that the **browser** calls because it cannot read cross-origin image bytes (CORS):

`POST /api/web/image` → body `{ url: string }` → `{ dataBase64: string; mime: string; bytes: number }`

- Service `WebImageService.fetch(url)`:
  - Validate via pure `assertFetchableImageUrl(url)` (unit-tested): scheme ∈ {http,https}; reject credentials in URL; reject hosts that are literal loopback/private/link-local/`*.local`/cloud metadata (`169.254.169.254`, `metadata.*`); host must be present.
  - `fetch` with: 10 s timeout, `redirect: 'manual'` (re-validate each hop; max 3 hops); require `content-type: image/*` (png/jpeg/webp/gif); enforce a **size cap** (e.g., 12 MB) via streamed/`content-length` check; on success base64-encode.
  - Errors → typed `AppError` (validation/timeout/too_large/not_image), surfaced to the client (we already un-mask AI errors; reuse the envelope).
- Controller `createWebController` → route in `api.ts` → wired in `composition.ts` (standard pattern).
- **Privacy/cost:** returns bytes to the client; the client re-uploads via the **existing** attachment sync (write-SAS PUT). No new blob/server-buffer concept; the data model stays "a normal image attachment."

### 6.5 Frontend wiring
- `cloudApi.fetchWebImage(url): Promise<{ dataBase64; mime; bytes }>`.
- A shared `useWebImage()` (or a UI-store action `stageWebImage`) that: calls the endpoint → `base64ToBlob` → `new File([blob], name, {type})` → composer `addFiles([file])` → toast.
- `WebImages` component renders `message.webImages` as the strip (§5.1).
- `Markdown` `img` renderer: for assistant messages, wrap `.md-img` with a hover **Use** button (§5.2); also expose **Use** in the `Lightbox` bar.
- New types + `messageFromRecord` mapping; `serverRunTools` unaffected (web_search already requested by default).

### 6.6 Why this design (key decisions)
- **Reuse the attachment pipeline** instead of inventing a "cloud web-image" record → the edit/vision flow works for free; minimal new surface area.
- **Server fetch returns bytes** (not a stored blob) → no new storage lifecycle, no orphan blobs, SSRF surface is one endpoint.
- **`webImages` as a first-class message field** (not piggy-backed on citations) → clean rendering + schema, matches the `images`/`citations` precedent.

---

## 7. Security analysis (SSRF) — `assertFetchableImageUrl`

Threats: SSRF to internal services / cloud metadata; decompression/large-file DoS; redirect-based bypass; non-image payloads.

Mitigations (all testable):
- Scheme allowlist (http/https only); no `file:`, `data:`, `gopher:`, etc.
- Host denylist: `localhost`, `127.0.0.0/8`, `0.0.0.0`, `10/8`, `172.16/12`, `192.168/16`, `169.254/16` (incl. `169.254.169.254`), `::1`, `fc00::/7`, `fe80::/10`, hostnames ending `.local`, and bare `metadata*`.
- `redirect: 'manual'`, re-validate each `Location` (≤ 3 hops).
- 10 s timeout (AbortController); 12 MB cap (reject on `content-length` > cap or streamed overflow).
- Require `Content-Type: image/(png|jpeg|webp|gif)`.
- Never echo response headers/body beyond the bytes; typed errors only.

> Residual risk: DNS-rebinding (host resolves public→private between check and fetch). Acceptable for a single-tenant, invite-only app; note as a known limitation. A future hardening is to resolve + pin the IP.

---

## 8. Implementation plan (TDD slices)

Each slice: red test(s) → impl → green → typecheck → (deploy at phase ends).

**Phase 0 — pure foundations (no I/O)**
- P0.1 `assertFetchableImageUrl` + tests (scheme, private hosts, redirects-as-host, creds). `api/src/domain/webImage.ts`.
- P0.2 `normalizeTavilyImages(resp)` + tests (string[] and object[] shapes, dedup, cap). `api/src/ai/tavily.ts`.

**Phase 1 — backend ingest + search images**
- P1.1 `WebImageService.fetch` + tests (mock fetch: ok image, too-large, non-image, timeout, redirect-to-private blocked). `api/src/application/webImageService.ts`.
- P1.2 controller + route + composition wiring; `respond()` envelope. `POST /api/web/image`.
- P1.3 `tavilySearch` include_images; web_search executor returns `webImages`; tests.
- P1.4 `ToolResult.webImages` → orchestrator `webImages` event → worker accumulation; tests (orchestrator + worker).
- P1.5 message schema `webImageSchema` + append/record + `messageFromRecord`/`appendBodyFromMessage`; tests.
- Deploy backend.

**Phase 2 — frontend rich content + Use**
- P2.1 `WebImage` type + mapping; `cloudApi.fetchWebImage`.
- P2.2 `stageWebImage` UI action (fetch → File → composer addFiles → toast). Unit-test the pure base64→File + dedup guard.
- P2.3 `WebImages` strip component + CSS; render in `Message.tsx`.
- P2.4 markdown `.md-img` **Use** affordance + lightbox Use button.
- Build + deploy frontend.

**Phase 3 — enhancements (optional, time-permitting)**
- Source thumbnails, quote/snippet card. Spec'd; deferred behind Phase 1–2.

---

## 9. Self-critique & revisions (iterative)

**v1 → issues found → v2 (this doc reflects v2):**

- *C1 — "store the web image server-side as a blob and reference it."* Rejected: introduces a new storage lifecycle, orphan-blob cleanup, and a second image record type. **Revision:** return **bytes**, feed the existing attachment pipeline. Smaller, reuses edit/vision.
- *C2 — "let the model auto-fetch & edit a web URL via `edit_reference`."* Tempting (zero taps) but: (a) needs the worker to resolve+download web images from history → more plumbing & SSRF inside the run; (b) less user control over *which* image. **Revision:** make **Use** an explicit one-tap user action for v1 (still zero manual upload). Auto-edit can layer on later by having `latestUserImageReference` also consider an ingested web image.
- *C3 — "piggy-back images on `citations`."* Conflates *sources* (page links) with *image results*. **Revision:** dedicated `webImages` field; cleaner schema + render.
- *C4 — "render images by letting the model emit `![](url)`."* Unreliable (model may just list URLs) and still unusable. **Revision:** structured `webImages` strip + the **Use** affordance also on markdown images (covers both paths).
- *C5 — SSRF.* First pass only checked scheme. **Revision:** full private-range/metadata denylist + manual redirect re-validation + size/time caps + content-type gate, all unit-tested. Documented DNS-rebind residual.
- *C6 — schema 400 trap.* `webImages` is synced; forgetting the backend strict schema would 400 every append (known gotcha). **Revision:** schema change is in the same slice (P1.5) as the field.
- *C7 — broken/oversized thumbnails in the strip.* **Revision:** `onError` hides the card; `loading="lazy"`; cap the count (8) and thumbnail box size.

**Open questions / assumptions**
- Tavily image objects don't reliably include the *source page* per image → `sourceUrl` often absent; we attribute by the image host domain. Acceptable.
- Count caps: 8 surfaced, 12 schema max. Tunable.

---

## 10. Acceptance criteria & manual test script

**Acceptance**
- A1. "show me pictures of a cat" → assistant message shows an inline image strip (≥1 image) with source attribution; clicking opens the lightbox.
- A2. Tapping **Use** on a web image (strip or markdown image) adds it to the composer as a pending image with **no file picker**.
- A3. With that image staged, "make it kawaii with marker doodles" produces an **edited** image (the image tool used the ingested bytes via `edit_reference`).
- A4. SSRF: `POST /api/web/image {url:"http://169.254.169.254/…"}` → blocked (validation error); a >12 MB or non-image URL → typed error; valid public image → bytes returned.
- A5. No regressions: existing web search (text + sources), uploads, generated images unchanged.

**Manual script**
1. Ensure Tavily key + image model configured. 2. Ask "search images of a cat" → see the strip. 3. Tap **Use** on one → see it in the composer. 4. Send "make it kawaii, marker doodles all around" → get an edited image. 5. Try a bogus/large/non-image URL via the strip on a broken link → graceful toast.

---

## 11. Files touched (index)

Backend: `api/src/domain/webImage.ts` (new), `api/src/application/webImageService.ts` (new), `api/src/http/webController.ts` (new), `api/src/functions/api.ts`, `api/src/composition.ts`, `api/src/ai/tavily.ts`, `api/src/ai/orchestrator.ts`, `api/src/application/runWorker.ts`, `api/src/domain/message.ts`.

Frontend: `src/lib/types.ts`, `src/data/cloud/types.ts` (mapping), `src/data/cloud/apiClient.ts`, `src/features/chat/WebImages.tsx` (new), `src/features/chat/Message.tsx`, `src/features/chat/Markdown.tsx`, `src/features/chat/Lightbox.tsx`, `src/state/store.ts` (stage action) + `src/design/*.css`.
