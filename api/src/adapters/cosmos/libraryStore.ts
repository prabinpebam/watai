import type { Container, SqlParameter } from '@azure/cosmos';
import { AppError } from '../../domain/errors';
import { parseLibraryItem, type LibraryItemRecord, type LibraryListQuery } from '../../domain/library';
import type { LibraryListResult, LibraryStorageAggregate, LibraryStore } from '../../ports/libraryStore';
import { getCosmosDatabase } from './cosmosClient';

interface CursorValue {
  sort: LibraryListQuery['sort'];
  value: string | number;
  id: string;
}

function stripSystemFields(resource: Record<string, unknown>): Record<string, unknown> {
  const { _rid, _self, _etag, _attachments, _ts, ...record } = resource;
  return record;
}

function parseRecord(resource: unknown): LibraryItemRecord {
  return parseLibraryItem(stripSystemFields(resource as Record<string, unknown>));
}

function sortValue(record: LibraryItemRecord, sort: LibraryListQuery['sort']): string | number {
  if (sort === 'largest') return record.bytes;
  if (sort === 'name') return (record.userMetadata?.title ?? record.name).toLocaleLowerCase();
  return record.createdAt;
}

function compare(left: LibraryItemRecord, right: LibraryItemRecord, sort: LibraryListQuery['sort']): number {
  const leftValue = sortValue(left, sort);
  const rightValue = sortValue(right, sort);
  const direction = sort === 'oldest' || sort === 'name' ? 1 : -1;
  const byValue = typeof leftValue === 'number' && typeof rightValue === 'number'
    ? leftValue - rightValue
    : String(leftValue).localeCompare(String(rightValue));
  return direction * byValue || left.id.localeCompare(right.id);
}

function encodeCursor(record: LibraryItemRecord, sort: LibraryListQuery['sort']): string {
  return Buffer.from(JSON.stringify({ sort, value: sortValue(record, sort), id: record.id }), 'utf8').toString('base64url');
}

function decodeCursor(value: string | undefined, sort: LibraryListQuery['sort']): CursorValue | null {
  if (!value) return null;
  try {
    const decoded = JSON.parse(Buffer.from(value, 'base64url').toString('utf8')) as Partial<CursorValue>;
    if (decoded.sort !== sort || (typeof decoded.value !== 'string' && typeof decoded.value !== 'number') || typeof decoded.id !== 'string') {
      throw new Error('shape');
    }
    return decoded as CursorValue;
  } catch {
    throw new AppError('validation', 'Invalid Library cursor.');
  }
}

function afterCursor(record: LibraryItemRecord, cursor: CursorValue, sort: LibraryListQuery['sort']): boolean {
  const synthetic = {
    ...record,
    id: cursor.id,
    bytes: sort === 'largest' ? Number(cursor.value) : record.bytes,
    createdAt: sort === 'newest' || sort === 'oldest' ? String(cursor.value) : record.createdAt,
    name: sort === 'name' ? String(cursor.value) : record.name,
    ...(sort === 'name' ? { userMetadata: { title: String(cursor.value) } } : {}),
  };
  return compare(record, synthetic, sort) > 0;
}

function matches(record: LibraryItemRecord, query: LibraryListQuery): boolean {
  if (record.state !== query.state) return false;
  if (query.kinds && !query.kinds.includes(record.kind)) return false;
  if (query.origins && !query.origins.includes(record.origin)) return false;
  if (query.originGroup === 'uploaded' && !['chat_upload', 'library_upload', 'thread_document'].includes(record.origin)) return false;
  if (query.originGroup === 'generated' && !['chat_generated_image', 'studio_generated_image', 'code_artifact'].includes(record.origin)) return false;
  if (query.threadId && record.source.threadId !== query.threadId) return false;
  if (query.starred !== undefined && (record.userMetadata?.starred ?? false) !== query.starred) return false;
  if (query.minBytes !== undefined && record.bytes < query.minBytes) return false;
  if (query.maxBytes !== undefined && record.bytes > query.maxBytes) return false;
  if (query.createdAfter && record.createdAt <= query.createdAfter) return false;
  if (query.createdBefore && record.createdAt >= query.createdBefore) return false;
  if (query.q) {
    const needle = query.q.toLocaleLowerCase();
    const haystack = `${record.userMetadata?.title ?? ''}\n${record.name}\n${record.image?.prompt ?? ''}`.toLocaleLowerCase();
    if (!haystack.includes(needle)) return false;
  }
  return true;
}

/** Cosmos Library index, partitioned by owner. List filtering stays inside one user partition. */
export class CosmosLibraryStore implements LibraryStore {
  private readonly container: Container;

  constructor(container?: Container) {
    this.container = container ?? getCosmosDatabase().container('library');
  }

  async get(userId: string, id: string): Promise<LibraryItemRecord | null> {
    try {
      const { resource } = await this.container.item(id, userId).read();
      return resource ? parseRecord(resource) : null;
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async getByIngestionKey(userId: string, ingestionKey: string): Promise<LibraryItemRecord | null> {
    const { resources } = await this.container.items.query(
      {
        query: 'SELECT TOP 1 * FROM c WHERE c.userId = @userId AND c.ingestionKey = @ingestionKey',
        parameters: [
          { name: '@userId', value: userId },
          { name: '@ingestionKey', value: ingestionKey },
        ],
      },
      { partitionKey: userId },
    ).fetchAll();
    return resources[0] ? parseRecord(resources[0]) : null;
  }

  async put(record: LibraryItemRecord, etag?: string): Promise<LibraryItemRecord> {
    const validated = parseLibraryItem(record);
    const response = etag
      ? await this.container.item(validated.id, validated.userId).replace(validated, {
          accessCondition: { type: 'IfMatch', condition: etag },
        })
      : await this.container.items.upsert(validated);
    return response.resource ? parseRecord(response.resource) : validated;
  }

  async list(userId: string, query: LibraryListQuery): Promise<LibraryListResult> {
    const parameters: SqlParameter[] = [
      { name: '@userId', value: userId },
      { name: '@state', value: query.state },
    ];
    const { resources } = await this.container.items.query(
      {
        query: 'SELECT * FROM c WHERE c.userId = @userId AND c.state = @state',
        parameters,
      },
      { partitionKey: userId },
    ).fetchAll();
    const cursor = decodeCursor(query.cursor, query.sort);
    const all = resources.map(parseRecord).filter((record) => matches(record, query)).sort((a, b) => compare(a, b, query.sort));
    const remaining = cursor ? all.filter((record) => afterCursor(record, cursor, query.sort)) : all;
    const items = remaining.slice(0, query.limit);
    return {
      items,
      totalApprox: all.length,
      ...(remaining.length > query.limit && items.length ? { cursor: encodeCursor(items[items.length - 1], query.sort) } : {}),
    };
  }

  async aggregate(userId: string): Promise<LibraryStorageAggregate> {
    const { resources } = await this.container.items.query(
      {
        query: 'SELECT * FROM c WHERE c.userId = @userId AND ARRAY_CONTAINS(@states, c.state)',
        parameters: [
          { name: '@userId', value: userId },
          { name: '@states', value: ['active', 'trashed'] },
        ],
      },
      { partitionKey: userId },
    ).fetchAll();
    return { records: resources.map(parseRecord) };
  }
}
