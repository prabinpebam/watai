import type { MemoryKind, MemoryRecord, MemoryStatus, MemorySummaryRecord } from '../domain/memory';

export interface MemoryStoreListOptions {
  status?: MemoryStatus;
  kind?: MemoryKind;
  q?: string;
  cursor?: string;
  limit?: number;
}

export interface MemoryListPage {
  memories: MemoryRecord[];
  cursor?: string;
}

export interface MemoryStore {
  list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage>;
  get(userId: string, memoryId: string): Promise<MemoryRecord | null>;
  put(record: MemoryRecord): Promise<MemoryRecord>;
  getSummary(userId: string): Promise<MemorySummaryRecord | null>;
  putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord>;
}