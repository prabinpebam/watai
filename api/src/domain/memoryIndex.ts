import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import { hasCurrentMemoryEmbedding, memoryEmbeddingTextHash, type MemoryRecord } from './memory';

export interface MemoryIndexJob {
  id: string;
  userId: string;
  recordType: 'memory-index-job';
  memoryId: string;
  revision: number;
  textHash: string;
  model: string;
  state: 'queued' | 'running' | 'completed' | 'ignored' | 'failed';
  attempts: number;
  availableAt: string;
  executionToken?: string;
}

export function memoryIndexJob(record: MemoryRecord, model: string): MemoryIndexJob {
  if (!model.trim() || record.status !== 'active' || record.confirmation !== 'approved' || record.sensitive || !record.revision) {
    throw new Error('Memory is not eligible for index admission.');
  }
  const textHash = memoryEmbeddingTextHash(record.text);
  const digest = createHash('sha256').update(JSON.stringify([record.userId, record.id, record.revision, textHash, model])).digest('hex');
  return { id: `memory-index-${digest}`, userId: record.userId, recordType: 'memory-index-job', memoryId: record.id,
    revision: record.revision, textHash, model, state: 'queued', attempts: 0, availableAt: new Date(record.updatedAt).toISOString() };
}

const indexJobSchema = z.object({
  id: z.string().min(1).max(128), userId: z.string().min(1).max(64), recordType: z.literal('memory-index-job'),
  memoryId: z.string().min(1).max(64), revision: z.number().int().positive(), textHash: z.string().regex(/^[a-f0-9]{64}$/),
  model: z.string().trim().min(1).max(256), state: z.enum(['queued', 'running', 'completed', 'ignored', 'failed']),
  attempts: z.number().int().min(0).max(3), availableAt: z.string().datetime({ offset: true }), executionToken: z.string().min(1).max(128).optional(),
}).strict();

export function parseMemoryIndexJob(value: unknown): MemoryIndexJob {
  const result = indexJobSchema.safeParse(value);
  if (!result.success) throw new Error('Invalid memory index job.');
  return result.data;
}

export function claimMemoryIndexJob(job: MemoryIndexJob, now: string, token: string): MemoryIndexJob | null {
  if (!Number.isFinite(Date.parse(now)) || !token || (job.state !== 'queued' && job.state !== 'running') || job.availableAt > now) return null;
  return parseMemoryIndexJob({ ...job, state: job.attempts >= 3 ? 'failed' : 'running', attempts: Math.min(3, job.attempts + 1),
    executionToken: token, availableAt: new Date(Date.parse(now) + 120_000).toISOString() });
}

export function validMemoryIndexPublication(job: MemoryIndexJob, expected: MemoryRecord, record: MemoryRecord): boolean {
  return expected.userId === job.userId && expected.id === job.memoryId && expected.revision === job.revision &&
    expected.status === 'active' && expected.confirmation === 'approved' && !expected.sensitive && memoryEmbeddingTextHash(expected.text) === job.textHash &&
    record.revision === job.revision && record.embeddingTextHash === job.textHash &&
    hasCurrentMemoryEmbedding(record, job.userId, job.model, record.embedding?.length ?? 0) &&
    isDeepStrictEqual(record, { ...expected, embedding: record.embedding, embeddingModel: job.model, embeddingTextHash: job.textHash });
}