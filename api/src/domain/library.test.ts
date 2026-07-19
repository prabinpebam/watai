import { describe, expect, it } from 'vitest';
import {
  LIBRARY_KINDS,
  LIBRARY_ORIGINS,
  LIBRARY_STATES,
  assertLibraryTransition,
  canTransitionLibrary,
  libraryStorageBytes,
  libraryIngestionKey,
  libraryItemId,
  libraryItemIdFor,
  parseLibraryLineageQuery,
  parseLibraryBatch,
  parseLibraryImpact,
  parseLibraryItem,
  parseLibraryListQuery,
  parseLibraryPatch,
  parseLibraryUpload,
  parseLibraryUploadComplete,
} from './library';
import {
  LIBRARY_KIND_FIXTURES,
  LIBRARY_ORIGIN_FIXTURES,
  LIBRARY_STATE_FIXTURES,
  libraryFixture,
} from '../test/libraryFixtures';

function errorCode(work: () => unknown): string | undefined {
  try {
    work();
    return undefined;
  } catch (error) {
    return (error as { code?: string }).code;
  }
}

describe('Library domain', () => {
  it('derives stable item ids from the owner and source ingestion key', () => {
    const key = libraryIngestionKey('chat_generated_image', 'img-1');
    expect(key).toBe('chat_generated_image:img-1');
    expect(libraryItemIdFor('user-1', 'chat_generated_image', 'img-1')).toBe(libraryItemId('user-1', key));
    expect(libraryItemId('user-1', key)).toBe('lib-a43fb5ad5d1e33172617758a2563732b');
    expect(libraryItemId('user-2', key)).not.toBe(libraryItemId('user-1', key));
  });
  it('covers every kind, origin, and lifecycle state with valid fixtures', () => {
    expect(LIBRARY_KIND_FIXTURES.map((item) => parseLibraryItem(item).kind)).toEqual(LIBRARY_KINDS);
    expect(LIBRARY_ORIGIN_FIXTURES.map((item) => parseLibraryItem(item).origin)).toEqual(LIBRARY_ORIGINS);
    expect(LIBRARY_STATE_FIXTURES.map((item) => parseLibraryItem(item).state)).toEqual(LIBRARY_STATES);
  });

  it('enforces lifecycle-dependent blob and timestamp invariants', () => {
    expect(errorCode(() => parseLibraryItem({ ...libraryFixture({ id: 'a', kind: 'image', origin: 'library_upload', state: 'active' }), blobPath: undefined }))).toBe('validation');
    expect(errorCode(() => parseLibraryItem({ ...libraryFixture({ id: 'b', kind: 'image', origin: 'library_upload', state: 'purged' }), purgedAt: undefined }))).toBe('validation');
    expect(errorCode(() => parseLibraryItem({ ...libraryFixture({ id: 'c', kind: 'image', origin: 'library_upload', state: 'trashed' }), purgeAfter: undefined }))).toBe('validation');
    expect(errorCode(() => parseLibraryItem({ ...libraryFixture({ id: 'd', kind: 'image', origin: 'library_upload', state: 'failed' }), blobPath: 'should/not/exist.png' }))).toBe('validation');
  });

  it('enforces source surface/origin consistency and unique lineage', () => {
    const chat = libraryFixture({ id: 'chat', kind: 'image', origin: 'chat_generated_image', state: 'active' });
    expect(errorCode(() => parseLibraryItem({ ...chat, source: { surface: 'library', createdAt: chat.createdAt } }))).toBe('validation');
    expect(errorCode(() => parseLibraryItem({ ...chat, image: { provenanceComplete: true, referenceItemIds: ['x', 'x'] } }))).toBe('validation');
  });

  it('allows only specified lifecycle transitions', () => {
    expect(canTransitionLibrary('pending', 'active')).toBe(true);
    expect(canTransitionLibrary('active', 'trashed')).toBe(true);
    expect(canTransitionLibrary('trashed', 'active')).toBe(true);
    expect(canTransitionLibrary('trashed', 'purging')).toBe(true);
    expect(canTransitionLibrary('purging', 'purged')).toBe(true);
    expect(canTransitionLibrary('purged', 'active')).toBe(false);
    expect(() => assertLibraryTransition('active', 'purged')).toThrow(/cannot transition/);
  });

  it('parses list filters, defaults, groups, and bounds', () => {
    expect(parseLibraryListQuery({})).toEqual({ state: 'active', sort: 'newest', limit: 50 });
    expect(parseLibraryListQuery({
      q: '  sprite  ',
      kind: 'image,pdf,image',
      origin: 'generated',
      state: 'trashed',
      starred: 'true',
      minBytes: '10',
      maxBytes: '20',
      limit: '25',
      sort: 'largest',
    })).toEqual({
      q: 'sprite',
      kinds: ['image', 'pdf'],
      originGroup: 'generated',
      state: 'trashed',
      starred: true,
      minBytes: 10,
      maxBytes: 20,
      sort: 'largest',
      limit: 25,
    });
    expect(errorCode(() => parseLibraryListQuery({ kind: 'executable' }))).toBe('validation');
    expect(errorCode(() => parseLibraryListQuery({ minBytes: 20, maxBytes: 10 }))).toBe('validation');
    expect(errorCode(() => parseLibraryListQuery({ limit: 101 }))).toBe('validation');
  });

  it('parses bounded forward and reverse lineage queries', () => {
    expect(parseLibraryLineageQuery({ direction: 'references' })).toEqual({ direction: 'references', limit: 50 });
    expect(parseLibraryLineageQuery({ direction: 'derived', limit: '10', cursor: 'next' })).toEqual({ direction: 'derived', limit: 10, cursor: 'next' });
    expect(() => parseLibraryLineageQuery({ direction: 'sideways' })).toThrow();
    expect(() => parseLibraryLineageQuery({ direction: 'derived', limit: '101' })).toThrow();
  });

  it('parses metadata, impact, and batch mutations strictly', () => {
    expect(parseLibraryPatch({ title: 'New title', starred: true })).toEqual({ title: 'New title', starred: true });
    expect(errorCode(() => parseLibraryPatch({}))).toBe('validation');
    expect(parseLibraryImpact({ itemIds: ['a', 'b'], action: 'trash' })).toEqual({ itemIds: ['a', 'b'], action: 'trash' });
    expect(parseLibraryBatch({ itemIds: ['a'], action: 'restore' })).toEqual({ itemIds: ['a'], action: 'restore' });
    expect(errorCode(() => parseLibraryBatch({ itemIds: ['a', 'a'], action: 'trash' }))).toBe('validation');
  });

  it('enforces direct upload and completion limits', () => {
    const hash = `sha256:${'a'.repeat(64)}`;
    expect(parseLibraryUpload({ name: 'photo.jpg', mime: 'image/jpeg', bytes: 1024, contentHash: hash })).toMatchObject({ name: 'photo.jpg' });
    expect(parseLibraryUploadComplete({ bytes: 1024, contentHash: hash })).toEqual({ bytes: 1024, contentHash: hash });
    expect(errorCode(() => parseLibraryUpload({ name: 'huge.jpg', mime: 'image/jpeg', bytes: 21 * 1024 * 1024, contentHash: hash }))).toBe('validation');
    expect(errorCode(() => parseLibraryUpload({ name: 'unsafe.svg', mime: 'image/svg+xml', bytes: 100, contentHash: hash }))).toBe('validation');
  });

  it('includes derivative bytes in storage accounting', () => {
    expect(libraryStorageBytes({
      bytes: 100,
      derivatives: [{ kind: 'thumbnail', blobPath: 'x', mime: 'image/webp', bytes: 20, width: 100, height: 100 }],
    })).toBe(120);
  });
});
