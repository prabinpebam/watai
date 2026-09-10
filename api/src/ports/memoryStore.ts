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

export interface MemoryExclusion {
  id: string;
  userId: string;
  memoryId: string;
  sourceHash?: string;
  sourceKeys: string[];
  excludedAt: string;
}

export interface MemoryStore {
  list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage>;
  get(userId: string, memoryId: string): Promise<MemoryRecord | null>;
  put(record: MemoryRecord): Promise<MemoryRecord>;
  putIfRevision(record: MemoryRecord, expectedRevision: number): Promise<MemoryRecord | null>;
  exclude(record: MemoryRecord, exclusion: MemoryExclusion): Promise<void>;
  isExcluded(userId: string, sourceHash: string | undefined, sourceRefs: MemoryRecord['sourceRefs']): Promise<boolean>;
  getSummary(userId: string): Promise<MemorySummaryRecord | null>;
  putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord>;
}