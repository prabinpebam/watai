import { z } from 'zod';
import { createHash } from 'node:crypto';
import { containsSecretLikeValue } from './secrets';
import { memoryRouteTargetSchema } from './memoryRouting';
import { parseOrThrow } from './validate';

export { containsSecretLikeValue } from './secrets';

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

export function memorySourceKeys(refs: MemorySourceRef[]): string[] {
  return [...new Set(refs
    .filter(ref => ref.threadId?.trim() || ref.messageId?.trim() || ref.runId?.trim())
    .map(ref => `${ref.type}:${ref.threadId ?? ''}:${ref.messageId ?? ''}:${ref.runId ?? ''}`))];
}

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
    origin: z.enum(['manual', 'explicit_request', 'inferred', 'imported']).optional(),
    confirmation: z.enum(['approved', 'automatic', 'unknown']).optional(),
    revision: z.number().int().positive().optional(),
    route: memoryRouteTargetSchema.optional(),
    visibility: z.enum(MEMORY_VISIBILITY),
    validAt: iso.optional(),
    invalidAt: iso.optional(),
    validityHistory: z.array(z.object({
      validAt: z.string().datetime({ offset: true }).optional(),
      invalidAt: z.string().datetime({ offset: true }),
      revision: z.number().int().positive(),
    }).strict().refine(interval => interval.validAt === undefined || Date.parse(interval.validAt) <= Date.parse(interval.invalidAt),
      'Memory validity interval is reversed.')).max(16).optional(),
    createdAt: iso,
    updatedAt: iso,
    lastUsedAt: iso.optional(),
    useCount: z.number().int().nonnegative(),
    supersedes: z.array(id).max(16).optional(),
    supersededBy: id.optional(),
    embedding: z.array(z.number()).max(4096).optional(),
    embeddingModel: z.string().trim().min(1).max(100).optional(),
    embeddingTextHash: z.string().regex(/^[a-f0-9]{64}$/).optional(),
    deletedAt: iso.optional(),
  })
  .strict();

export type MemoryRecord = z.infer<typeof memoryRecordSchema>;

export function memoryEmbeddingTextHash(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

export function usableMemoryVector(vector: number[]): boolean {
  if (!vector.length || !vector.every(Number.isFinite)) return false;
  const squaredNorm = vector.reduce((total, value) => total + value * value, 0);
  return squaredNorm > 0 && Number.isFinite(squaredNorm);
}

export function hasCurrentMemoryEmbedding(memory: MemoryRecord, userId: string, model: string, dimensions: number): boolean {
  const vector = memory.embedding;
  if (memory.userId !== userId || !model.trim() || memory.embeddingModel !== model ||
      memory.embeddingTextHash !== memoryEmbeddingTextHash(memory.text) ||
        !vector?.length || vector.length !== dimensions) return false;
      return usableMemoryVector(vector);
}

// Manual memories exclude project / work context too — we do not store project work context at all
// (it must not cross-bleed across intentionally-isolated threads). thread_summary + entity are
// system-managed kinds users never author directly.
const manualMemoryKinds = MEMORY_KINDS.filter(
  (kind) => kind !== 'thread_summary' && kind !== 'entity' && kind !== 'project_context',
) as [
  Exclude<MemoryKind, 'thread_summary' | 'entity' | 'project_context'>,
  ...Array<Exclude<MemoryKind, 'thread_summary' | 'entity' | 'project_context'>>,
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
    expectedRevision: z.number().int().positive(),
    text: text.optional(),
    kind: z.enum(MEMORY_KINDS).optional(),
    status: z.enum(['active', 'suppressed', 'invalidated']).optional(),
    visibility: z.enum(MEMORY_VISIBILITY).optional(),
    pinned: z.boolean().optional(),
    salience: score.optional(),
  })
  .strict()
  .refine((patch) => patch.text !== undefined || patch.kind !== undefined || patch.status !== undefined ||
    patch.visibility !== undefined || patch.pinned !== undefined || patch.salience !== undefined,
  'At least one memory change is required.');

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

