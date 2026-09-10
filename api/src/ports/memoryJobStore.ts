import type { MemoryExtractionJobRecord } from '../domain/memoryExtraction';

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
  markDispatchSent(record: MemoryJobDispatchRecord, sentAt: string): Promise<void>;
  put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord>;
}