import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  parseCreateMemory,
  parseMemoryImport,
  parseMemoryListQuery,
  parseMemoryContextBlock,
  parseMemoryQueryPreview,
  parseMemoryRecord,
  parseMemoryRebuild,
  parseMemorySummaryRecord,
  parsePatchMemory,
  parsePutMemorySummary,
  isRetrievableMemory,
} from './memory';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

const source = {
  type: 'message' as const,
  threadId: 'thr_1',
  messageId: 'msg_1',
  quote: 'I prefer concise implementation plans.',
  createdAt: '2026-06-28T00:00:00.000Z',
};

const record = {
  id: 'mem_1',
  userId: 'user_1',
  kind: 'preference' as const,
  status: 'active' as const,
  text: 'User prefers concise implementation plans.',
  sourceRefs: [source],
  confidence: 0.92,
  salience: 0.8,
  pinned: false,
  sensitive: false,
  visibility: 'normal' as const,
  createdAt: '2026-06-28T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z',
  useCount: 0,
};

describe('parseMemoryRecord', () => {
  it('accepts a source-linked active memory and trims bounded text fields', () => {
    expect(
      parseMemoryRecord({
        ...record,
        text: '  User prefers concise implementation plans.  ',
        entities: [' Watai '],
        topics: [' implementation '],
      }),
    ).toMatchObject({
      text: 'User prefers concise implementation plans.',
      entities: ['Watai'],
      topics: ['implementation'],
    });
  });

  it('rejects unknown fields, invalid enums, and out-of-range scores', () => {
    expect(code(() => parseMemoryRecord({ ...record, nope: true }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, kind: 'mood' }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, confidence: 1.1 }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, salience: -0.1 }))).toBe('validation');
  });

  it('enforces source reference requirements by source type', () => {
    expect(code(() => parseMemoryRecord({ ...record, sourceRefs: [{ ...source, messageId: undefined }] }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, sourceRefs: [{ type: 'thread', createdAt: source.createdAt }] }))).toBe('validation');
    expect(parseMemoryRecord({ ...record, sourceRefs: [{ type: 'manual', createdAt: source.createdAt }] }).sourceRefs[0]).toEqual({
      type: 'manual',
      createdAt: source.createdAt,
    });
  });

  it('rejects over-bounded collections and text', () => {
    expect(code(() => parseMemoryRecord({ ...record, text: 'a'.repeat(2001) }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, sourceRefs: Array.from({ length: 13 }, () => source) }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, supersedes: Array.from({ length: 17 }, (_, i) => `mem_${i}`) }))).toBe('validation');
    expect(code(() => parseMemoryRecord({ ...record, embedding: Array.from({ length: 4097 }, () => 0.1) }))).toBe('validation');
  });

  it('rejects secret-like memory text and source quotes', () => {
    expect(code(() => parseMemoryRecord({ ...record, text: 'My token is sk-1234567890abcdef' }))).toBe('validation');
    expect(
      code(() =>
        parseMemoryRecord({
          ...record,
          sourceRefs: [{ ...source, quote: 'Use Authorization: Bearer abcdefghijklmnop' }],
        }),
      ),
    ).toBe('validation');
    expect(code(() => parseCreateMemory({ text: 'Remember my password is correct-horse-battery-staple' }))).toBe('validation');
  });
});

