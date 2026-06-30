import { z } from 'zod';
import { MEMORY_KINDS } from './memory';
import { parseOrThrow } from './validate';

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'streaming' | 'complete' | 'interrupted' | 'error';

/** A generated/attached image's cloud metadata (the bytes live in Blob Storage at `blobPath`). */
const imageSchema = z
  .object({
    id: z.string().min(1).max(64),
    blobPath: z.string().min(1).max(512),
    prompt: z.string().max(8000).default(''),
    size: z.string().min(1).max(32),
    outputFormat: z.enum(['png', 'jpeg', 'webp']),
    createdAt: z.string().min(1).max(40),
  })
  .strict();

export type MessageImage = z.infer<typeof imageSchema>;

/** Artifact kinds drive the client icon + preview routing (derived from mime). */
export const ARTIFACT_KINDS = [
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'image',
  'data',
  'archive',
  'code',
  'text',
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/** A file the agent generated during a run (code interpreter output), persisted to Blob Storage
 *  and surfaced as a downloadable card. The bytes live at `blobPath`. */
const artifactSchema = z
  .object({
    id: z.string().min(1).max(64),
    name: z.string().min(1).max(400),
    mime: z.string().min(1).max(255),
    kind: z.enum(ARTIFACT_KINDS),
    bytes: z.number().int().nonnegative(),
    blobPath: z.string().min(1).max(512),
    /** The code-interpreter tool call this artifact came from (lineage). */
    sourceToolCallId: z.string().max(64).optional(),
    createdAt: z.string().min(1).max(40),
  })
  .strict();

export type MessageArtifact = z.infer<typeof artifactSchema>;

/** Map a mime type to an artifact kind for the client icon + preview. */
export function artifactKindForMime(mime: string): ArtifactKind {
  const m = mime.toLowerCase();
  if (m === 'application/pdf') return 'pdf';
  if (m.includes('wordprocessingml') || m === 'application/msword') return 'document';
  if (m.includes('spreadsheetml')) return 'spreadsheet';
  if (m.includes('presentationml')) return 'presentation';
  if (m.startsWith('image/')) return 'image';
  if (m === 'application/zip' || m === 'application/x-tar') return 'archive';
  if (m === 'application/json' || m === 'text/csv' || m === 'application/csv') return 'data';
  if (m.startsWith('text/')) return 'text';
  return 'data';
}

/** Bounded, secret-free record of one tool invocation (agentic transcript). */
const toolCallSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['function', 'web_search', 'code_interpreter', 'file_search', 'image']),
    name: z.string().max(100).optional(),
    status: z.enum(['running', 'awaiting-confirm', 'done', 'error']),
    summary: z.string().max(400).optional(),
    resultPreview: z.string().max(4000).optional(),
    /** Requested image size (`WxH`) for an image tool call, so the client can render an
     *  aspect-correct placeholder while the image generates. */
    imageSize: z.string().max(32).optional(),
    /** Ids of artifacts this tool call produced (code interpreter outputs). */
    artifactIds: z.array(z.string().min(1).max(64)).max(16).optional(),
  })
  .strict();

export type MessageToolCall = z.infer<typeof toolCallSchema>;

/** A grounding citation (web url_citation or file_citation). Synced in full so the source
 *  detail pane (raw search-result content, favicon, link) is identical across devices. */
const citationSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    title: z.string().max(400).optional(),
    source: z.enum(['web', 'file']).optional(),
    filename: z.string().max(256).optional(),
    /** Raw result content shown in the source detail pane. */
    content: z.string().max(4000).optional(),
    /** Favicon URL for the source chip. */
    favicon: z.string().max(8192).optional(),
    /** A "searched the web" deep link. */
    bingQueryUrl: z.string().max(2048).optional(),
    /** File-citation file id. */
    fileId: z.string().max(128).optional(),
    startIndex: z.number().int().nonnegative().optional(),
    endIndex: z.number().int().nonnegative().optional(),
  })
  .strict();

export type MessageCitation = z.infer<typeof citationSchema>;

/** An image surfaced by web search: shown inline and offered as a one-tap chat attachment. The bytes
 *  are NOT stored here — `url` is the external source, fetched on demand when the user taps "Use". */
const webImageSchema = z
  .object({
    id: z.string().min(1).max(64),
    url: z.string().url().max(2048),
    description: z.string().max(1000).optional(),
    sourceUrl: z.string().url().max(2048).optional(),
  })
  .strict();

export type MessageWebImage = z.infer<typeof webImageSchema>;

/** Memories selected into an assistant response context, stored for transparent UI. */
const memoryRefSchema = z
  .object({
    memoryId: z.string().min(1).max(64),
    kind: z.enum(MEMORY_KINDS),
    text: z.string().min(1).max(2000),
    sourceThreadId: z.string().min(1).max(64).optional(),
    sourceMessageId: z.string().min(1).max(64).optional(),
    score: z.number().min(0).max(1),
  })
  .strict();

export type MessageMemoryRef = z.infer<typeof memoryRefSchema>;

/** A user-uploaded attachment synced with a message (bytes live in Blob Storage at `blobPath`). */
export const attachmentSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['image', 'audio', 'file']),
    blobPath: z.string().min(1).max(512),
    mime: z.string().min(1).max(255),
    bytes: z.number().int().nonnegative(),
    name: z.string().max(400).optional(),
    width: z.number().int().positive().optional(),
    height: z.number().int().positive().optional(),
  })
  .strict();

export type MessageAttachment = z.infer<typeof attachmentSchema>;

const appendSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(200_000),
    model: z.string().min(1).max(100).optional(),
    parentId: z.string().min(1).max(64).optional(),
    /** Logical creation time (chronology key), stamped by the originating device and preserved
     *  here. Distinct from the server append-time `createdAt`, which is the delta-sync cursor. */
    orderAt: z.string().min(1).max(40).optional(),
    images: z.array(imageSchema).max(16).optional(),
    attachments: z.array(attachmentSchema).max(16).optional(),
    toolCalls: z.array(toolCallSchema).max(32).optional(),
    citations: z.array(citationSchema).max(64).optional(),
    webImages: z.array(webImageSchema).max(12).optional(),
    memoryRefs: z.array(memoryRefSchema).max(16).optional(),
    artifacts: z.array(artifactSchema).max(16).optional(),
  })
  .strict()
  // Allow image/attachment-only messages (no text), but reject fully-empty ones.
  .refine(
    (m) => m.content.trim().length > 0 || (m.images?.length ?? 0) > 0 || (m.attachments?.length ?? 0) > 0,
    { message: 'A message must have text, an image, or an attachment.' },
  );

export type AppendMessageInput = z.infer<typeof appendSchema>;

export function parseAppendMessage(input: unknown): AppendMessageInput {
  return parseOrThrow(appendSchema, input, 'Invalid message.');
}
