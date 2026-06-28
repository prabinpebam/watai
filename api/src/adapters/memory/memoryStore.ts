import type { MemoryRecord, MemorySummaryRecord } from '../../domain/memory';
import type { MemoryListPage, MemoryStore, MemoryStoreListOptions } from '../../ports/memoryStore';

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
export class InMemoryMemoryStore implements MemoryStore {
  private readonly memories = new Map<string, MemoryRecord>();
  private readonly summaries = new Map<string, MemorySummaryRecord>();

  async list(userId: string, opts?: MemoryStoreListOptions): Promise<MemoryListPage> {
    const limit = opts?.limit ?? 50;
    const cursor = decodeCursor(opts?.cursor);
    const rows = [...this.memories.values()]
      .filter((memory) => memory.userId === userId)
      .filter((memory) => (opts?.status ? memory.status === opts.status : memory.status === 'active'))
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

  async getSummary(userId: string): Promise<MemorySummaryRecord | null> {
    const summary = this.summaries.get(userId);
    return summary ? { ...summary, sourceMemoryIds: [...summary.sourceMemoryIds] } : null;
  }

  async putSummary(record: MemorySummaryRecord): Promise<MemorySummaryRecord> {
    this.summaries.set(record.userId, { ...record, sourceMemoryIds: [...record.sourceMemoryIds] });
    return record;
  }
}