import { z } from 'zod';
import { createHash } from 'node:crypto';
import { AppError } from './errors';
import { parseOrThrow } from './validate';

export const LIBRARY_KINDS = [
  'image',
  'pdf',
  'document',
  'spreadsheet',
  'presentation',
  'data',
  'audio',
  'archive',
  'code',
  'text',
  'other',
] as const;
export type LibraryKind = (typeof LIBRARY_KINDS)[number];

export const LIBRARY_ORIGINS = [
  'chat_upload',
  'library_upload',
  'chat_generated_image',
  'studio_generated_image',
  'code_artifact',
  'thread_document',
] as const;
export type LibraryOrigin = (typeof LIBRARY_ORIGINS)[number];

export const LIBRARY_STATES = [
  'pending',
  'active',
  'trashed',
  'purging',
  'purged',
  'missing',
  'failed',
] as const;
export type LibraryState = (typeof LIBRARY_STATES)[number];

export const LIBRARY_SORTS = ['newest', 'oldest', 'largest', 'name'] as const;
export type LibrarySort = (typeof LIBRARY_SORTS)[number];

export const LIBRARY_SOURCE_SURFACES = ['chat', 'image_studio', 'library'] as const;
export type LibrarySourceSurface = (typeof LIBRARY_SOURCE_SURFACES)[number];

export const LIBRARY_UPLOAD_MAX_FILES = 20;
export const LIBRARY_UPLOAD_MAX_BATCH_BYTES = 100 * 1024 * 1024;
export const LIBRARY_UPLOAD_MAX_IMAGE_BYTES = 20 * 1024 * 1024;
export const LIBRARY_UPLOAD_MAX_OTHER_BYTES = 25 * 1024 * 1024;
export const LIBRARY_TRASH_RETENTION_DAYS = 7;

export type LibrarySourceKind = 'chat_attachment' | 'chat_generated_image' | 'code_artifact' | 'thread_document' | 'studio_generated_image';

export function libraryIngestionKey(kind: LibrarySourceKind, sourceId: string): string {
  return `${kind}:${sourceId}`;
}

export function libraryItemId(userId: string, ingestionKey: string): string {
  return `lib-${createHash('sha256').update(`${userId}\u0000${ingestionKey}`).digest('hex').slice(0, 32)}`;
}

export function libraryItemIdFor(userId: string, kind: LibrarySourceKind, sourceId: string): string {
  return libraryItemId(userId, libraryIngestionKey(kind, sourceId));
}

const boundedId = z.string().trim().min(1).max(64);
const iso = z.string().datetime({ offset: true });

const derivativeSchema = z
  .object({
    kind: z.literal('thumbnail'),
    blobPath: z.string().min(1).max(512),
    mime: z.enum(['image/jpeg', 'image/webp']),
    bytes: z.number().int().nonnegative(),
    width: z.number().int().positive().max(4096),
    height: z.number().int().positive().max(4096),
  })
  .strict();

const sourceSchema = z
  .object({
    surface: z.enum(LIBRARY_SOURCE_SURFACES),
    threadId: boundedId.optional(),
    messageId: boundedId.optional(),
    runId: boundedId.optional(),
    toolCallId: boundedId.optional(),
    threadTitleSnapshot: z.string().max(400).optional(),
    createdAt: iso,
  })
  .strict()
  .superRefine((source, ctx) => {
    if (source.surface === 'chat' && !source.threadId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threadId'], message: 'Chat sources require a threadId.' });
    }
    if (source.surface !== 'chat' && (source.threadId || source.messageId || source.runId || source.toolCallId)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Only chat sources may carry chat execution ids.' });
    }
  });

const imageMetadataSchema = z
  .object({
    width: z.number().int().positive().max(16_384).optional(),
    height: z.number().int().positive().max(16_384).optional(),
    size: z.string().max(32).optional(),
    format: z.enum(['png', 'jpeg', 'webp']).optional(),
    prompt: z.string().max(8_000).optional(),
    revisedPrompt: z.string().max(8_000).optional(),
    promptSnapshot: z.string().max(8_000).optional(),
    model: z.string().max(128).optional(),
    quality: z.enum(['low', 'medium', 'high']).optional(),
    referenceItemIds: z.array(boundedId).max(32).optional(),
    provenanceComplete: z.boolean(),
  })
  .strict()
  .superRefine((image, ctx) => {
    if (image.referenceItemIds && new Set(image.referenceItemIds).size !== image.referenceItemIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['referenceItemIds'], message: 'Reference ids must be unique.' });
    }
  });

