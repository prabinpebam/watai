import { z } from 'zod';
import { parseOrThrow } from './validate';

export const MEMORY_KINDS = [
  'fact',
  'preference',
  'instruction',
  'work_style',
  'project_context',
  'thread_summary',
  'avoidance',
  'entity',
  'procedure',
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export const MEMORY_STATUSES = ['active', 'suppressed', 'invalidated', 'deleted'] as const;
export type MemoryStatus = (typeof MEMORY_STATUSES)[number];

export const MEMORY_VISIBILITY = ['normal', 'top_of_mind', 'background'] as const;
export type MemoryVisibility = (typeof MEMORY_VISIBILITY)[number];

export const MEMORY_SOURCE_TYPES = ['message', 'thread', 'manual', 'import', 'settings', 'system'] as const;
export type MemorySourceType = (typeof MEMORY_SOURCE_TYPES)[number];

const id = z.string().trim().min(1).max(64);
const iso = z.string().trim().min(1).max(40);
const secretLikePatterns = [
  /sk-[A-Za-z0-9_-]{8,}/i,
  /eyJ[A-Za-z0-9_-]{10,}/,
  /Bearer\s+[A-Za-z0-9._~+/=-]{8,}/i,
  /DefaultEndpointsProtocol=/i,
  /AccountKey=/i,
  /-----BEGIN [A-Z ]*PRIVATE KEY-----/,
  /\b(password|passphrase|secret|token)\s*(is|=|:)\s*\S+/i,
];

export function containsSecretLikeValue(value: string): boolean {
  return secretLikePatterns.some((pattern) => pattern.test(value));
}

const secretSafe = (schema: z.ZodString) =>
  schema.refine((value) => !containsSecretLikeValue(value), { message: 'Memory text cannot contain secret-like values.' });

const text = secretSafe(z.string().trim().min(1).max(2000));
const optionalText = secretSafe(z.string().trim().min(1).max(2000)).optional();
const summaryText = secretSafe(z.string().trim().max(800));
const sourceQuote = secretSafe(z.string().trim().max(500));
const boundedLabel = secretSafe(z.string().trim().min(1).max(80));
const score = z.number().min(0).max(1);

const memorySourceRefSchema = z
  .object({
    type: z.enum(MEMORY_SOURCE_TYPES),
    threadId: id.optional(),
    messageId: id.optional(),
    runId: id.optional(),
    quote: sourceQuote.optional(),
    createdAt: iso,
  })
  .strict()
  .superRefine((ref, ctx) => {
    if (ref.type === 'message') {
      if (!ref.threadId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threadId'], message: 'threadId is required for message sources.' });
      if (!ref.messageId) ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['messageId'], message: 'messageId is required for message sources.' });
    }
    if (ref.type === 'thread' && !ref.threadId) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['threadId'], message: 'threadId is required for thread sources.' });
    }
  });

export type MemorySourceRef = z.infer<typeof memorySourceRefSchema>;

export function parseMemorySourceRef(input: unknown): MemorySourceRef {
  return parseOrThrow(memorySourceRefSchema, input, 'Invalid memory source reference.');
}