const memoryImportV1Schema = z
  .object({
    version: z.literal(1),
    memories: z.array(memoryImportItemSchema).max(500),
    mode: z.enum(['preview', 'commit']),
  })
  .strict();

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

const archiveTimestamp = z.string().datetime({ offset: true });
const memoryTransferRecordSchema = memoryRecordSchema.extend({
  status: z.literal('active'),
  createdAt: archiveTimestamp,
  updatedAt: archiveTimestamp,
  validAt: archiveTimestamp.optional(),
  invalidAt: archiveTimestamp.optional(),
  lastUsedAt: archiveTimestamp.optional(),
  deletedAt: archiveTimestamp.optional(),
  sourceRefs: z.array(memorySourceRefSchema.and(z.object({ createdAt: archiveTimestamp }))).min(1).max(12),
}).refine(record => record.validAt === undefined || record.invalidAt === undefined || Date.parse(record.validAt) <= Date.parse(record.invalidAt),
  'Memory archive validity interval is reversed.');

const memoryTransferArchiveSchema = z.object({
  version: z.literal(2),
  scope: z.literal('active-records'),
  exportedAt: archiveTimestamp,
  memories: z.array(memoryTransferRecordSchema).max(1000),
  summary: memorySummaryRecordSchema.extend({ updatedAt: archiveTimestamp }).nullable(),
}).strict();

const memoryImportSchema = z.discriminatedUnion('version', [
  memoryImportV1Schema,
  memoryTransferArchiveSchema.extend({ mode: z.literal('preview') }).strict(),
]);

export type MemoryTransferArchive = z.infer<typeof memoryTransferArchiveSchema>;
export type MemoryImportInput = z.infer<typeof memoryImportSchema>;

export function parseMemoryTransferArchive(input: unknown): MemoryTransferArchive {
  return parseOrThrow(memoryTransferArchiveSchema, input, 'Invalid memory archive.');
}

export const MAX_MEMORY_CONTEXT_RECORDS = 16;

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
            origin: z.enum(['manual', 'explicit_request', 'inferred', 'imported']),
            confirmation: z.enum(['approved', 'automatic']),
            revision: z.number().int().positive(),
            profileOnly: z.boolean().optional(),
          })
          .strict(),
      )
      .max(MAX_MEMORY_CONTEXT_RECORDS),
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
    retrievalMode: z.enum(['empty', 'vector', 'profile']),
    degradedReason: z.enum(['timeout', 'cancelled', 'unavailable']).optional(),
    profile: z.string().trim().max(4000).optional(),
  })
  .strict();

export type MemoryContextBlock = z.infer<typeof memoryContextBlockSchema>;

export function parseMemoryRecord(input: unknown): MemoryRecord {
  return parseOrThrow(memoryRecordSchema, input, 'Invalid memory record.');
}

export function prepareMemorySupersession(record: MemoryRecord, predecessors: MemoryRecord[]): MemoryRecord[] | null {
  const ids = predecessors.map(previous => previous.id);
  if (predecessors.length > 16 || new Set(ids).size !== ids.length ||
      (record.supersedes?.length ?? 0) !== ids.length ||
      ids.some(id => !record.supersedes?.includes(id)) ||
      predecessors.some(previous => previous.id === record.id || previous.userId !== record.userId ||
        previous.status !== 'active' || previous.sensitive || previous.confirmation === 'approved')) return null;
  return predecessors.map(previous => ({
    ...previous, status: 'invalidated', supersededBy: record.id, invalidAt: record.updatedAt,
    updatedAt: record.updatedAt, revision: (previous.revision ?? 1) + 1,
  }));
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
  if (!Number.isFinite(now)) return false;
  if (memory.validAt !== undefined) {
    const validAt = Date.parse(memory.validAt);
    if (!Number.isFinite(validAt) || validAt > now) return false;
  }
  if (memory.invalidAt !== undefined) {
    const invalidAt = Date.parse(memory.invalidAt);
    if (!Number.isFinite(invalidAt) || invalidAt <= now) return false;
  }
  return true;
}