import { memorySourceKeys, type MemoryKind, type MemoryRecord, type MemoryStatus, type MemorySummaryRecord } from '../domain/memory';
import { createHash } from 'node:crypto';

export class MemoryPublicationUnconfirmedError extends Error {
  constructor() {
    super('Memory replacement publication was not confirmed.');
    this.name = 'MemoryPublicationUnconfirmedError';
  }
}

export interface MemoryStoreListOptions {
  status?: MemoryStatus;
  kind?: MemoryKind;
  confirmations?: Array<NonNullable<MemoryRecord['confirmation']>>;
  excludeKinds?: MemoryKind[];
  pinned?: true;
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

export function archivedMemoryExclusion(previous: MemoryExclusion): MemoryExclusion | null {
  if (!previous.sourceHash) return null;
  const suffix = createHash('sha256').update(previous.sourceHash).digest('hex');
  return { ...previous, id: `${previous.id}-hash-${suffix}`, sourceKeys: [...previous.sourceKeys] };
}

export type MemoryExclusionCandidate = Pick<MemoryRecord, 'id' | 'userId' | 'sourceHash' | 'sourceRefs'>;

export function memoryExclusionBatch(userId: string, memories: MemoryExclusionCandidate[]): { ids: string[]; hashes: string[]; sourceKeys: string[] } {
  if (memories.length > 100 || memories.some(memory => memory.userId !== userId)) {
    throw new Error('Memory exclusion batch binding failed.');
  }
  return {
    ids: [...new Set(memories.map(memory => memory.id))],
    hashes: [...new Set(memories.flatMap(memory => memory.sourceHash ? [memory.sourceHash] : []))],
    sourceKeys: [...new Set(memories.flatMap(memory => memorySourceKeys(memory.sourceRefs)))],
  };
}

export interface MemoryStore {
  list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage>;
  get(userId: string, memoryId: string): Promise<MemoryRecord | null>;
  put(record: MemoryRecord): Promise<MemoryRecord>;
  createIfAbsent(record: MemoryRecord, predecessors?: MemoryRecord[]): Promise<MemoryRecord | null>;
  putIfRevision(record: MemoryRecord, expectedRevision: number): Promise<MemoryRecord | null>;
  exclude(record: MemoryRecord, exclusion: MemoryExclusion, expectedRevision: number, previous?: MemoryExclusion): Promise<boolean>;
  getExclusion(userId: string, memoryId: string): Promise<MemoryExclusion | null>;
  isExcluded(userId: string, sourceHash: string | undefined, sourceRefs: MemoryRecord['sourceRefs'], memoryId?: string): Promise<boolean>;
  hasExcludedMemories(userId: string, memories: MemoryExclusionCandidate[]): Promise<boolean>;
  getSummary(userId: string): Promise<MemorySummaryRecord | null>;
  putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord>;
}