const listMemoryQuerySchema = z
  .object({
    status: z.enum(MEMORY_STATUSES).optional(),
    kind: z.enum(MEMORY_KINDS).optional(),
    q: z.string().trim().min(1).max(200).optional(),
    cursor: z.string().trim().min(1).max(512).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type ListMemoryQuery = z.infer<typeof listMemoryQuerySchema>;

const memoryRecordSchema = z
  .object({
    id,
    userId: id,
    kind: z.enum(MEMORY_KINDS),
    status: z.enum(MEMORY_STATUSES),
    text,
    normalizedText: optionalText,
    summary: summaryText.optional(),
    entities: z.array(boundedLabel).max(32).optional(),
    topics: z.array(boundedLabel).max(32).optional(),
    sourceRefs: z.array(memorySourceRefSchema).min(1).max(12),
    confidence: score,
    salience: score,
    pinned: z.boolean(),
    sensitive: z.boolean(),
    sourceHash: z.string().trim().min(1).max(128).optional(),
    visibility: z.enum(MEMORY_VISIBILITY),
    validAt: iso.optional(),
    invalidAt: iso.optional(),
    createdAt: iso,
    updatedAt: iso,
    lastUsedAt: iso.optional(),
    useCount: z.number().int().nonnegative(),
    supersedes: z.array(id).max(16).optional(),
    supersededBy: id.optional(),
    embedding: z.array(z.number()).max(4096).optional(),
    embeddingModel: z.string().trim().min(1).max(100).optional(),
    deletedAt: iso.optional(),
  })
  .strict();

export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

const manualMemoryKinds = MEMORY_KINDS.filter((kind) => kind !== 'thread_summary' && kind !== 'entity') as [
  Exclude<MemoryKind, 'thread_summary' | 'entity'>,
  ...Array<Exclude<MemoryKind, 'thread_summary' | 'entity'>>,
];

const createMemorySchema = z
  .object({
    text,
    kind: z.enum(manualMemoryKinds).optional(),
    visibility: z.enum(MEMORY_VISIBILITY).optional(),
    pinned: z.boolean().optional(),
    sourceRef: memorySourceRefSchema.optional(),
  })
  .strict();

export type CreateMemoryInput = z.infer<typeof createMemorySchema>;

const patchMemorySchema = z
  .object({
    text: text.optional(),
    kind: z.enum(MEMORY_KINDS).optional(),
    status: z.enum(['active', 'suppressed', 'invalidated']).optional(),
    visibility: z.enum(MEMORY_VISIBILITY).optional(),
    pinned: z.boolean().optional(),
    salience: score.optional(),
  })
  .strict();

export type PatchMemoryInput = z.infer<typeof patchMemorySchema>;

const putMemorySummarySchema = z
  .object({
    text: summaryText,
  })
  .strict();

export type PutMemorySummaryInput = z.infer<typeof putMemorySummarySchema>;

const memoryQueryPreviewSchema = z
  .object({
    threadId: id.optional(),
    text,
    includeSuppressed: z.boolean().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  })
  .strict();

export type MemoryQueryPreviewInput = z.infer<typeof memoryQueryPreviewSchema>;

const memoryImportItemSchema = z
  .object({
    text,
    kind: z.enum(MEMORY_KINDS),
    sourceRefs: z.array(memorySourceRefSchema).min(1).max(12),
    visibility: z.enum(MEMORY_VISIBILITY),
    pinned: z.boolean(),
  })
  .strict();

const memoryImportSchema = z
  .object({
    version: z.literal(1),
    memories: z.array(memoryImportItemSchema).max(500),
    mode: z.enum(['preview', 'commit']),
  })
  .strict();

export type MemoryImportInput = z.infer<typeof memoryImportSchema>;

const memoryRebuildSchema = z
  .object({
    mode: z.enum(['preview', 'commit']),
    includeArchived: z.boolean().optional(),
    since: iso.optional(),
  })
  .strict();

export type MemoryRebuildInput = z.infer<typeof memoryRebuildSchema>;

const memorySummaryRecordSchema = z
  .object({
    id: z.literal('memory-summary'),
    userId: id,
    kind: z.literal('summary'),
    text: summaryText,
    sourceMemoryIds: z.array(id).max(500),
    updatedAt: iso,
    version: z.number().int().positive(),
  })
  .strict();

export type MemorySummaryRecord = z.infer<typeof memorySummaryRecordSchema>;

const memoryContextBlockSchema = z
  .object({
    summary: summaryText.optional(),
    customInstructions: z
      .object({
        aboutYou: z.string().trim().max(2000).optional(),
        howRespond: z.string().trim().max(2000).optional(),
      })
      .strict()
      .optional(),
    instructions: z.array(z.string().trim().min(1).max(2000)).max(16),
    memories: z
      .array(
        z
          .object({
            id,
            kind: z.enum(MEMORY_KINDS),
            text,
            validAt: iso.optional(),
            invalidAt: iso.optional(),
            score,
          })
          .strict(),
      )
      .max(16),
    threadSummaries: z
      .array(
        z
          .object({
            threadId: id,
            title: z.string().trim().min(1).max(200).optional(),
            summary: summaryText,
            score,
          })
          .strict(),
      )
      .max(8),
    sourceRefs: z
      .array(
        z
          .object({
            memoryId: id,
            threadId: id.optional(),
            messageId: id.optional(),
          })
          .strict(),
      )
      .max(32),
    tokenEstimate: z.number().int().nonnegative(),
    latencyBudgetMs: z.number().int().positive(),
    retrievalMode: z.enum(['lexical', 'hybrid', 'cached', 'empty']),
  })
  .strict();

export type MemoryContextBlock = z.infer<typeof memoryContextBlockSchema>;

export function parseMemoryRecord(input: unknown): MemoryRecord {
  return parseOrThrow(memoryRecordSchema, input, 'Invalid memory record.');
}

export function parseMemoryListQuery(input: unknown): ListMemoryQuery {
  return parseOrThrow(listMemoryQuerySchema, input, 'Invalid memory list query.');
}

export function parseCreateMemory(input: unknown): CreateMemoryInput {
  return parseOrThrow(createMemorySchema, input, 'Invalid memory create request.');
}

export function parsePatchMemory(input: unknown): PatchMemoryInput {
  return parseOrThrow(patchMemorySchema, input, 'Invalid memory patch request.');
}

export function parsePutMemorySummary(input: unknown): PutMemorySummaryInput {
  return parseOrThrow(putMemorySummarySchema, input, 'Invalid memory summary request.');
}

export function parseMemoryQueryPreview(input: unknown): MemoryQueryPreviewInput {
  return parseOrThrow(memoryQueryPreviewSchema, input, 'Invalid memory query preview request.');
}

export function parseMemoryImport(input: unknown): MemoryImportInput {
  return parseOrThrow(memoryImportSchema, input, 'Invalid memory import request.');
}

export function parseMemoryRebuild(input: unknown): MemoryRebuildInput {
  return parseOrThrow(memoryRebuildSchema, input, 'Invalid memory rebuild request.');
}

export function parseMemorySummaryRecord(input: unknown): MemorySummaryRecord {
  return parseOrThrow(memorySummaryRecordSchema, input, 'Invalid memory summary record.');
}

export function parseMemoryContextBlock(input: unknown): MemoryContextBlock {
  return parseOrThrow(memoryContextBlockSchema, input, 'Invalid memory context block.');
}

export function isRetrievableMemory(memory: Pick<MemoryRecord, 'status' | 'validAt' | 'invalidAt'>, nowIso: string): boolean {
  if (memory.status !== 'active') return false;
  const now = Date.parse(nowIso);
  if (memory.validAt && Date.parse(memory.validAt) > now) return false;
  if (memory.invalidAt && Date.parse(memory.invalidAt) <= now) return false;
  return true;
}