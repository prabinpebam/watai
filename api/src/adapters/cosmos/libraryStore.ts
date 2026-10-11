import type { Container, SqlParameter } from '@azure/cosmos';
import { isDeepStrictEqual } from 'node:util';
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

function parseOwnedRecords(resources: unknown[], userId: string, expectedIds?: Set<string>): LibraryItemRecord[] {
  const records = resources.map(parseRecord);
  if (records.some(record => record.userId !== userId)) throw new Error('Library owner binding failed.');
  const unique = new Map<string, LibraryItemRecord>();
  for (const record of records) {
    const previous = unique.get(record.id);
    if ((expectedIds && !expectedIds.has(record.id)) || (previous && !isDeepStrictEqual(previous, record))) {
      throw new Error('Library result binding failed.');
    }
    if (!previous) unique.set(record.id, record);
  }
  return [...unique.values()];
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
      return resource?.id === id && resource.userId === userId ? parseRecord(resource) : null;
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
    const record = resources[0];
    return record?.userId === userId && record.ingestionKey === ingestionKey ? parseRecord(record) : null;
  }

  async getForUpdate(userId: string, id: string): Promise<{ record: LibraryItemRecord; etag: string } | null> {
    try {
      const { resource } = await this.container.item(id, userId).read();
      if (!resource || resource.id !== id || resource.userId !== userId) return null;
      if (typeof resource._etag !== 'string' || !resource._etag.trim()) throw new Error('Library update requires a Cosmos ETag.');
      return { record: parseRecord(resource), etag: resource._etag };
    } catch (error) {
      if ((error as { code?: number }).code === 404) return null;
      throw error;
    }
  }

  async put(record: LibraryItemRecord, etag?: string): Promise<LibraryItemRecord> {
    const validated = parseLibraryItem(record);
    if (etag !== undefined && !etag.trim()) throw new Error('Library update requires a Cosmos ETag.');
    try {
      const response = etag
        ? await this.container.item(validated.id, validated.userId).replace(validated, {
            accessCondition: { type: 'IfMatch', condition: etag },
          })
        : await this.container.items.upsert(validated);
      return response.resource ? parseRecord(response.resource) : validated;
    } catch (error) {
      if (etag && [404, 409, 412].includes((error as { code?: number }).code ?? 0)) {
        throw new AppError('conflict', 'Library item changed. Reload before saving.');
      }
      throw error;
    }
  }

  async createIfAbsent(record: LibraryItemRecord): Promise<LibraryItemRecord | null> {
    const validated = parseLibraryItem(record);
    try {
      const response = await this.container.items.create(validated);
      return response.resource ? parseRecord(response.resource) : validated;
    } catch (error) {
      if ((error as { code?: number }).code === 409) return null;
      throw error;
    }
  }

  async list(userId: string, query: LibraryListQuery): Promise<LibraryListResult> {
    const cursor = decodeCursor(query.cursor, query.sort);
    const parameters: SqlParameter[] = [
      { name: '@userId', value: userId },
      { name: '@state', value: query.state },
    ];
    const predicates = ['c.userId = @userId', 'c.state = @state'];
    const addFilter = (predicate: string, name: string, value: SqlParameter['value']) => {
      predicates.push(predicate);
      parameters.push({ name, value });
    };
    if (query.kinds) addFilter('ARRAY_CONTAINS(@kinds, c.kind)', '@kinds', query.kinds);
    if (query.origins) addFilter('ARRAY_CONTAINS(@origins, c.origin)', '@origins', query.origins);
    if (query.originGroup === 'uploaded') {
      addFilter('ARRAY_CONTAINS(@groupOrigins, c.origin)', '@groupOrigins', ['chat_upload', 'library_upload', 'thread_document']);
    } else if (query.originGroup === 'generated') {
      addFilter('ARRAY_CONTAINS(@groupOrigins, c.origin)', '@groupOrigins', ['chat_generated_image', 'studio_generated_image', 'code_artifact']);
    }
    if (query.threadId) addFilter('c.source.threadId = @threadId', '@threadId', query.threadId);
    if (query.starred !== undefined) {
      addFilter(query.starred ? 'c.userMetadata.starred = @starred' :
        '(NOT IS_DEFINED(c.userMetadata.starred) OR IS_NULL(c.userMetadata.starred) OR c.userMetadata.starred = @starred)', '@starred', query.starred);
    }
    if (query.minBytes !== undefined) addFilter('c.bytes >= @minBytes', '@minBytes', query.minBytes);
    if (query.maxBytes !== undefined) addFilter('c.bytes <= @maxBytes', '@maxBytes', query.maxBytes);
    if (query.createdAfter) addFilter('c.createdAt > @createdAfter', '@createdAfter', query.createdAfter);
    if (query.createdBefore) addFilter('c.createdAt < @createdBefore', '@createdBefore', query.createdBefore);
    const { resources } = await this.container.items.query(
      {
        query: `SELECT * FROM c WHERE ${predicates.join(' AND ')}`,
        parameters,
      },
      { partitionKey: userId },
    ).fetchAll();
    const all = parseOwnedRecords(resources, userId).filter((record) => matches(record, query)).sort((a, b) => compare(a, b, query.sort));
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
    return { records: parseOwnedRecords(resources, userId) };
  }

  async getMany(userId: string, ids: string[]): Promise<LibraryItemRecord[]> {
    if (!ids.length) return [];
    const { resources } = await this.container.items.query(
      {
        query: 'SELECT * FROM c WHERE c.userId = @userId AND ARRAY_CONTAINS(@ids, c.id)',
        parameters: [
          { name: '@userId', value: userId },
          { name: '@ids', value: ids },
        ],
      },
      { partitionKey: userId },
    ).fetchAll();
    return parseOwnedRecords(resources, userId, new Set(ids));
  }

  async findDerived(userId: string, itemId: string, cursor: string | undefined, limit: number): Promise<LibraryListResult> {
    const iterator = this.container.items.query(
      {
        query: `SELECT * FROM c WHERE c.userId = @userId AND (
          (IS_DEFINED(c.image.referenceItemIds) AND ARRAY_CONTAINS(c.image.referenceItemIds, @itemId)) OR
          (IS_DEFINED(c.artifact.sourceItemIds) AND ARRAY_CONTAINS(c.artifact.sourceItemIds, @itemId))
        ) ORDER BY c.createdAt DESC`,
        parameters: [
          { name: '@userId', value: userId },
          { name: '@itemId', value: itemId },
        ],
      },
      { partitionKey: userId, maxItemCount: limit, continuationToken: cursor },
    );
    const page = await iterator.fetchNext();
    return {
      items: parseOwnedRecords(page.resources, userId),
      ...(page.continuationToken ? { cursor: page.continuationToken } : {}),
    };
  }
}