const artifactMetadataSchema = z
  .object({
    sourceItemIds: z.array(boundedId).max(32).optional(),
    version: z.number().int().positive().max(10_000).optional(),
    provenanceComplete: z.boolean(),
  })
  .strict()
  .superRefine((artifact, ctx) => {
    if (artifact.sourceItemIds && new Set(artifact.sourceItemIds).size !== artifact.sourceItemIds.length) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['sourceItemIds'], message: 'Source ids must be unique.' });
    }
  });

const libraryErrorSchema = z
  .object({
    code: z.string().trim().min(1).max(100),
    message: z.string().trim().min(1).max(400),
  })
  .strict();

export const libraryItemSchema = z
  .object({
    id: boundedId,
    userId: boundedId,
    ingestionKey: z.string().trim().min(1).max(256),
    state: z.enum(LIBRARY_STATES),
    kind: z.enum(LIBRARY_KINDS),
    origin: z.enum(LIBRARY_ORIGINS),
    name: z.string().trim().min(1).max(400),
    mime: z.string().trim().min(1).max(255),
    bytes: z.number().int().nonnegative(),
    blobPath: z.string().min(1).max(512).optional(),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/).optional(),
    derivatives: z.array(derivativeSchema).max(8).optional(),
    createdAt: iso,
    updatedAt: iso,
    trashedAt: iso.optional(),
    purgeAfter: iso.optional(),
    purgedAt: iso.optional(),
    error: libraryErrorSchema.nullable().optional(),
    source: sourceSchema,
    image: imageMetadataSchema.optional(),
    artifact: artifactMetadataSchema.optional(),
    userMetadata: z
      .object({
        title: z.string().trim().min(1).max(160).optional(),
        starred: z.boolean().optional(),
      })
      .strict()
      .optional(),
  })
  .strict()
  .superRefine((item, ctx) => {
    const requiresBlob = item.state === 'active' || item.state === 'trashed' || item.state === 'purging';
    if (requiresBlob && !item.blobPath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blobPath'], message: `${item.state} items require blobPath.` });
    }
    if ((item.state === 'purged' || item.state === 'failed') && item.blobPath) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['blobPath'], message: `${item.state} items cannot expose blobPath.` });
    }
    if (item.state === 'trashed' && (!item.trashedAt || !item.purgeAfter)) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Trashed items require trashedAt and purgeAfter.' });
    }
    if (item.state === 'purged' && !item.purgedAt) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['purgedAt'], message: 'Purged items require purgedAt.' });
    }
    if (item.kind === 'image' && !item.image) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['image'], message: 'Image items require image metadata.' });
    }
    if (item.origin === 'studio_generated_image' && item.source.surface !== 'image_studio') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'surface'], message: 'Studio images require image_studio source.' });
    }
    if (item.origin === 'library_upload' && item.source.surface !== 'library') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'surface'], message: 'Library uploads require library source.' });
    }
    if (['chat_upload', 'chat_generated_image', 'code_artifact', 'thread_document'].includes(item.origin) && item.source.surface !== 'chat') {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['source', 'surface'], message: 'Thread-owned origins require chat source.' });
    }
  });

export type LibraryItemRecord = z.infer<typeof libraryItemSchema>;

export function parseLibraryItem(input: unknown): LibraryItemRecord {
  return parseOrThrow(libraryItemSchema, input, 'Invalid Library item.');
}

const ALLOWED_TRANSITIONS: Record<LibraryState, readonly LibraryState[]> = {
  pending: ['active', 'failed', 'missing'],
  active: ['trashed', 'missing'],
  trashed: ['active', 'purging', 'missing'],
  purging: ['purged', 'trashed'],
  purged: [],
  missing: ['active'],
  failed: ['pending'],
};

export function canTransitionLibrary(from: LibraryState, to: LibraryState): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export function assertLibraryTransition(from: LibraryState, to: LibraryState): void {
  if (!canTransitionLibrary(from, to)) throw new AppError('conflict', `Library item cannot transition from ${from} to ${to}.`);
}

function csvEnums<T extends readonly string[]>(value: unknown, values: T): T[number][] | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const raw = Array.isArray(value) ? value.flatMap((part) => String(part).split(',')) : String(value).split(',');
  const unique = [...new Set(raw.map((part) => part.trim()).filter(Boolean))];
  const allowed = new Set<string>(values);
  if (!unique.length || unique.some((part) => !allowed.has(part))) throw new AppError('validation', 'Invalid Library filter.');
  return unique as T[number][];
}

function optionalNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) throw new AppError('validation', 'Invalid numeric Library filter.');
  return parsed;
}

function optionalBoolean(value: unknown): boolean | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  if (value === true || value === 'true') return true;
  if (value === false || value === 'false') return false;
  throw new AppError('validation', 'Invalid boolean Library filter.');
}

