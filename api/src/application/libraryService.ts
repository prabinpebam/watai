import { randomUUID } from 'node:crypto';
import { AppError } from '../domain/errors';
import { assertLibraryTransition, libraryItemId, libraryStorageBytes, libraryUploadType, type LibraryItemRecord, type LibraryLineageQuery, type LibraryListQuery, type LibraryUploadCompleteInput, type LibraryUploadInput } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';
import type { SasMinter } from '../ports/sasMinter';
import { toLibraryItemDto, type LibraryItemDTO, type LibraryStorageSummaryDTO } from './libraryDto';

const STORAGE_CACHE_MS = 5 * 60_000;
const CAPACITY_RATE_PER_GB_MONTH = 0.0184;
const UPLOAD_TTL_SECONDS = 15 * 60;

interface CachedSummary {
  expiresAt: number;
  value: LibraryStorageSummaryDTO;
}

export class LibraryService {
  private readonly storageCache = new Map<string, CachedSummary>();

  constructor(
    private readonly store: LibraryStore,
    private readonly minter: SasMinter,
    private readonly nowMs: () => number = Date.now,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly newId: () => string = randomUUID,
  ) {}

  async list(userId: string, query: LibraryListQuery): Promise<{ items: LibraryItemDTO[]; cursor?: string; totalApprox?: number }> {
    const page = await this.store.list(userId, query);
    const items = await Promise.all(page.items.map((item) => toLibraryItemDto(this.minter, item)));
    return {
      items,
      ...(page.cursor ? { cursor: page.cursor } : {}),
      ...(page.totalApprox !== undefined ? { totalApprox: page.totalApprox } : {}),
    };
  }

  async get(userId: string, id: string): Promise<LibraryItemDTO> {
    const item = await this.store.get(userId, id);
    if (!item) throw new AppError('not_found', 'Library item not found.');
    return toLibraryItemDto(this.minter, item);
  }

  async storage(userId: string): Promise<LibraryStorageSummaryDTO> {
    const cached = this.storageCache.get(userId);
    if (cached && cached.expiresAt > this.nowMs()) return cached.value;
    const { records, reconciledAt } = await this.store.aggregate(userId);
    const value = storageSummary(records, reconciledAt);
    this.storageCache.set(userId, { value, expiresAt: this.nowMs() + STORAGE_CACHE_MS });
    return value;
  }

  async lineage(userId: string, id: string, query: LibraryLineageQuery): Promise<{ items: LibraryItemDTO[]; cursor?: string }> {
    const source = await this.store.get(userId, id);
    if (!source) throw new AppError('not_found', 'Library item not found.');
    if (query.direction === 'derived') {
      const page = await this.store.findDerived(userId, id, query.cursor, query.limit);
      return {
        items: await Promise.all(page.items.map((item) => toLibraryItemDto(this.minter, item))),
        ...(page.cursor ? { cursor: page.cursor } : {}),
      };
    }
    const referenceIds = source.image?.referenceItemIds ?? source.artifact?.sourceItemIds ?? [];
    const offset = decodeLineageOffset(query.cursor);
    const selectedIds = referenceIds.slice(offset, offset + query.limit);
    const records = await this.store.getMany(userId, selectedIds);
    const byId = new Map(records.map((record) => [record.id, record]));
    const ordered = selectedIds.map((itemId) => byId.get(itemId)).filter((item): item is LibraryItemRecord => !!item);
    const nextOffset = offset + selectedIds.length;
    return {
      items: await Promise.all(ordered.map((item) => toLibraryItemDto(this.minter, item))),
      ...(nextOffset < referenceIds.length ? { cursor: encodeLineageOffset(nextOffset) } : {}),
    };
  }

  async reserveUpload(userId: string, input: LibraryUploadInput): Promise<{ item: LibraryItemDTO; upload: { url: string; expiresAt: string; headers: Record<string, string> } }> {
    const type = libraryUploadType(input.mime);
    const ingestionKey = `library_upload:${this.newId()}`;
    const id = libraryItemId(userId, ingestionKey);
    const now = new Date(this.nowMs()).toISOString();
    const blobPath = `${userId}/library/${id}.${type.extension}`;
    const item: LibraryItemRecord = {
      id,
      userId,
      ingestionKey,
      state: 'pending',
      kind: type.kind,
      origin: 'library_upload',
      name: input.name,
      mime: input.mime,
      bytes: input.bytes,
      blobPath,
      contentHash: input.contentHash,
      createdAt: now,
      updatedAt: now,
      source: { surface: 'library', createdAt: now },
      ...(type.kind === 'image' ? { image: { provenanceComplete: true } } : {}),
    };
    const saved = await this.store.put(item);
    const grant = await this.minter.mint({ blobPath, op: 'write', contentType: input.mime, ttlSeconds: UPLOAD_TTL_SECONDS });
    return {
      item: await toLibraryItemDto(this.minter, saved),
      upload: {
        url: grant.url,
        expiresAt: grant.expiresAt,
        headers: {
          'x-ms-blob-type': 'BlockBlob',
          'Content-Type': input.mime,
          'x-ms-meta-contenthash': input.contentHash,
        },
      },
    };
  }

