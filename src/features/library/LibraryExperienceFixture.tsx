import type { LibraryItemDTO, LibraryListQuery, LibraryStorageSummary } from '../../data/cloud/types';
import { AppShell } from '../../app/AppShell';
import { LibraryRuntimeProvider, type LibraryReadApi } from './LibraryApi';
import { formatBytes, itemTitle } from './format';

const CREATED = '2026-07-19T12:00:00.000Z';
const source = {
  surface: 'chat' as const,
  threadId: 'eval-thread',
  messageId: 'eval-message',
  threadTitleSnapshot: 'Launch planning',
  createdAt: CREATED,
};

const ITEMS: LibraryItemDTO[] = [
  {
    id: 'generated-image', state: 'active', kind: 'image', origin: 'chat_generated_image',
    name: 'launch-poster.png', mime: 'image/png', bytes: 284_320, createdAt: CREATED, updatedAt: CREATED,
    source, image: { width: 512, height: 512, size: '512x512', format: 'png', prompt: 'A precise Watai launch poster with crisp cobalt typography', model: 'gpt-image-1', quality: 'high', provenanceComplete: false },
    url: '/apple-touch-icon.png', thumbnailUrl: '/apple-touch-icon.png',
  },
  {
    id: 'uploaded-image', state: 'active', kind: 'image', origin: 'chat_upload',
    name: 'reference.png', mime: 'image/png', bytes: 32_100, createdAt: '2026-07-18T10:00:00.000Z', updatedAt: CREATED,
    source, image: { width: 192, height: 192, format: 'png', provenanceComplete: true },
    url: '/icon-192.png', thumbnailUrl: '/icon-192.png',
  },
  {
    id: 'brief-pdf', state: 'active', kind: 'pdf', origin: 'thread_document',
    name: 'launch-brief.pdf', mime: 'application/pdf', bytes: 81_920, createdAt: '2026-07-17T09:00:00.000Z', updatedAt: CREATED,
    source, url: 'data:application/pdf;base64,JVBERi0xLjQKJSVFT0YK',
  },
  {
    id: 'notes-md', state: 'active', kind: 'text', origin: 'chat_upload',
    name: 'release-notes.md', mime: 'text/markdown', bytes: 920, createdAt: '2026-07-16T09:00:00.000Z', updatedAt: CREATED,
    source, url: 'data:text/markdown;charset=utf-8,%23%20Release%20notes%0A%0A-%20Library%20browse%0A-%20Type-aware%20preview',
  },
  {
    id: 'script-ts', state: 'active', kind: 'code', origin: 'code_artifact',
    name: 'report.ts', mime: 'text/typescript', bytes: 360, createdAt: '2026-07-15T09:00:00.000Z', updatedAt: CREATED,
    source, artifact: { version: 1, provenanceComplete: true }, url: 'data:text/plain;charset=utf-8,export%20const%20status%20%3D%20%22ready%22%3B',
  },
  {
    id: 'metrics-csv', state: 'active', kind: 'data', origin: 'code_artifact',
    name: 'metrics.csv', mime: 'text/csv', bytes: 480, createdAt: '2026-07-14T09:00:00.000Z', updatedAt: CREATED,
    source, artifact: { sourceItemIds: ['brief-pdf'], version: 1, provenanceComplete: true }, url: 'data:text/csv;charset=utf-8,Metric%2CValue%0AItems%2C388%0AStorage%2C565.9%20MiB',
  },
  {
    id: 'deck-pptx', state: 'active', kind: 'presentation', origin: 'code_artifact',
    name: 'launch-deck.pptx', mime: 'application/vnd.openxmlformats-officedocument.presentationml.presentation', bytes: 1_904_640, createdAt: '2026-07-13T09:00:00.000Z', updatedAt: CREATED,
    source, artifact: { provenanceComplete: false }, url: 'data:application/octet-stream;base64,AA==',
  },
  {
    id: 'archive-zip', state: 'active', kind: 'archive', origin: 'chat_upload',
    name: 'assets.zip', mime: 'application/zip', bytes: 3_145_728, createdAt: '2026-07-12T09:00:00.000Z', updatedAt: CREATED,
    source, url: 'data:application/zip;base64,UEs=',
  },
];