export interface LibraryListQuery {
  q?: string;
  kinds?: LibraryKind[];
  origins?: LibraryOrigin[];
  originGroup?: 'uploaded' | 'generated';
  state: 'active' | 'trashed';
  threadId?: string;
  starred?: boolean;
  minBytes?: number;
  maxBytes?: number;
  createdAfter?: string;
  createdBefore?: string;
  sort: LibrarySort;
  cursor?: string;
  limit: number;
}

export function parseLibraryListQuery(input: Record<string, unknown>): LibraryListQuery {
  const q = input.q === undefined ? undefined : String(input.q).trim();
  if (q && q.length > 200) throw new AppError('validation', 'Library search is too long.');
  const state = input.state === undefined || input.state === '' ? 'active' : String(input.state);
  if (state !== 'active' && state !== 'trashed') throw new AppError('validation', 'Invalid Library state filter.');
  const sort = input.sort === undefined || input.sort === '' ? 'newest' : String(input.sort);
  if (!(LIBRARY_SORTS as readonly string[]).includes(sort)) throw new AppError('validation', 'Invalid Library sort.');
  const originRaw = input.origin === undefined ? undefined : String(input.origin);
  const originGroup = originRaw === 'uploaded' || originRaw === 'generated' ? originRaw : undefined;
  const origins = originGroup ? undefined : csvEnums(input.origin, LIBRARY_ORIGINS);
  const minBytes = optionalNumber(input.minBytes);
  const maxBytes = optionalNumber(input.maxBytes);
  if (minBytes !== undefined && (!Number.isInteger(minBytes) || minBytes < 0)) throw new AppError('validation', 'Invalid minimum size.');
  if (maxBytes !== undefined && (!Number.isInteger(maxBytes) || maxBytes < 0)) throw new AppError('validation', 'Invalid maximum size.');
  if (minBytes !== undefined && maxBytes !== undefined && minBytes > maxBytes) throw new AppError('validation', 'Minimum size cannot exceed maximum size.');
  const limitRaw = optionalNumber(input.limit) ?? 50;
  if (!Number.isInteger(limitRaw) || limitRaw < 1 || limitRaw > 100) throw new AppError('validation', 'Library limit must be between 1 and 100.');
  const threadId = input.threadId === undefined || input.threadId === '' ? undefined : String(input.threadId);
  if (threadId && (threadId.length < 1 || threadId.length > 64)) throw new AppError('validation', 'Invalid source thread.');
  const createdAfter = input.createdAfter === undefined || input.createdAfter === '' ? undefined : String(input.createdAfter);
  const createdBefore = input.createdBefore === undefined || input.createdBefore === '' ? undefined : String(input.createdBefore);
  if (createdAfter && !iso.safeParse(createdAfter).success) throw new AppError('validation', 'Invalid createdAfter date.');
  if (createdBefore && !iso.safeParse(createdBefore).success) throw new AppError('validation', 'Invalid createdBefore date.');
  const cursor = input.cursor === undefined || input.cursor === '' ? undefined : String(input.cursor);
  if (cursor && cursor.length > 2_048) throw new AppError('validation', 'Invalid Library cursor.');
  return {
    ...(q ? { q } : {}),
    ...(csvEnums(input.kind, LIBRARY_KINDS) ? { kinds: csvEnums(input.kind, LIBRARY_KINDS) } : {}),
    ...(origins ? { origins } : {}),
    ...(originGroup ? { originGroup } : {}),
    state,
    ...(threadId ? { threadId } : {}),
    ...(optionalBoolean(input.starred) !== undefined ? { starred: optionalBoolean(input.starred) } : {}),
    ...(minBytes !== undefined ? { minBytes } : {}),
    ...(maxBytes !== undefined ? { maxBytes } : {}),
    ...(createdAfter ? { createdAfter } : {}),
    ...(createdBefore ? { createdBefore } : {}),
    sort: sort as LibrarySort,
    ...(cursor ? { cursor } : {}),
    limit: limitRaw,
  };
}

export interface LibraryLineageQuery {
  direction: 'references' | 'derived';
  cursor?: string;
  limit: number;
}

export function parseLibraryLineageQuery(input: Record<string, unknown>): LibraryLineageQuery {
  const direction = String(input.direction ?? '');
  if (direction !== 'references' && direction !== 'derived') {
    throw new AppError('validation', 'Library lineage direction must be references or derived.');
  }
  const cursor = input.cursor === undefined || input.cursor === '' ? undefined : String(input.cursor);
  if (cursor && cursor.length > 2_048) throw new AppError('validation', 'Invalid Library lineage cursor.');
  const limit = optionalNumber(input.limit) ?? 50;
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new AppError('validation', 'Library lineage limit must be between 1 and 100.');
  return { direction, ...(cursor ? { cursor } : {}), limit };
}

