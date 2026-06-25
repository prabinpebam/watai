# 05 — Agentic Image Generation

Replace Watai's literal "prompt in → image out" screen with an **intent-aware image agent**:
it reads the **conversation context**, infers what the user actually wants, **expands that
into a detailed, well-engineered prompt**, generates the image (streaming partial previews),
and supports **iterative edits and inpainting** — all inside the chat.

Cross-references: today's literal flow in [../../src/features/images/ImagesView.tsx](../../src/features/images/ImagesView.tsx)
and [../../src/ai/image.ts](../../src/ai/image.ts); platform detail in
[01-foundry-capabilities.md](01-foundry-capabilities.md) §7; orchestration in
[02-architecture-and-adoption.md](02-architecture-and-adoption.md).

> **Status — this is the future-state reference, not the current build target.** The
> shipping decision ([08 §0 D1](08-implementation-plan.md)) is to keep the **plain Image
> API** via the `generate_image` **function tool** (works on any endpoint, no Foundry
> project). The **Stage-1 intent expansion** in this doc still applies; the server
> **`image_generation` tool** below (streaming partials, edit/inpaint) is **deferred**.
> Build per [08](08-implementation-plan.md); treat this doc as the design for the later
> upgrade.

---

## 1. The problem with today's image flow

Today ([ImagesView.tsx](../../src/features/images/ImagesView.tsx) + [image.ts](../../src/ai/image.ts)):

- The user types a literal prompt; it is sent **verbatim** to `/images/generations`.
- There is **no understanding** of the surrounding conversation, prior images, or the user's
  goal. "Make a hero image for that" is meaningless to the endpoint.
- No iterative editing, no inpainting, no variations tied to context, no streaming feedback.

The user's ask: an agent that **understands bigger context and creates the necessary prompts
that align to user intent**, then produces the image.

---

## 2. Design: a two-stage image agent

```mermaid
flowchart TD
    A[User intent in context<br/>e.g. "make a hero image for the launch post above"] --> B[Stage 1: Prompt-expansion orchestrator<br/>gpt-4.1-mini / gpt-4o reasoning]
    B --> C{Enough info?}
    C -->|no| D[Ask 1 brief clarifying question] --> A
    C -->|yes| E[Detailed engineered prompt<br/>+ size/quality/style params]
    E --> F[Stage 2: image_generation tool<br/>gpt-image-1, streaming]
    F --> G[Partial previews -> final image]
    G --> H[Persist image + provenance<br/>prompt, params, intent, source msgs]
    H --> I{User edits?}
    I -->|"make it night, add rain"| J[Edit / inpaint with input_image + mask]
    J --> F
```

### Stage 1 — Prompt-expansion orchestrator

A small reasoning model (`orchestrator` deployment, e.g. `gpt-4.1-mini` or `gpt-4o`) receives:

- the **recent conversation** (the relevant turns / referenced message),
- any **referenced or attached images**,
- the user's **personalization** (preferred styles, brand, language), and
- a **system prompt** that instructs it to act as an expert prompt engineer.

It outputs a **structured plan**:

```jsonc
{
  "expandedPrompt": "A cinematic wide hero banner for a developer-tools launch: a calm dark-mode
     workspace, soft teal accent glow matching the brand, abstract flowing data ribbons, ample
     negative space on the right for headline text, high detail, photographic, 35mm, dusk lighting",
  "negative": "clutter, busy background, text, logos, watermarks",
  "size": "1536x1024",
  "quality": "high",
  "style": "photographic",
  "background": "opaque",
  "rationale": "Wide format for a banner; right-side negative space for copy; brand teal."
}
```

If intent is too vague, Stage 1 asks **one** crisp clarifying question instead of guessing
(e.g. "Banner for web (wide) or social (square)?").

### Stage 2 — Image generation

The expanded prompt + parameters drive the **`image_generation` tool** through the Responses
API (preferred) or `gpt-image` directly (fallback). The tool offers, over the plain Image
API: **streaming partial images**, **flexible inputs** (image file IDs or bytes), and being
**inside a conversation the model understands** for follow-up edits.

---

## 3. Request shapes

### 3.1 Agentic generation via Responses (preferred)

```jsonc
POST <endpoint>/openai/v1/responses
Authorization: Bearer <token>
x-ms-oai-image-generation-deployment: gpt-image-1
{
  "model": "gpt-4.1-mini",
  "input": "<expanded prompt from Stage 1>",
  "tools": [ { "type": "image_generation",
               "size": "1536x1024", "quality": "high",
               "background": "opaque", "output_format": "png",
               "partial_images": 2 } ],
  "stream": true
}
```

Response carries an `image_generation_call` output item with `result` = **base64** image
bytes (plus optional partials during streaming) and an assistant `message` describing what it
made.

### 3.2 Edit / inpaint (iterative)

```jsonc
{ "model": "gpt-4.1-mini",
  "input": "Make it night with light rain; keep the layout and the right-side empty space.",
  "tools": [ { "type": "image_generation",
               "input_image_mask": { "image_url": "data:image/png;base64,<mask>" },
               "size": "1536x1024", "quality": "high", "partial_images": 2 } ],
  "stream": true }
```

