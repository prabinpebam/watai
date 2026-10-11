import type { MemoryExtractionJobRecord } from '../domain/memoryExtraction';

export function isCurrentMemoryJob(current: MemoryExtractionJobRecord | null | undefined, expected: MemoryExtractionJobRecord): boolean {
  return !!current && current.id === expected.id && current.userId === expected.userId &&
    current.threadId === expected.threadId && current.kind === expected.kind &&
    current.userMessageId === expected.userMessageId && current.assistantMessageId === expected.assistantMessageId &&
    current.sourceRevision === expected.sourceRevision && current.dedupeKey === expected.dedupeKey &&
    current.runId === expected.runId && current.createdAt === expected.createdAt &&
    current.status === expected.status && current.releaseId === expected.releaseId &&
    current.executionToken === expected.executionToken && current.dispatchAttempt === expected.dispatchAttempt &&
    current.attempts === expected.attempts && current.updatedAt === expected.updatedAt;
}

export interface MemoryJobDispatchRecord {
  jobId: string;
  userId: string;
  releaseId: string;
  executionToken: string;
  attempt: number;
  state: 'pending' | 'sent';
  createdAt: string;
  updatedAt: string;
}

export interface MemoryJobStore {
  get(userId: string, id: string): Promise<MemoryExtractionJobRecord | null>;
  getByDedupeKey(userId: string, dedupeKey: string): Promise<MemoryExtractionJobRecord | null>;
  admit(record: MemoryExtractionJobRecord): Promise<{ outcome: 'accepted' | 'replay'; job: MemoryExtractionJobRecord }>;
  claim(userId: string, id: string, updatedAt: string, fence?: { releaseId: string; executionToken: string; attempt: number }): Promise<MemoryExtractionJobRecord | null>;
  listPendingDispatch(limit?: number): Promise<MemoryJobDispatchRecord[]>;
  listStaleRunning(before: string, limit?: number): Promise<MemoryExtractionJobRecord[]>;
  markDispatchSent(record: MemoryJobDispatchRecord, sentAt: string): Promise<void>;
  put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord>;
  putIfCurrent(record: MemoryExtractionJobRecord, expected: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord | null>;
}