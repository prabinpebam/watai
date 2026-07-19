import type { LibraryItemRecord } from '../domain/library';
import type { SasMinter } from '../ports/sasMinter';

const READ_TTL_SECONDS = 3600;

export type LibraryItemDTO = Omit<LibraryItemRecord, 'userId' | 'ingestionKey'> & {
  url?: string;
  thumbnailUrl?: string;
};

/** Safe client projection. Internal ownership/idempotency fields and unusable blob paths never leave the API. */
export async function toLibraryItemDto(minter: SasMinter, record: LibraryItemRecord): Promise<LibraryItemDTO> {
  const { userId: _userId, ingestionKey: _ingestionKey, ...safe } = record;
  const dto: LibraryItemDTO = { ...safe };
  const readable = record.state === 'active' || record.state === 'trashed';
  if (!readable || !record.blobPath) {
    delete dto.blobPath;
    return dto;
  }
  try {
    const [{ url }, thumbnail] = await Promise.all([
      minter.mint({
        blobPath: record.blobPath,
        op: 'read',
        contentType: record.mime,
        ttlSeconds: READ_TTL_SECONDS,
      }),
      record.derivatives?.find((derivative) => derivative.kind === 'thumbnail')
        ? minter
            .mint({
              blobPath: record.derivatives.find((derivative) => derivative.kind === 'thumbnail')!.blobPath,
              op: 'read',
              ttlSeconds: READ_TTL_SECONDS,
            })
            .catch(() => null)
        : Promise.resolve(null),
    ]);
    return {
      ...dto,
      url,
      ...(thumbnail?.url ? { thumbnailUrl: thumbnail.url } : {}),
    };
  } catch {
    return dto;
  }
}

export interface LibraryStorageSummaryDTO {
  activeBytes: number;
  trashedBytes: number;
  activeCount: number;
  trashedCount: number;
  byKind: Array<{ kind: LibraryItemRecord['kind']; bytes: number; count: number }>;
  byOrigin: Array<{ origin: LibraryItemRecord['origin']; bytes: number; count: number }>;
  largestSourceThreads: Array<{ threadId: string; title: string; bytes: number; count: number }>;
  duplicateGroups: number;
  estimate?: {
    monthlyCapacityCost: number;
    currency: string;
    ratePerGbMonth: number;
    region: string;
    sku: string;
    rateAsOf: string;
    exclusions: string[];
  };
  reconciledAt?: string;
}