  async completeUpload(userId: string, id: string, input: LibraryUploadCompleteInput): Promise<LibraryItemDTO> {
    const item = await this.store.get(userId, id);
    if (!item) throw new AppError('not_found', 'Library item not found.');
    if (item.state === 'active') return toLibraryItemDto(this.minter, item);
    if (item.state !== 'pending' || !item.blobPath) throw new AppError('conflict', 'Library upload cannot be completed in its current state.');
    if (item.bytes !== input.bytes || item.contentHash !== input.contentHash) throw new AppError('validation', 'Library upload completion does not match its reservation.');
    const { url } = await this.minter.mint({ blobPath: item.blobPath, op: 'read', contentType: item.mime, ttlSeconds: 120 });
    const response = await this.fetchImpl(url, { method: 'HEAD' });
    const observedBytes = Number(response.headers.get('content-length'));
    const observedMime = response.headers.get('content-type')?.split(';')[0]?.trim().toLowerCase();
    const observedHash = response.headers.get('x-ms-meta-contenthash');
    if (!response.ok || observedBytes !== item.bytes || observedMime !== item.mime.toLowerCase() || observedHash !== item.contentHash) {
      throw new AppError('conflict', 'Uploaded file properties do not match the Library reservation.');
    }
    assertLibraryTransition(item.state, 'active');
    const active = await this.store.put({ ...item, state: 'active', updatedAt: new Date(this.nowMs()).toISOString() });
    this.storageCache.delete(userId);
    return toLibraryItemDto(this.minter, active);
  }
}

function encodeLineageOffset(offset: number): string {
  return Buffer.from(JSON.stringify({ offset }), 'utf8').toString('base64url');
}

function decodeLineageOffset(cursor?: string): number {
  if (!cursor) return 0;
  try {
    const value = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { offset?: unknown };
    if (!Number.isInteger(value.offset) || Number(value.offset) < 0) throw new Error('shape');
    return Number(value.offset);
  } catch {
    throw new AppError('validation', 'Invalid Library lineage cursor.');
  }
}

export function storageSummary(records: LibraryItemRecord[], reconciledAt?: string): LibraryStorageSummaryDTO {
  const included = records.filter((record) => record.state === 'active' || record.state === 'trashed');
  const totals = (values: LibraryItemRecord[]) => values.reduce((sum, record) => sum + libraryStorageBytes(record), 0);
  const active = included.filter((record) => record.state === 'active');
  const trashed = included.filter((record) => record.state === 'trashed');
  const group = <K extends string>(key: (record: LibraryItemRecord) => K) =>
    [...new Set(included.map(key))]
      .map((value) => {
        const matching = included.filter((record) => key(record) === value);
        return { value, bytes: totals(matching), count: matching.length };
      })
      .sort((left, right) => right.bytes - left.bytes || left.value.localeCompare(right.value));
  const threadGroups = new Map<string, { threadId: string; title: string; bytes: number; count: number }>();
  for (const record of included) {
    if (!record.source.threadId) continue;
    const current = threadGroups.get(record.source.threadId) ?? {
      threadId: record.source.threadId,
      title: record.source.threadTitleSnapshot ?? 'Untitled chat',
      bytes: 0,
      count: 0,
    };
    current.bytes += libraryStorageBytes(record);
    current.count++;
    threadGroups.set(record.source.threadId, current);
  }
  const hashes = new Map<string, number>();
  for (const record of included) {
    if (record.contentHash) hashes.set(record.contentHash, (hashes.get(record.contentHash) ?? 0) + 1);
  }
  const capacityBytes = totals(included);
  return {
    activeBytes: totals(active),
    trashedBytes: totals(trashed),
    activeCount: active.length,
    trashedCount: trashed.length,
    byKind: group((record) => record.kind).map(({ value, ...rest }) => ({ kind: value, ...rest })),
    byOrigin: group((record) => record.origin).map(({ value, ...rest }) => ({ origin: value, ...rest })),
    largestSourceThreads: [...threadGroups.values()].sort((a, b) => b.bytes - a.bytes || a.threadId.localeCompare(b.threadId)).slice(0, 20),
    duplicateGroups: [...hashes.values()].filter((count) => count > 1).length,
    estimate: {
      monthlyCapacityCost: Number(((capacityBytes / 1024 ** 3) * CAPACITY_RATE_PER_GB_MONTH).toFixed(4)),
      currency: 'USD',
      ratePerGbMonth: CAPACITY_RATE_PER_GB_MONTH,
      region: 'East US 2',
      sku: 'Standard LRS Hot',
      rateAsOf: '2026-07-19',
      exclusions: ['Transactions', 'data transfer', 'operations', 'taxes'],
    },
    ...(reconciledAt ? { reconciledAt } : {}),
  };
}
