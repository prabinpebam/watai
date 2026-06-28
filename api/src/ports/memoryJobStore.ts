import type { MemoryExtractionJobRecord } from '../domain/memoryExtraction';

export interface MemoryJobStore {
  get(userId: string, id: string): Promise<MemoryExtractionJobRecord | null>;
  getByDedupeKey(userId: string, dedupeKey: string): Promise<MemoryExtractionJobRecord | null>;
  put(record: MemoryExtractionJobRecord): Promise<MemoryExtractionJobRecord>;
}