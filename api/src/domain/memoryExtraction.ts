import { z } from 'zod';
import { MEMORY_KINDS, containsSecretLikeValue } from './memory';
import { parseOrThrow } from './validate';

export const MEMORY_JOB_KINDS = ['command', 'turn', 'rebuild'] as const;
export type MemoryJobKind = (typeof MEMORY_JOB_KINDS)[number];

export const MEMORY_JOB_STATUSES = ['queued', 'running', 'completed', 'ignored', 'failed'] as const;
export type MemoryJobStatus = (typeof MEMORY_JOB_STATUSES)[number];

const id = z.string().trim().min(1).max(64);
const text = z.string().trim().min(1).max(2000).refine((value) => !containsSecretLikeValue(value), {
  message: 'Memory extraction text cannot contain secret-like values.',
});
const reason = z.string().trim().min(1).max(800);
const score = z.number().min(0).max(1);
const autoKinds = MEMORY_KINDS.filter((kind) => kind !== 'thread_summary' && kind !== 'entity') as [
  Exclude<(typeof MEMORY_KINDS)[number], 'thread_summary' | 'entity'>,
  ...Array<Exclude<(typeof MEMORY_KINDS)[number], 'thread_summary' | 'entity'>>,
];

const addOperationSchema = z
  .object({
    op: z.literal('add'),
    kind: z.enum(autoKinds),
    text,
    entities: z.array(z.string().trim().min(1).max(80)).max(32).optional(),
    topics: z.array(z.string().trim().min(1).max(80)).max(32).optional(),
    confidence: score,
    salience: score,
    validAt: z.string().trim().min(1).max(40).optional(),
    sourceMessageIds: z.array(id).min(1).max(12),
    supersedes: z.array(id).max(16).optional(),
    reason,
  })
  .strict();

const mergeOperationSchema = z
  .object({
    op: z.literal('merge'),
    memoryId: id,
    text: text.optional(),
    entities: z.array(z.string().trim().min(1).max(80)).max(32).optional(),
    topics: z.array(z.string().trim().min(1).max(80)).max(32).optional(),
    confidence: score.optional(),
    salience: score.optional(),
    sourceMessageIds: z.array(id).min(1).max(12),
    reason,
  })
  .strict();

const invalidateOperationSchema = z
  .object({
    op: z.literal('invalidate'),
    memoryId: id,
    replacementText: text.optional(),
    sourceMessageIds: z.array(id).min(1).max(12),
    reason,
  })
  .strict();

const suppressOperationSchema = z
  .object({
    op: z.literal('suppress'),
    memoryId: id,
    sourceMessageIds: z.array(id).min(1).max(12),
    reason,
  })
  .strict();

const ignoreOperationSchema = z.object({ op: z.literal('ignore'), reason }).strict();

export const memoryExtractionOperationSchema = z.discriminatedUnion('op', [
  addOperationSchema,
  mergeOperationSchema,
  invalidateOperationSchema,
  suppressOperationSchema,
  ignoreOperationSchema,
]);

const extractionOutputSchema = z
  .object({
    operations: z.array(memoryExtractionOperationSchema).min(1).max(16),
  })
  .strict();

const jobMessageSchema = z
  .object({
    jobId: id,
    userId: id,
    threadId: id,
    kind: z.enum(MEMORY_JOB_KINDS),
  })
  .strict();

const jobRecordSchema = z
  .object({
    id,
    userId: id,
    threadId: id,
    kind: z.enum(MEMORY_JOB_KINDS),
    status: z.enum(MEMORY_JOB_STATUSES),
    userMessageId: id.optional(),
    assistantMessageId: id.optional(),
    runId: id.optional(),
    dedupeKey: z.string().trim().min(1).max(160),
    attempts: z.number().int().nonnegative(),
    operationCounts: z
      .object({ add: z.number().int().nonnegative(), merge: z.number().int().nonnegative(), invalidate: z.number().int().nonnegative(), suppress: z.number().int().nonnegative(), ignore: z.number().int().nonnegative() })
      .strict()
      .optional(),
    acceptedCount: z.number().int().nonnegative().optional(),
    rejectedCount: z.number().int().nonnegative().optional(),
    lastErrorCode: z.string().trim().min(1).max(80).optional(),
    lastErrorMessage: z.string().trim().min(1).max(400).optional(),
    createdAt: z.string().trim().min(1).max(40),
    updatedAt: z.string().trim().min(1).max(40),
    completedAt: z.string().trim().min(1).max(40).optional(),
  })
  .strict();

export type MemoryExtractionOperation = z.infer<typeof memoryExtractionOperationSchema>;
export type MemoryExtractionOutput = z.infer<typeof extractionOutputSchema>;
export type MemoryJobMessage = z.infer<typeof jobMessageSchema>;
export type MemoryExtractionJobRecord = z.infer<typeof jobRecordSchema>;

export function parseMemoryExtractionOutput(input: unknown): MemoryExtractionOutput {
  return parseOrThrow(extractionOutputSchema, input, 'Invalid memory extraction output.');
}

export function parseMemoryJobMessage(input: unknown): MemoryJobMessage {
  return parseOrThrow(jobMessageSchema, input, 'Invalid memory job message.');
}

export function parseMemoryExtractionJobRecord(input: unknown): MemoryExtractionJobRecord {
  return parseOrThrow(jobRecordSchema, input, 'Invalid memory extraction job.');
}