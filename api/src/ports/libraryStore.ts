import type { LibraryItemRecord, LibraryListQuery } from '../domain/library';

export interface LibraryListResult {
  items: LibraryItemRecord[];
  cursor?: string;
  totalApprox?: number;
}

export interface LibraryStorageAggregate {
  records: LibraryItemRecord[];
  reconciledAt?: string;
}

export interface LibraryStore {
  get(userId: string, id: string): Promise<LibraryItemRecord | null>;
  getByIngestionKey(userId: string, ingestionKey: string): Promise<LibraryItemRecord | null>;
  put(record: LibraryItemRecord, etag?: string): Promise<LibraryItemRecord>;
  list(userId: string, query: LibraryListQuery): Promise<LibraryListResult>;
  aggregate(userId: string): Promise<LibraryStorageAggregate>;
}