The prior image is supplied as input (bytes or `file_id`); an optional **mask** restricts
edits to a region (inpainting). The model keeps conversational context, so "keep the layout"
is meaningful.

### 3.3 Fallback (plain Image API)

If the endpoint lacks the image-gen tool, Watai still runs **Stage 1** (prompt expansion is
pure chat and works anywhere) and then calls the existing `generateImage` in
[../../src/ai/image.ts](../../src/ai/image.ts). The user still gets **intent-aware prompts**,
just without streaming/inpainting. This keeps the feature working for Profile-1 users.

---

## 4. Parameters Watai exposes

From the tool's optional parameters ([01](01-foundry-capabilities.md) §7), surfaced sensibly:

| Param | Watai UI | Default |
| --- | --- | --- |
| `size` | Aspect chips: Square / Portrait / Landscape (+ Auto) | `1024x1024` |
| `quality` | Low / Medium / High / Auto | `high` (agentic), `medium` (quick) |
| `background` | Opaque / Transparent | `opaque` |
| `output_format` | PNG / WebP / JPEG | `png` |
| `partial_images` | Streaming previews on/off (0–3) | `2` |
| `input_image_mask` | "Edit region" brush in the viewer | none |
| `moderation` | (internal) | `auto` |

Stage 1 proposes values from context; the user can override in an "advanced" disclosure.

---

## 5. Persistence & provenance

The existing `ImageRef` ([../../src/lib/types.ts](../../src/lib/types.ts)) is extended with
**provenance** so images are reproducible and explainable
([06-data-model-and-frontend.md](06-data-model-and-frontend.md)):

```jsonc
// extended ImageRef
{ "id": "ulid", "localBlobKey": "img-…", "blobPath": "…",
  "prompt": "<user's literal ask>",
  "expandedPrompt": "<Stage-1 engineered prompt>",
  "intent": "hero banner for launch post",
  "params": { "size": "1536x1024", "quality": "high", "background": "opaque" },
  "sourceMessageIds": ["…"],     // context the agent used
  "editOf": "imageRefId|null",   // lineage for edits/inpaint
  "model": "gpt-image-1",
  "createdAt": "iso" }
```

As today, base64 is written to a blob (`repo.putBlob`) and dropped from memory; provenance is
stored with the `ImageRef` and synced. Temporary threads never persist images (existing rule).

---

## 6. UI

Images become **conversational** rather than a separate literal form:

- **In chat:** "create/make/draw an image…" (or the Tools → Image action) triggers the agent.
  The assistant shows: the **expanded prompt** (collapsible "Prompt the agent used"), a
  **streaming preview** that sharpens from partials to final, and the image with a caption.
- **Clarify:** if Stage 1 asks a question, it appears as a quick inline chip set.
- **Viewer / edit:** opening an image offers **Edit** (natural-language), **Edit region**
  (mask brush for inpaint), **Variations**, **Regenerate**, and **Use as input**. Each edit is
  a new `ImageRef` with `editOf` lineage.
- **Standalone `/images`:** retained but upgraded — the prompt box now runs the **same Stage-1
  expansion** (with a "use my literal prompt" escape hatch) and shows the engineered prompt for
  transparency. The gallery shows intent + provenance.
- Watai tokens, Fluent icons, no emoji (HANDOFF §11).

---

## 7. Prompting (Stage 1 system prompt, essence)

> "You are an expert image prompt engineer. Read the conversation and the user's request, and
> produce a single, vivid, technically detailed image prompt that captures their **intent** —
> subject, composition, style, lighting, mood, framing, and any space needed for text. Infer
> brand/style from personalization. Choose sensible size/quality/background. If a critical
> detail is genuinely ambiguous, ask **one** short question; otherwise proceed. Output the
> structured plan. Never include real logos, watermarks, or copyrighted characters unless the
> user explicitly owns them."

This directly implements the user's request: **understand bigger context → craft prompts that
align to intent → create the image.**

---

## 8. Safety

- **Content filtering** can block prompts; surface the existing `content_filtered` message and
  let the user revise (today's behavior, kept).
- **No copyrighted/branded** assets unless user-owned (in the system prompt and UI copy).
- **Respect any revised-prompt** the service returns (transparency).
- Generated images are **untrusted** for downstream automated use; they are display artifacts.

---

## 9. Acceptance criteria

1. A context-dependent request ("hero image for that post") yields a **detailed,
   intent-aligned** image without the user writing a full prompt.
2. The **expanded prompt is visible** for transparency and reuse.
3. **Streaming partials** appear before the final image when the tool is available.
4. **Edit and inpaint** produce new images with **lineage** (`editOf`) and keep context.
5. On a Profile-1 endpoint (no tool), Stage-1 expansion still runs and the **plain Image API
   fallback** produces the image.
6. Provenance (intent, expanded prompt, params, sources) is **persisted** and shown in the
   viewer.