const libraryPatchSchema = z
  .object({
    title: z.string().trim().min(1).max(160).nullable().optional(),
    starred: z.boolean().optional(),
  })
  .strict()
  .refine((value) => value.title !== undefined || value.starred !== undefined, 'At least one change is required.');

export type LibraryPatchInput = z.infer<typeof libraryPatchSchema>;
export function parseLibraryPatch(input: unknown): LibraryPatchInput {
  return parseOrThrow(libraryPatchSchema, input, 'Invalid Library update.');
}

const itemIdsSchema = z.array(boundedId).min(1).max(500).refine((ids) => new Set(ids).size === ids.length, 'Item ids must be unique.');

const libraryImpactSchema = z.object({ itemIds: itemIdsSchema, action: z.enum(['trash', 'purge']) }).strict();
export type LibraryImpactInput = z.infer<typeof libraryImpactSchema>;
export function parseLibraryImpact(input: unknown): LibraryImpactInput {
  return parseOrThrow(libraryImpactSchema, input, 'Invalid Library impact request.');
}

const libraryBatchSchema = z.object({ itemIds: itemIdsSchema, action: z.enum(['trash', 'restore', 'purge']) }).strict();
export type LibraryBatchInput = z.infer<typeof libraryBatchSchema>;
export function parseLibraryBatch(input: unknown): LibraryBatchInput {
  return parseOrThrow(libraryBatchSchema, input, 'Invalid Library batch request.');
}

const libraryUploadSchema = z
  .object({
    name: z.string().trim().min(1).max(400),
    mime: z.string().trim().min(1).max(255),
    bytes: z.number().int().positive().max(LIBRARY_UPLOAD_MAX_OTHER_BYTES),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type LibraryUploadInput = z.infer<typeof libraryUploadSchema>;

const LIBRARY_UPLOAD_TYPES: Record<string, { kind: LibraryKind; extension: string }> = {
  'image/png': { kind: 'image', extension: 'png' },
  'image/jpeg': { kind: 'image', extension: 'jpg' },
  'image/webp': { kind: 'image', extension: 'webp' },
  'image/gif': { kind: 'image', extension: 'gif' },
  'application/pdf': { kind: 'pdf', extension: 'pdf' },
  'text/plain': { kind: 'text', extension: 'txt' },
  'text/markdown': { kind: 'text', extension: 'md' },
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': { kind: 'document', extension: 'docx' },
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': { kind: 'presentation', extension: 'pptx' },
  'text/csv': { kind: 'data', extension: 'csv' },
  'application/json': { kind: 'data', extension: 'json' },
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': { kind: 'spreadsheet', extension: 'xlsx' },
  'audio/webm': { kind: 'audio', extension: 'webm' },
  'audio/mpeg': { kind: 'audio', extension: 'mp3' },
  'application/zip': { kind: 'archive', extension: 'zip' },
};

export function libraryUploadType(mime: string): { kind: LibraryKind; extension: string } {
  const type = LIBRARY_UPLOAD_TYPES[mime.toLowerCase()];
  if (!type) throw new AppError('validation', 'This file type is not supported by Library upload.');
  return type;
}

export function parseLibraryUpload(input: unknown): LibraryUploadInput {
  const parsed = parseOrThrow(libraryUploadSchema, input, 'Invalid Library upload.');
  libraryUploadType(parsed.mime);
  if (parsed.mime.startsWith('image/') && parsed.bytes > LIBRARY_UPLOAD_MAX_IMAGE_BYTES) {
    throw new AppError('validation', 'Library images must be 20 MiB or smaller.');
  }
  return parsed;
}

const libraryUploadCompleteSchema = z
  .object({
    bytes: z.number().int().positive().max(LIBRARY_UPLOAD_MAX_OTHER_BYTES),
    contentHash: z.string().regex(/^sha256:[a-f0-9]{64}$/),
  })
  .strict();
export type LibraryUploadCompleteInput = z.infer<typeof libraryUploadCompleteSchema>;
export function parseLibraryUploadComplete(input: unknown): LibraryUploadCompleteInput {
  return parseOrThrow(libraryUploadCompleteSchema, input, 'Invalid Library upload completion.');
}

export function libraryStorageBytes(item: Pick<LibraryItemRecord, 'bytes' | 'derivatives'>): number {
  return item.bytes + (item.derivatives ?? []).reduce((sum, derivative) => sum + derivative.bytes, 0);
}
