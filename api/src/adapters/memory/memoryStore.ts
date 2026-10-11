import { isDeepStrictEqual } from 'node:util';
import { memorySourceKeys, prepareMemorySupersession, type MemoryRecord, type MemorySummaryRecord } from '../../domain/memory';
import { archivedMemoryExclusion, memoryExclusionBatch, type MemoryExclusion, type MemoryExclusionCandidate, type MemoryListPage, type MemoryStore, type MemoryStoreListOptions } from '../../ports/memoryStore';
import { claimMemoryIndexJob, memoryIndexJob, validMemoryIndexPublication, type MemoryIndexJob } from '../../domain/memoryIndex';
import type { MemoryIndexStore } from '../../ports/memoryIndexStore';

function key(userId: string, id: string): string {
  return `${userId}\u0000${id}`;
}

function encodeCursor(record: MemoryRecord): string {
  return Buffer.from(JSON.stringify({ updatedAt: record.updatedAt, id: record.id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor?: string): { updatedAt: string; id: string } | null {
  if (!cursor) return null;
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { updatedAt?: string; id?: string };
    return parsed.updatedAt && parsed.id ? { updatedAt: parsed.updatedAt, id: parsed.id } : null;
  } catch {
    return null;
  }
}

function matchesQ(memory: MemoryRecord, q?: string): boolean {
  if (!q) return true;
  const needle = q.trim().toLowerCase();
  if (!needle) return true;
  return [memory.text, memory.summary, ...(memory.entities ?? []), ...(memory.topics ?? [])]
    .filter((value): value is string => !!value)
    .some((value) => value.toLowerCase().includes(needle));
}

function afterCursor(memory: MemoryRecord, cursor: { updatedAt: string; id: string } | null): boolean {
  if (!cursor) return true;
  if (memory.updatedAt < cursor.updatedAt) return true;
  if (memory.updatedAt === cursor.updatedAt && memory.id < cursor.id) return true;
  return false;
}

/** In-memory MemoryStore for unit tests. Mirrors the Cosmos /userId partition boundary. */
export class InMemoryMemoryStore implements MemoryStore, MemoryIndexStore {
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly summaries = new Map<string, MemorySummaryRecord>();
  private readonly exclusions = new Map<string, MemoryExclusion>();
  private readonly indexJobs = new Map<string, MemoryIndexJob>();

  async saveWithIndex(record: MemoryRecord, model: string, expectedRevision?: number): Promise<MemoryRecord | null> {
    const job = memoryIndexJob(record, model);
    const current = this.memories.get(key(record.userId, record.id));
    if (expectedRevision === undefined ? !!current : !current || current.status === 'deleted' || (current.revision ?? 1) !== expectedRevision) return null;
    if (this.indexJobs.has(key(job.userId, job.id))) return null;
    const savedRecord = structuredClone(record);
    const savedJob = structuredClone(job);
    this.memories.set(key(record.userId, record.id), savedRecord);
    this.indexJobs.set(key(job.userId, job.id), savedJob);
    return record;
  }

  async listIndexJobs(now: string, limit: number): Promise<MemoryIndexJob[]> {
    return [...this.indexJobs.values()].filter(job => (job.state === 'queued' || job.state === 'running') && job.availableAt <= now)
      .sort((first, second) => first.availableAt.localeCompare(second.availableAt))
      .slice(0, Math.max(1, Math.min(10, limit))).map(job => structuredClone(job));
  }

  async getIndexJob(userId: string, id: string): Promise<MemoryIndexJob | null> {
    const job = this.indexJobs.get(key(userId, id));
    return job ? structuredClone(job) : null;
  }

  async claimIndexJob(userId: string, id: string, now: string, token: string): Promise<MemoryIndexJob | null> {
    const current = this.indexJobs.get(key(userId, id));
    if (!current) return null;
    const claimed = claimMemoryIndexJob(current, now, token);
    if (!claimed) return null;
    this.indexJobs.set(key(userId, id), claimed);
    return claimed.state === 'running' ? structuredClone(claimed) : null;
  }

  async finishIndexJob(job: MemoryIndexJob, state: 'completed' | 'ignored' | 'queued' | 'failed', now: string,
    publication?: { expected: MemoryRecord; record: MemoryRecord }): Promise<boolean> {
    if (job.state !== 'running' || job.availableAt <= now || !isDeepStrictEqual(this.indexJobs.get(key(job.userId, job.id)), job)) return false;
    if ((state === 'completed' && publication === undefined) || (publication && state !== 'completed')) return false;
    if (publication && (!validMemoryIndexPublication(job, publication.expected, publication.record) ||
      !isDeepStrictEqual(this.memories.get(key(job.userId, job.memoryId)), publication.expected))) return false;
    const next = structuredClone({ ...job, state, availableAt: new Date(Date.parse(now) + 30_000).toISOString() });
    const memory = publication ? structuredClone(publication.record) : undefined;
    if (memory) this.memories.set(key(job.userId, job.memoryId), memory);
    this.indexJobs.set(key(job.userId, job.id), next);
    return true;
  }

  async list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage> {
    const limit = opts?.limit ?? 50;
    const cursor = decodeCursor(opts?.cursor);
    const rows = [...this.memories.values()]
      .filter((memory) => memory.userId === userId)
      .filter((memory) => (opts?.status ? memory.status === opts.status : memory.status === 'active'))
      .filter((memory) => !opts?.confirmations || (memory.confirmation !== undefined && opts.confirmations.includes(memory.confirmation)))
      .filter((memory) => !opts?.excludeKinds?.includes(memory.kind))
      .filter((memory) => !opts?.pinned || memory.pinned === true)
      .filter((memory) => !opts?.kind || memory.kind === opts.kind)
      .filter((memory) => matchesQ(memory, opts?.q))
      .sort((a, b) => (a.updatedAt === b.updatedAt ? b.id.localeCompare(a.id) : b.updatedAt.localeCompare(a.updatedAt)))
      .filter((memory) => afterCursor(memory, cursor));
    const page = rows.slice(0, limit);
    return {
      memories: page.map((memory) => ({ ...memory, sourceRefs: memory.sourceRefs.map((ref) => ({ ...ref })) })),
      ...(rows.length > limit && page.length ? { cursor: encodeCursor(page[page.length - 1]) } : {}),
    };
  }

  async get(userId: string, memoryId: string): Promise<MemoryRecord | null> {
    const record = this.memories.get(key(userId, memoryId));
    return record ? { ...record, sourceRefs: record.sourceRefs.map((ref) => ({ ...ref })) } : null;
  }

  async put(record: MemoryRecord): Promise<MemoryRecord> {
    this.memories.set(key(record.userId, record.id), { ...record, sourceRefs: record.sourceRefs.map((ref) => ({ ...ref })) });
    return record;
  }

  async createIfAbsent(record: MemoryRecord, predecessors: MemoryRecord[] = []): Promise<MemoryRecord | null> {
    const replacements = prepareMemorySupersession(record, predecessors);
    if (!replacements || predecessors.some(previous => !isDeepStrictEqual(this.memories.get(key(record.userId, previous.id)), previous))) return null;
    if (this.memories.has(key(record.userId, record.id))) return null;
    const prepared = [record, ...replacements].map(memory => structuredClone(memory));
    for (const memory of prepared) this.memories.set(key(memory.userId, memory.id), memory);
    return record;
  }

  async putIfRevision(record: MemoryRecord, expectedRevision: number): Promise<MemoryRecord | null> {
    const current = this.memories.get(key(record.userId, record.id));
    if (!current || current.status === 'deleted' || (current.revision ?? 1) !== expectedRevision) return null;
    await this.put(record);
    return record;
  }

  async exclude(record: MemoryRecord, exclusion: MemoryExclusion, expectedRevision: number, previous?: MemoryExclusion): Promise<boolean> {
    const current = this.memories.get(key(record.userId, record.id));
    if (!current || (current.status === 'deleted' && record.status !== 'deleted') || (current.revision ?? 1) !== expectedRevision ||
        exclusion.userId !== record.userId || exclusion.memoryId !== record.id) return false;
    const receipt = this.exclusions.get(key(exclusion.userId, exclusion.id));
    if (previous ? !isDeepStrictEqual(receipt, previous) : receipt !== undefined) return false;
    if (previous && (previous.id !== exclusion.id || previous.userId !== exclusion.userId || previous.memoryId !== exclusion.memoryId ||
      previous.excludedAt !== exclusion.excludedAt || !Array.isArray(previous.sourceKeys) || !Array.isArray(exclusion.sourceKeys) ||
      !previous.sourceKeys.every(source => exclusion.sourceKeys.includes(source)))) return false;
    const archive = previous?.sourceHash && previous.sourceHash !== exclusion.sourceHash ? archivedMemoryExclusion(previous) : null;
    const existingArchive = archive ? this.exclusions.get(key(archive.userId, archive.id)) : undefined;
    if (existingArchive && (existingArchive.userId !== exclusion.userId || existingArchive.memoryId !== exclusion.memoryId ||
      existingArchive.sourceHash !== archive!.sourceHash || !Array.isArray(existingArchive.sourceKeys))) return false;
    const savedRecord = structuredClone(record);
    const savedExclusion = structuredClone(exclusion);
    const savedArchive = archive && !existingArchive ? structuredClone(archive) : null;
    this.memories.set(key(record.userId, record.id), savedRecord);
    this.exclusions.set(key(exclusion.userId, exclusion.id), savedExclusion);
    if (savedArchive) this.exclusions.set(key(savedArchive.userId, savedArchive.id), savedArchive);
    return true;
  }

  async getExclusion(userId: string, memoryId: string): Promise<MemoryExclusion | null> {
    const exclusion = this.exclusions.get(key(userId, `memory-exclusion-${memoryId}`));
    return exclusion ? structuredClone(exclusion) : null;
  }

  async isExcluded(userId: string, sourceHash: string | undefined, sourceRefs: MemoryRecord['sourceRefs'], memoryId?: string): Promise<boolean> {
    const sourceKeys = new Set(memorySourceKeys(sourceRefs));
    return [...this.exclusions.values()].some((exclusion) =>
      exclusion.userId === userId &&
      ((!!memoryId && exclusion.memoryId === memoryId) || (!!sourceHash && exclusion.sourceHash === sourceHash) || exclusion.sourceKeys.some((sourceKey) => sourceKeys.has(sourceKey))));
  }

  async getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    const summary = this.summaries.get(userId);
    return summary ? { ...summary, sourceMemoryIds: [...summary.sourceMemoryIds] } : null;
  }

  async hasExcludedMemories(userId: string, memories: MemoryExclusionCandidate[]): Promise<boolean> {
    const batch = memoryExclusionBatch(userId, memories);
    const ids = new Set(batch.ids);
    const hashes = new Set(batch.hashes);
    const sourceKeys = new Set(batch.sourceKeys);
    return [...this.exclusions.values()].some(exclusion => exclusion.userId === userId &&
      (ids.has(exclusion.memoryId) || (!!exclusion.sourceHash && hashes.has(exclusion.sourceHash)) ||
        exclusion.sourceKeys.some(sourceKey => sourceKeys.has(sourceKey))));
  }

  async putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord> {
    this.summaries.set(record.userId, { ...record, sourceMemoryIds: [...record.sourceMemoryIds] });
    return record;
  }
}