const consumedErrors = new Set<string>();

function fixtureMode(): string | null {
  return new URLSearchParams(window.location.hash.split('?')[1] ?? '').get('fixture');
}

function matches(item: LibraryItemDTO, query: LibraryListQuery): boolean {
  if (query.kind && !query.kind.includes(item.kind)) return false;
  if (query.origin === 'uploaded' && !['chat_upload', 'library_upload', 'thread_document'].includes(item.origin)) return false;
  if (query.origin === 'generated' && !['chat_generated_image', 'studio_generated_image', 'code_artifact'].includes(item.origin)) return false;
  if (query.q) {
    const haystack = `${itemTitle(item)} ${item.name} ${item.source.threadTitleSnapshot ?? ''}`.toLowerCase();
    if (!haystack.includes(query.q.toLowerCase())) return false;
  }
  return true;
}

const fixtureApi: LibraryReadApi = {
  async listLibrary(query = {}) {
    await new Promise((resolve) => window.setTimeout(resolve, 80));
    const mode = fixtureMode();
    if (mode === 'error') throw new Error('Fixture unavailable');
    if (mode?.startsWith('error-once') && !consumedErrors.has(mode)) {
      consumedErrors.add(mode);
      throw new Error('Fixture unavailable once');
    }
    if (mode === 'empty') return { items: [], totalApprox: 0 };
    const items = ITEMS.filter((item) => matches(item, query));
    items.sort((left, right) => {
      if (query.sort === 'oldest') return left.createdAt.localeCompare(right.createdAt);
      if (query.sort === 'largest') return right.bytes - left.bytes;
      if (query.sort === 'name') return itemTitle(left).localeCompare(itemTitle(right));
      return right.createdAt.localeCompare(left.createdAt);
    });
    return { items, totalApprox: items.length };
  },
  async getLibraryItem(id) {
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const item = ITEMS.find((candidate) => candidate.id === id);
    if (!item) throw new Error('Not found');
    return item;
  },
  async getLibraryStorage(): Promise<LibraryStorageSummary> {
    const activeBytes = ITEMS.reduce((sum, item) => sum + item.bytes, 0);
    return {
      activeBytes,
      trashedBytes: 0,
      activeCount: ITEMS.length,
      trashedCount: 0,
      byKind: [],
      byOrigin: [],
      largestSourceThreads: [{ threadId: 'eval-thread', title: 'Launch planning', bytes: activeBytes, count: ITEMS.length }],
      duplicateGroups: 0,
      estimate: { monthlyCapacityCost: 0.0002, currency: 'USD', ratePerGbMonth: 0.0184, region: 'East US 2', sku: 'Standard LRS Hot', rateAsOf: '2026-07-19', exclusions: ['Transactions'] },
    };
  },
  async getLibraryLineage(id, direction) {
    const sourceItem = ITEMS.find((item) => item.id === id);
    if (!sourceItem) return { items: [] };
    if (direction === 'references') {
      const ids = sourceItem.image?.referenceItemIds ?? sourceItem.artifact?.sourceItemIds ?? [];
      return { items: ids.map((itemId) => ITEMS.find((item) => item.id === itemId)).filter((item): item is LibraryItemDTO => !!item) };
    }
    return {
      items: ITEMS.filter((item) => item.image?.referenceItemIds?.includes(id) || item.artifact?.sourceItemIds?.includes(id)),
    };
  },
};

export function LibraryExperienceFixture() {
  return (
    <LibraryRuntimeProvider api={fixtureApi} basePath="/dev/library-eval" createImagePath="/dev/library-eval?kind=image">
      <AppShell libraryPath="/dev/library-eval" />
      <output className="sr-only" data-testid="fixture-summary">{ITEMS.length} items · {formatBytes(ITEMS.reduce((sum, item) => sum + item.bytes, 0))}</output>
    </LibraryRuntimeProvider>
  );
}
