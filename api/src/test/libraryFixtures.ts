import type { LibraryItemRecord, LibraryKind, LibraryOrigin, LibraryState } from '../domain/library';

const NOW = '2026-07-19T12:00:00.000Z';

function sourceFor(origin: LibraryOrigin): LibraryItemRecord['source'] {
  if (origin === 'studio_generated_image') return { surface: 'image_studio', createdAt: NOW };
  if (origin === 'library_upload') return { surface: 'library', createdAt: NOW };
  return {
    surface: 'chat',
    threadId: 'thread-1',
    messageId: 'message-1',
    threadTitleSnapshot: 'Fixture thread',
    createdAt: NOW,
  };
}

export function libraryFixture(
  overrides: Partial<LibraryItemRecord> & Pick<LibraryItemRecord, 'id' | 'kind' | 'origin' | 'state'>,
): LibraryItemRecord {
  const { id, kind, origin, state, ...rest } = overrides;
  const hasBlob = state === 'active' || state === 'trashed' || state === 'purging';
  const item: LibraryItemRecord = {
    id,
    userId: 'user-1',
    ingestionKey: `${origin}:${id}`,
    state,
    kind,
    origin,
    name: `${id}.${kind === 'image' ? 'png' : 'dat'}`,
    mime: kind === 'image' ? 'image/png' : 'application/octet-stream',
    bytes: 1024,
    ...(hasBlob ? { blobPath: `user-1/library/${overrides.id}.bin` } : {}),
    createdAt: NOW,
    updatedAt: NOW,
    source: sourceFor(origin),
    ...(kind === 'image' ? { image: { format: 'png', provenanceComplete: false } } : {}),
    ...(state === 'trashed'
      ? { trashedAt: NOW, purgeAfter: '2026-07-26T12:00:00.000Z' }
      : {}),
    ...(state === 'purged' ? { purgedAt: NOW } : {}),
    ...rest,
  };
  return item;
}

export const LIBRARY_KIND_FIXTURES: LibraryItemRecord[] = (
  [
    'image',
    'pdf',
    'document',
    'spreadsheet',
    'presentation',
    'data',
    'audio',
    'archive',
    'code',
    'text',
    'other',
  ] satisfies LibraryKind[]
).map((kind, index) =>
  libraryFixture({
    id: `kind-${index + 1}`,
    kind,
    origin: kind === 'image' ? 'chat_generated_image' : 'code_artifact',
    state: 'active',
    ...(kind === 'image' ? {} : { artifact: { provenanceComplete: false } }),
  }),
);

export const LIBRARY_ORIGIN_FIXTURES: LibraryItemRecord[] = (
  [
    'chat_upload',
    'library_upload',
    'chat_generated_image',
    'studio_generated_image',
    'code_artifact',
    'thread_document',
  ] satisfies LibraryOrigin[]
).map((origin, index) =>
  libraryFixture({
    id: `origin-${index + 1}`,
    kind: origin.includes('image') ? 'image' : 'document',
    origin,
    state: 'active',
  }),
);

export const LIBRARY_STATE_FIXTURES: LibraryItemRecord[] = (
  ['pending', 'active', 'trashed', 'purging', 'purged', 'missing', 'failed'] satisfies LibraryState[]
).map((state, index) =>
  libraryFixture({
    id: `state-${index + 1}`,
    kind: 'image',
    origin: 'library_upload',
    state,
    ...(state === 'failed' ? { error: { code: 'fixture_failure', message: 'Fixture failure.' } } : {}),
  }),
);