describe('memory API request schemas', () => {
  it('validates list query bounds and defaults', () => {
    expect(parseMemoryListQuery({ q: ' typescript ', limit: '10' })).toEqual({ q: 'typescript', limit: 10 });
    expect(code(() => parseMemoryListQuery({ limit: '101' }))).toBe('validation');
    expect(code(() => parseMemoryListQuery({ status: 'gone' }))).toBe('validation');
  });

  it('accepts a manual create request and rejects non-manual kinds', () => {
    expect(parseCreateMemory({ text: '  Remember that I prefer concise plans. ', kind: 'preference' })).toEqual({
      text: 'Remember that I prefer concise plans.',
      kind: 'preference',
    });
    expect(code(() => parseCreateMemory({ text: 'summary', kind: 'thread_summary' }))).toBe('validation');
    expect(code(() => parseCreateMemory({ text: 'entity', kind: 'entity' }))).toBe('validation');
  });

  it('accepts patchable fields but rejects deleted status and unknown fields', () => {
    expect(parsePatchMemory({ status: 'suppressed', visibility: 'background', salience: 0.25 })).toEqual({
      status: 'suppressed',
      visibility: 'background',
      salience: 0.25,
    });
    expect(code(() => parsePatchMemory({ status: 'deleted' }))).toBe('validation');
    expect(code(() => parsePatchMemory({ unknown: true }))).toBe('validation');
  });

  it('validates summary, query preview, import, and rebuild requests', () => {
    expect(parsePutMemorySummary({ text: '  Concise TypeScript work.  ' })).toEqual({ text: 'Concise TypeScript work.' });
    expect(parseMemoryQueryPreview({ threadId: 'thr_1', text: 'deploy target?', includeSuppressed: true, limit: 8 })).toEqual({
      threadId: 'thr_1',
      text: 'deploy target?',
      includeSuppressed: true,
      limit: 8,
    });
    expect(
      parseMemoryImport({
        version: 1,
        mode: 'preview',
        memories: [{ text: 'Use rg-watai-dev for Watai deploys.', kind: 'project_context', sourceRefs: [source], visibility: 'normal', pinned: false }],
      }),
    ).toMatchObject({ version: 1, mode: 'preview' });
    expect(parseMemoryRebuild({ mode: 'commit', includeArchived: true, since: '2026-06-01T00:00:00.000Z' })).toEqual({
      mode: 'commit',
      includeArchived: true,
      since: '2026-06-01T00:00:00.000Z',
    });
    expect(code(() => parseMemoryQueryPreview({ text: 'x', limit: 101 }))).toBe('validation');
    expect(code(() => parseMemoryImport({ version: 1, mode: 'preview', memories: Array.from({ length: 501 }, () => ({ text: 'x', sourceRefs: [source] })) }))).toBe('validation');
  });
});

describe('summary and context schemas', () => {
  it('accepts a memory summary record', () => {
    expect(
      parseMemorySummaryRecord({
        id: 'memory-summary',
        userId: 'user_1',
        kind: 'summary',
        text: 'User prefers concise TypeScript implementation notes.',
        sourceMemoryIds: ['mem_1'],
        updatedAt: '2026-06-28T00:00:00.000Z',
        version: 1,
      }),
    ).toMatchObject({ id: 'memory-summary', kind: 'summary', version: 1 });
  });

  it('accepts a bounded context block and rejects invalid retrieval modes', () => {
    const context = {
      summary: 'User prefers concise implementation plans.',
      instructions: ['Keep examples direct.'],
      memories: [{ id: 'mem_1', kind: 'preference', text: 'User prefers concise implementation plans.', score: 0.92 }],
      threadSummaries: [{ threadId: 'thr_1', title: 'Memory work', summary: 'Memory docs were made implementation-ready.', score: 0.7 }],
      sourceRefs: [{ memoryId: 'mem_1', threadId: 'thr_1', messageId: 'msg_1' }],
      tokenEstimate: 120,
      latencyBudgetMs: 250,
      retrievalMode: 'lexical',
    };
    expect(parseMemoryContextBlock(context)).toMatchObject({ retrievalMode: 'lexical' });
    expect(code(() => parseMemoryContextBlock({ ...context, retrievalMode: 'magic' }))).toBe('validation');
  });
});

describe('isRetrievableMemory', () => {
  it('excludes suppressed, deleted, invalidated, future, and expired memories', () => {
    const now = '2026-06-28T00:00:00.000Z';
    expect(isRetrievableMemory(record, now)).toBe(true);
    expect(isRetrievableMemory({ ...record, status: 'suppressed' }, now)).toBe(false);
    expect(isRetrievableMemory({ ...record, status: 'deleted' }, now)).toBe(false);
    expect(isRetrievableMemory({ ...record, status: 'invalidated' }, now)).toBe(false);
    expect(isRetrievableMemory({ ...record, validAt: '2026-07-01T00:00:00.000Z' }, now)).toBe(false);
    expect(isRetrievableMemory({ ...record, invalidAt: '2026-06-01T00:00:00.000Z' }, now)).toBe(false);
  });
});

describe('memory eval fixtures', () => {
  for (const name of ['preference-recall', 'deletion-suppression', 'temporary-chat-exclusion', 'contradiction-update', 'over-insertion']) {
    it(`keeps ${name} fixture records schema-valid`, () => {
      const fixture = JSON.parse(
        readFileSync(new URL(`../../../documentation/memory-system/fixtures/${name}.json`, import.meta.url), 'utf8'),
      ) as { memories?: unknown[] };
      for (const memory of fixture.memories ?? []) {
        parseMemoryRecord(memory);
      }
    });
  }
});