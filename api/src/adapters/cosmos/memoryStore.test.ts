import { describe, expect, it, vi } from 'vitest';
import { CosmosMemoryStore } from './memoryStore';
import { InMemoryMemoryStore } from '../memory/memoryStore';
import type { MemoryRecord } from '../../domain/memory';
import { archivedMemoryExclusion } from '../../ports/memoryStore';
import { MemoryService } from '../../application/memoryService';
import { memoryIndexJob } from '../../domain/memoryIndex';

describe('CosmosMemoryStore', () => {
  it('keeps valid adjacent index jobs without logging or mutating malformed payloads', async () => {
    const memory = await new MemoryService(new InMemoryMemoryStore(), { now: () => '2026-01-01T00:00:00.000Z', newId: () => 'saved' })
      .createManual('owner', { text: 'Saved' });
    const job = memoryIndexJob(memory, 'model');
    const malformed = { ...job, id: 'malformed', model: '', unexpected: 'Private payload must not be logged' };
    const fetchNext = vi.fn(async () => ({ resources: [malformed, { ...job, _etag: 'version' }, { ...job, id: 'outside-limit' }], continuationToken: 'later' }));
    const query = vi.fn(() => ({ fetchNext }));
    const item = vi.fn();
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const store = new CosmosMemoryStore({ items: { query }, item } as never);
      expect(await store.listIndexJobs(memory.updatedAt, 2)).toEqual([job]);
      expect(query).toHaveBeenCalledOnce();
      expect(fetchNext).toHaveBeenCalledOnce();
      expect(item).not.toHaveBeenCalled();
      expect(warning).toHaveBeenCalledExactlyOnceWith('[memory-index] Invalid job records omitted from page.', { count: 1 });
      expect(malformed.model).toBe('');
    } finally { warning.mockRestore(); }
  });

  it('selects the earliest-due index jobs before limiting and respects requeue availability', async () => {
    const store = new InMemoryMemoryStore();
    for (const [id, updatedAt] of [
      ['newer', '2026-01-01T00:01:00Z'], ['older', '2026-01-01T00:00:00Z'],
      ['future', '2026-01-01T00:03:00Z'], ['boundary', '2026-01-01T00:02:00Z'],
    ]) {
      await new MemoryService(store, { now: () => updatedAt, newId: () => id }, { store, model: 'stub' })
        .createManual('owner', { text: `Saved ${id}.` });
    }
    const now = '2026-01-01T00:02:00Z';
    expect((await store.listIndexJobs(now, 2)).map(job => job.memoryId)).toEqual(['older', 'newer']);
    expect((await store.listIndexJobs(now, 10)).map(job => job.memoryId)).toEqual(['older', 'newer', 'boundary']);
    const older = (await store.listIndexJobs(now, 1))[0];
    const claimed = await store.claimIndexJob('owner', older.id, now, 'attempt');
    expect(claimed).not.toBeNull();
    expect(await store.finishIndexJob(claimed!, 'queued', now)).toBe(true);
    expect((await store.listIndexJobs(now, 10)).map(job => job.memoryId)).toEqual(['newer', 'boundary']);
    expect((await store.listIndexJobs('2026-01-01T00:02:30Z', 10)).map(job => job.memoryId)).toEqual(['newer', 'boundary', 'older']);
  });

  it('orders due index jobs in one bounded Cosmos page without draining continuation', async () => {
    const fetchNext = vi.fn(async () => ({ resources: [], continuationToken: 'more' }));
    const fetchAll = vi.fn();
    const query = vi.fn(() => ({ fetchNext, fetchAll }));
    const store = new CosmosMemoryStore({ items: { query } } as never);
    const now = '2026-01-01T00:02:00Z';
    expect(await store.listIndexJobs(now, 3)).toEqual([]);
    const [statement, options] = query.mock.calls[0] as unknown as [{ query: string; parameters: unknown[] }, unknown];
    expect(statement.query).toContain('SELECT TOP @limit');
    expect(statement.query).toContain('c.availableAt <= @now ORDER BY c.availableAt ASC');
    expect(statement.parameters).toContainEqual({ name: '@limit', value: 3 });
    expect(statement.parameters).toContainEqual({ name: '@now', value: now });
    expect(options).toEqual({ maxItemCount: 3 });
    expect(fetchNext).toHaveBeenCalledOnce();
    expect(fetchAll).not.toHaveBeenCalled();
  });

  it('matches ID exclusions within one owner while preserving hash-only callers', async () => {
    const store = new InMemoryMemoryStore();
    const record = { id: 'same', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    await store.put(record);
    await store.exclude(record, { id: 'memory-exclusion-same', memoryId: 'same', userId: 'owner',
      sourceHash: 'old-hash', sourceKeys: [], excludedAt: '2026' }, 1);
    expect(await store.isExcluded('owner', undefined, [], 'same')).toBe(true);
    expect(await store.isExcluded('owner', 'changed-hash', [], 'same')).toBe(true);
    expect(await store.isExcluded('other-owner', undefined, [], 'same')).toBe(false);
    expect(await store.isExcluded('owner', undefined, [], 'other-memory')).toBe(false);
    expect(await store.isExcluded('owner', 'old-hash', [])).toBe(true);
    expect(await store.isExcluded('owner', 'changed-hash', [])).toBe(false);
  });

  it('adds ID exclusion to the existing parameterized owner query without another read', async () => {
    const query = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [{ id: 'receipt' }] }) });
    const store = new CosmosMemoryStore({ items: { query } } as never);
    expect(await store.isExcluded('owner', undefined, [], 'same')).toBe(true);
    expect(query).toHaveBeenCalledOnce();
    const [statement, options] = query.mock.calls[0];
    expect(statement.query).toContain('c.userId = @userId AND c.recordType = @recordType');
    expect(statement.query).toContain('c.memoryId = @memoryId');
    expect(statement.parameters).toContainEqual({ name: '@memoryId', value: 'same' });
    expect(statement.parameters).toContainEqual({ name: '@recordType', value: 'memory-exclusion' });
    expect(options).toEqual({ partitionKey: 'owner' });
  });

  it('filters pinned candidates before pagination in the owner partition', async () => {
    const query = vi.fn().mockReturnValue({ fetchNext: async () => ({ resources: [], continuationToken: 'more-pins' }) });
    const store = new CosmosMemoryStore({ items: { query } } as never);
    expect(await store.list('owner', { pinned: true, status: 'active', limit: 16, confirmations: ['approved'], excludeKinds: ['project_context'] }))
      .toEqual({ memories: [], cursor: 'more-pins' });
    const [statement, options] = query.mock.calls[0];
    expect(statement.query).toContain('c.userId = @userId');
    expect(statement.query).toContain('c.pinned = @pinned');
    expect(statement.query).toContain('ORDER BY c.updatedAt DESC');
    expect(statement.parameters).toContainEqual({ name: '@pinned', value: true });
    expect(options).toMatchObject({ partitionKey: 'owner', maxItemCount: 16 });
    await store.list('owner');
    expect(query.mock.calls[1][0].query).not.toContain('c.pinned = @pinned');
  });

  it.each(['userB', undefined])('never returns a partial inventory page with a wrong owner: %s', async userId => {
    const container = { items: { query: () => ({ fetchNext: async () => ({ resources: [
      { id: 'own', userId: 'userA', status: 'active' }, { id: 'wrong', userId, status: 'active' },
    ], continuationToken: 'next' }) }) } };
    await expect(new CosmosMemoryStore(container as never).list('userA')).rejects.toThrow('Memory page owner binding failed.');
  });

  it.each(['valid', 'foreign', 'missing-owner', 'wrong-id', 'wrong-kind'] as const)('binds summary point reads to owner and record identity: %s', async state => {
    const summary = { id: state === 'wrong-id' ? 'other' : 'memory-summary',
      userId: state === 'missing-owner' ? undefined : state === 'foreign' ? 'userB' : 'userA',
      kind: state === 'wrong-kind' ? 'fact' : 'summary', text: 'Summary', _etag: 'etag' };
    const item = vi.fn(() => ({ read: async () => ({ resource: summary }) }));
    const result = await new CosmosMemoryStore({ item } as never).getSummary('userA');
    if (state === 'valid') { expect(result?.text).toBe('Summary'); expect(result).not.toHaveProperty('_etag'); }
    else expect(result).toBeNull();
    expect(item).toHaveBeenCalledWith('memory-summary', 'userA');
  });

  it.each(['foreign-owner', 'different-id', 'missing-owner'] as const)('rejects wrongly bound point-read memory records: %s', async state => {
    const record = { id: state === 'different-id' ? 'other' : 'm1',
      userId: state === 'missing-owner' ? undefined : state === 'foreign-owner' ? 'userB' : 'userA',
      status: 'active', revision: 1, _etag: 'etag', text: 'Untrusted record' };
    const replace = vi.fn().mockResolvedValue({ resource: { ...record, text: 'Changed' } });
    const item = vi.fn(() => ({ read: async () => ({ resource: record }), replace }));
    const store = new CosmosMemoryStore({ item } as never);
    expect(await store.get('userA', 'm1')).toBeNull();
    expect(await store.putIfRevision({ id: 'm1', userId: 'userA', status: 'active', revision: 2 } as MemoryRecord, 1)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
    expect(item).toHaveBeenCalledWith('m1', 'userA');
  });

  it.each(['sources', 'timestamp'] as const)('rejects exclusion repairs that discard earlier %s at the store boundary', async field => {
    const original = { id: 'm1', userId: 'owner', status: 'deleted', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const previous = { id: 'memory-exclusion-m1', userId: 'owner', memoryId: 'm1', sourceHash: 'known-hash', sourceKeys: ['old-source'], excludedAt: '2026' };
    const next = { ...previous, sourceKeys: field === 'sources' ? [] : previous.sourceKeys, excludedAt: field === 'timestamp' ? '2027' : previous.excludedAt };
    const memory = new InMemoryMemoryStore();
    await memory.put(original);
    await memory.exclude(original, previous, 1);
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 200 }, { statusCode: 200 }] });
    const cosmos = new CosmosMemoryStore({ item: (id: string) => ({ read: async () => ({ resource: id === original.id ?
      { ...original, _etag: 'memory-etag' } : { ...previous, recordType: 'memory-exclusion', _etag: 'receipt-etag' } }) }), items: { batch } } as never);
    for (const store of [memory, cosmos]) expect(await store.exclude({ ...original, revision: 2 }, next, 1, previous)).toBe(false);
    expect(await memory.getExclusion('owner', 'm1')).toEqual(previous);
    expect(await memory.get('owner', 'm1')).toEqual(original);
    expect(batch).not.toHaveBeenCalled();
  });

  it.each(['create', 'reuse', 'stale-primary', 'foreign-primary', 'no-etag', 'foreign-archive', 'wrong-hash', 'wrong-kind', 'malformed-archive', 'partial', 'conflict', 'unavailable'] as const)('preserves exclusion hashes through guarded archive publication: %s', async state => {
    const original = { id: 'm1', userId: 'owner', status: 'deleted', revision: 2, sourceRefs: [] } as unknown as MemoryRecord;
    const previous = { id: 'memory-exclusion-m1', userId: 'owner', memoryId: 'm1', sourceHash: 'a'.repeat(64), sourceKeys: ['old-source'], excludedAt: '2026' };
    const next = { ...previous, sourceHash: 'b'.repeat(64), sourceKeys: ['old-source', 'new-source'] };
    const archive = archivedMemoryExclusion(previous)!;
    const item = vi.fn((id: string) => ({ read: async () => ({ resource:
      id === original.id ? { ...original, _etag: 'memory-etag' } :
      id === previous.id ? { ...previous, recordType: 'memory-exclusion',
        sourceKeys: state === 'stale-primary' ? ['concurrent-source'] : previous.sourceKeys,
        userId: state === 'foreign-primary' ? 'foreign' : 'owner', _etag: state === 'no-etag' ? undefined : 'receipt-etag' } :
      ['create', 'partial', 'conflict', 'unavailable'].includes(state) ? undefined : {
        ...archive, recordType: state === 'wrong-kind' ? 'other' : 'memory-exclusion',
        userId: state === 'foreign-archive' ? 'foreign' : 'owner',
        sourceHash: state === 'wrong-hash' ? 'different' : archive.sourceHash,
        sourceKeys: state === 'malformed-archive' ? 'invalid' : ['earlier-source', ...archive.sourceKeys],
      },
    }) }));
    const batch = vi.fn(async (operations: Array<{ operationType: string; resourceBody: unknown }>) => {
      if (state === 'unavailable') throw new Error('Batch outcome unavailable');
      return { result: state === 'partial' ? [{ statusCode: 200 }, { statusCode: 200 }] :
        state === 'conflict' ? [{ statusCode: 424 }, { statusCode: 424 }, { statusCode: 409 }] : operations.map(() => ({ statusCode: 200 })) };
    });
    const store = new CosmosMemoryStore({ item, items: { batch } } as never);
    const publication = store.exclude({ ...original, revision: 3 }, next, 2, previous);
    if (state === 'partial' || state === 'unavailable') await expect(publication).rejects.toThrow();
    else expect(await publication).toBe(state === 'create' || state === 'reuse');
    expect(item.mock.calls.length).toBeLessThanOrEqual(3);
    if (state === 'create' || state === 'reuse') {
      const [operations, owner] = batch.mock.calls[0] as unknown as [Array<Record<string, unknown>>, string];
      expect(owner).toBe('owner');
      expect(operations.slice(0, 2)).toMatchObject([
        { operationType: 'Replace', id: 'm1', ifMatch: 'memory-etag' },
        { operationType: 'Replace', id: previous.id, ifMatch: 'receipt-etag' },
      ]);
      expect(operations).toHaveLength(state === 'create' ? 3 : 2);
      if (state === 'create') expect(operations[2]).toEqual({ operationType: 'Create', resourceBody: { ...archive, recordType: 'memory-exclusion' } });
    } else if (!['partial', 'conflict', 'unavailable'].includes(state)) expect(batch).not.toHaveBeenCalled();
  });

  it.each(['foreign', 'self', 'duplicate', 'over-limit', 'binding', 'approved', 'sensitive', 'deleted', 'stale', 'missing', 'existing-candidate'])('rejects invalid predecessor publication without partial writes: %s', async condition => {
    const previous = { id: 'old', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    let predecessors = [previous];
    const next = { ...previous, id: 'new', supersedes: ['old'] };
    if (condition === 'foreign') predecessors = [{ ...previous, userId: 'foreign' }];
    if (condition === 'self') { predecessors = [{ ...previous, id: 'new' }]; next.supersedes = ['new']; }
    if (condition === 'duplicate') { predecessors = [previous, previous]; next.supersedes = ['old', 'old']; }
    if (condition === 'over-limit') { predecessors = Array.from({ length: 17 }, (_, index) => ({ ...previous, id: `old-${index}` })); next.supersedes = predecessors.map(memory => memory.id); }
    if (condition === 'binding') next.supersedes = ['not-the-predecessor'];
    if (condition === 'approved') predecessors = [{ ...previous, confirmation: 'approved' }];
    if (condition === 'sensitive') predecessors = [{ ...previous, sensitive: true }];
    if (condition === 'deleted') predecessors = [{ ...previous, status: 'deleted' }];
    const current = { ...previous, revision: condition === 'stale' ? 2 : 1 };
    const memory = new InMemoryMemoryStore();
    if (condition !== 'missing') await memory.put(current);
    if (condition === 'existing-candidate') await memory.put(next);
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 409 }, { statusCode: 424 }] });
    const create = vi.fn();
    const cosmos = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: condition === 'missing' ? undefined : { ...current, _etag: 'etag' } }) }), items: { batch, create } } as never);
    for (const store of [memory, cosmos]) expect(await store.createIfAbsent(next, predecessors)).toBeNull();
    expect(await memory.get('owner', 'old')).toEqual(condition === 'missing' ? null : current);
    expect(await memory.get('owner', 'new')).toEqual(condition === 'existing-candidate' ? next : null);
    expect(create).not.toHaveBeenCalled();
    expect(batch).toHaveBeenCalledTimes(condition === 'existing-candidate' ? 1 : 0);
  });

  it.each([undefined, [], [201], [201, 500], [201, 200, 200], [409, 424], [424, 412], [424, 404]].map(statuses => ({ statuses })))('requires complete atomic replacement receipts: %j', async ({ statuses }) => {
    const previous = { id: 'old', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const next = { ...previous, id: 'new', supersedes: ['old'] };
    const batch = vi.fn().mockResolvedValue({ result: statuses?.map(statusCode => ({ statusCode })) });
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...previous, _etag: 'etag' } }) }), items: { batch } } as never);
    if (statuses?.some(status => [404, 409, 412].includes(status))) expect(await store.createIfAbsent(next, [previous])).toBeNull();
    else await expect(store.createIfAbsent(next, [previous])).rejects.toThrow('Memory replacement publication was not confirmed.');
    expect(batch).toHaveBeenCalledOnce();
  });

  it('rejects predecessor publication without an ETag', async () => {
    const previous = { id: 'old', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const batch = vi.fn();
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: previous }) }), items: { batch } } as never);
    expect(await store.createIfAbsent({ ...previous, id: 'new', supersedes: ['old'] }, [previous])).toBeNull();
    expect(batch).not.toHaveBeenCalled();
  });

  it.each([false, true])('atomically publishes replacements only for unchanged predecessors (changed=%s)', async changed => {
    const store = new InMemoryMemoryStore();
    const previous = { id: 'old', userId: 'owner', kind: 'fact', status: 'active', revision: 1,
      text: 'Prior fact', sourceRefs: [{ type: 'manual', createdAt: '2026' }], confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, confirmation: 'automatic', visibility: 'normal', useCount: 0,
      createdAt: '2026', updatedAt: '2026' } as MemoryRecord;
    const next = { ...previous, id: 'new', text: 'Replacement', supersedes: ['old'], updatedAt: '2027' };
    await store.put(previous);
    if (changed) await store.put({ ...previous, text: 'Concurrent correction', revision: 2 });
    const result = await store.createIfAbsent(next, [previous]);
    if (changed) {
      expect(result).toBeNull();
      expect(await store.get('owner', 'new')).toBeNull();
      expect(await store.get('owner', 'old')).toMatchObject({ text: 'Concurrent correction', status: 'active', revision: 2 });
    } else {
      expect(result).toEqual(next);
      expect(await store.get('owner', 'old')).toMatchObject({ status: 'invalidated', revision: 2, supersededBy: 'new' });
    }
  });

  it('publishes a candidate and predecessor invalidation in one ETag-bound owner batch', async () => {
    const previous = { id: 'old', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const next = { ...previous, id: 'new', supersedes: ['old'], createdAt: '2026', updatedAt: '2026' };
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 201 }, { statusCode: 200 }] });
    const create = vi.fn().mockResolvedValue({ resource: next });
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...previous, _etag: 'old-etag' } }) }), items: { batch, create } } as never);
    expect(await store.createIfAbsent(next, [previous])).toEqual(next);
    expect(create).not.toHaveBeenCalled();
    expect(batch.mock.calls).toEqual([[ [
      { operationType: 'Create', resourceBody: next },
      { operationType: 'Replace', id: 'old', ifMatch: 'old-etag', resourceBody: expect.objectContaining({ id: 'old', status: 'invalidated', revision: 2, supersededBy: 'new' }) },
    ], 'owner' ]]);
  });

  it('applies context confirmation and scope filters inside the paginated query', async () => {
    const query = vi.fn().mockReturnValue({ fetchNext: async () => ({ resources: [] }) });
    const store = new CosmosMemoryStore({ items: { query } } as never);
    const options = { status: 'active' as const, limit: 200, confirmations: ['approved' as const], excludeKinds: ['project_context' as const] };
    await store.list('owner', options);
    const [spec, paging] = query.mock.calls[0];
    expect(spec.query).toContain('ARRAY_CONTAINS(@confirmations, c.confirmation)');
    expect(spec.query).toContain('NOT ARRAY_CONTAINS(@excludeKinds, c.kind)');
    expect(spec.parameters).toContainEqual({ name: '@confirmations', value: ['approved'] });
    expect(spec.parameters).toContainEqual({ name: '@excludeKinds', value: ['project_context'] });
    expect(paging).toMatchObject({ partitionKey: 'owner', maxItemCount: 200 });
  });

  it('creates inferred identities without upsert fallback and reports conflicts without overwriting', async () => {
    const record = { id: 'm1', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const create = vi.fn().mockResolvedValue({ resource: { ...record, _etag: 'created-etag' } });
    const upsert = vi.fn();
    const store = new CosmosMemoryStore({ items: { create, upsert } } as never);
    expect(await store.createIfAbsent(record)).toEqual(record);
    create.mockRejectedValue({ code: 409 });
    expect(await store.createIfAbsent(record)).toBeNull();
    create.mockRejectedValue({ code: 500 });
    await expect(store.createIfAbsent(record)).rejects.toMatchObject({ code: 500 });
    expect(upsert).not.toHaveBeenCalled();
    const inMemory = new InMemoryMemoryStore();
    const results = await Promise.all([inMemory.createIfAbsent(record), inMemory.createIfAbsent(record)]);
    expect(results.filter(Boolean)).toHaveLength(1);
    await inMemory.put({ ...record, status: 'deleted' });
    expect(await inMemory.createIfAbsent(record)).toBeNull();
    expect(await inMemory.get('owner', 'm1')).toMatchObject({ status: 'deleted' });
  });

  it('does not query generic unidentified source keys while retaining exact-hash checks', async () => {
    const query = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [] }) });
    const store = new CosmosMemoryStore({ items: { query } } as never);
    const refs: MemoryRecord['sourceRefs'] = [{ type: 'manual', createdAt: '2026' }];
    expect(await store.isExcluded('owner', undefined, refs)).toBe(false);
    expect(query).not.toHaveBeenCalled();
    expect(await store.isExcluded('owner', 'content-hash', refs)).toBe(false);
    expect(query.mock.calls[0][0].query).not.toContain('ARRAY_CONTAINS');
    expect(query.mock.calls[0][0].parameters).toContainEqual({ name: '@sourceHash', value: 'content-hash' });
  });

  it.each(['stale', 'missing', 'deleted', 'no-etag', 'foreign-owner'] as const)('rejects invalid exclusion snapshots or tombstone resurrection: %s', async condition => {
    const original = { id: 'm1', userId: 'owner', status: 'active', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const current = condition === 'missing' ? undefined : {
      ...original, revision: condition === 'stale' ? 2 : 1,
      status: condition === 'deleted' ? 'deleted' : 'active',
      userId: condition === 'foreign-owner' ? 'different-owner' : 'owner',
      _etag: condition === 'no-etag' ? undefined : 'etag',
    };
    const batch = vi.fn();
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: current }) }), items: { batch } } as never);
    expect(await store.exclude({ ...original, status: condition === 'deleted' ? 'active' : 'deleted', revision: 2 }, {
      id: 'exclusion', userId: 'owner', memoryId: 'm1', sourceKeys: [], excludedAt: '2026',
    }, 1)).toBe(false);
    expect(batch).not.toHaveBeenCalled();
  });

  it('repairs a deleted tombstone and its exclusion in one conditional batch', async () => {
    const original = { id: 'm1', userId: 'owner', status: 'deleted', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 200 }, { statusCode: 200 }] });
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...original, _etag: 'deleted-etag' } }) }), items: { batch } } as never);
    const exclusion = { id: 'memory-exclusion-m1', userId: 'owner', memoryId: 'm1', sourceHash: 'known-hash', sourceKeys: [], excludedAt: '2026' };
    expect(await store.exclude({ ...original, revision: 2 }, exclusion, 1)).toBe(true);
    expect(batch.mock.calls).toEqual([[ [
      { operationType: 'Replace', id: 'm1', resourceBody: { ...original, revision: 2 }, ifMatch: 'deleted-etag' },
      { operationType: 'Create', resourceBody: { ...exclusion, recordType: 'memory-exclusion' } },
    ], 'owner' ]]);
  });

  it.each(['valid', 'missing', 'foreign', 'wrong-memory', 'wrong-kind'] as const)('reads only owner-bound exclusion receipts: %s', async state => {
    const resource = { id: 'memory-exclusion-m1', userId: state === 'foreign' ? 'foreign' : 'owner',
      memoryId: state === 'wrong-memory' ? 'different' : 'm1', sourceHash: 'known-hash', sourceKeys: [],
      excludedAt: '2026', recordType: state === 'wrong-kind' ? 'other' : 'memory-exclusion', _etag: 'etag' };
    const item = vi.fn(() => ({ read: async () => ({ resource: state === 'missing' ? undefined : resource }) }));
    const store = new CosmosMemoryStore({ item } as never);
    const receipt = await store.getExclusion('owner', 'm1');
    if (state === 'valid') { expect(receipt?.sourceHash).toBe('known-hash'); expect(receipt).not.toHaveProperty('_etag'); }
    else expect(receipt).toBeNull();
    expect(item).toHaveBeenCalledWith('memory-exclusion-m1', 'owner');
  });

  it.each([404, 409, 412])('treats exclusion precondition status %s as an unconfirmed conflict', async statusCode => {
    const record = { id: 'm1', userId: 'owner', status: 'deleted', revision: 2 } as MemoryRecord;
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode }, { statusCode: 424 }] });
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...record, status: 'active', revision: 1, _etag: 'etag' } }) }), items: { batch } } as never);
    const exclusion = { id: 'exclusion', userId: 'owner', memoryId: 'm1', sourceKeys: [], excludedAt: '2026' };
    expect(await store.exclude(record, exclusion, 1)).toBe(false);
    batch.mockRejectedValue({ code: statusCode });
    expect(await store.exclude(record, exclusion, 1)).toBe(false);
  });

  it.each([[], [200], [200, 500], [200, 200, 200], undefined].map(statuses => ({ statuses })))('requires exactly two successful exclusion results: %j', async ({ statuses }) => {
    const record = { id: 'm1', userId: 'owner', status: 'deleted', revision: 2 } as MemoryRecord;
    const batch = vi.fn().mockResolvedValue({ result: statuses?.map(statusCode => ({ statusCode })) });
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...record, status: 'active', revision: 1, _etag: 'etag' } }) }), items: { batch } } as never);
    await expect(store.exclude(record, { id: 'exclusion', userId: 'owner', memoryId: 'm1', sourceKeys: [], excludedAt: '2026' }, 1)).rejects.toThrow('Memory exclusion batch failed.');
  });

  it('rejects stale in-memory exclusions without changing the record or ledger', async () => {
    const store = new InMemoryMemoryStore();
    const current = { id: 'm1', userId: 'owner', status: 'active', revision: 2, sourceRefs: [] } as unknown as MemoryRecord;
    await store.put(current);
    expect(await store.exclude({ ...current, status: 'deleted' }, { id: 'exclusion', userId: 'owner', memoryId: 'm1', sourceHash: 'old-hash', sourceKeys: [], excludedAt: '2026' }, 1)).toBe(false);
    expect(await store.get('owner', 'm1')).toEqual(current);
    expect(await store.isExcluded('owner', 'old-hash', [])).toBe(false);
  });

  it('rejects stale conditional writes to deleted records even when the legacy revision matches', async () => {
    const deleted = { id: 'deleted', userId: 'owner', status: 'deleted', revision: 1, sourceRefs: [] } as unknown as MemoryRecord;
    const replace = vi.fn().mockImplementation(async resource => ({ resource }));
    const cosmos = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...deleted, _etag: 'etag' } }), replace }) } as never);
    const inMemory = new InMemoryMemoryStore();
    await inMemory.put(deleted);
    for (const store of [cosmos, inMemory]) {
      expect(await store.putIfRevision({ ...deleted, status: 'active', revision: 2 }, 1)).toBeNull();
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('lists memories without requiring a composite ORDER BY index', async () => {
    let queryText = '';
    const container = {
      items: {
        query: (spec: { query: string }) => {
          queryText = spec.query;
          return { fetchNext: async () => ({ resources: [] }) };
        },
      },
    };
    const store = new CosmosMemoryStore(container as never);

    await store.list('userA', { status: 'active', limit: 50 });

    expect(queryText).toContain('ORDER BY c.updatedAt DESC');
    expect(queryText).not.toContain('ORDER BY c.updatedAt DESC, c.id DESC');
  });

  it('strips Cosmos system metadata on get so strict re-validation on update/delete works', async () => {
    const stored = {
      id: 'm1', userId: 'userA', kind: 'fact', status: 'active', text: 'hi',
      _rid: 'abc', _self: 'dbs/x/colls/y/docs/z', _etag: '"0000-0000"', _attachments: 'attachments/', _ts: 1700000000,
    };
    const container = { item: () => ({ read: async () => ({ resource: stored }) }) };
    const store = new CosmosMemoryStore(container as never);

    const got = (await store.get('userA', 'm1')) as Record<string, unknown> | null;

    expect(got).toMatchObject({ id: 'm1', text: 'hi' });
    for (const key of ['_rid', '_self', '_etag', '_attachments', '_ts']) {
      expect(got?.[key]).toBeUndefined();
    }
  });

  it('strips Cosmos system metadata from list results', async () => {
    const container = {
      items: {
        query: () => ({
          fetchNext: async () => ({ resources: [{ id: 'm1', userId: 'userA', updatedAt: 'x', _etag: '"1"', _rid: 'r' }] }),
        }),
      },
    };
    const store = new CosmosMemoryStore(container as never);

    const page = await store.list('userA', { status: 'active', limit: 50 });
    const first = page.memories[0] as Record<string, unknown>;

    expect(first.id).toBe('m1');
    expect(first._etag).toBeUndefined();
    expect(first._rid).toBeUndefined();
  });

  it('atomically stores a deleted record plus payload-free source exclusion', async () => {
    let resources: Array<Record<string, unknown>> = [];
    let query = '';
    let parameters: Array<{ name: string; value: unknown }> = [];
    const container = {
      item: () => ({ read: async () => ({ resource: { id: 'm1', userId: 'userA', status: 'active', revision: 1, _etag: 'current-etag' } }) }),
      items: {
        batch: async (operations: Array<{ resourceBody: Record<string, unknown> }>) => {
          expect(operations).toMatchObject([
            { operationType: 'Replace', id: 'm1', ifMatch: 'current-etag' },
            { operationType: 'Create' },
          ]);
          resources = operations.map((operation) => operation.resourceBody);
          return { result: operations.map(() => ({ statusCode: 200 })) };
        },
        query: (spec: { query: string; parameters: Array<{ name: string; value: unknown }> }) => {
          query = spec.query;
          parameters = spec.parameters;
          return { fetchAll: async () => ({ resources: [{ id: 'exclusion' }] }) };
        },
      },
    };
    const store = new CosmosMemoryStore(container as never);
    const sourceRefs: MemoryRecord['sourceRefs'] = [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026' }];
    const record = {
      id: 'm1', userId: 'userA', kind: 'fact', status: 'deleted', text: 'forgotten payload',
      sourceRefs,
    } as never;
    await store.exclude(record, {
      id: 'memory-exclusion-m1', userId: 'userA', memoryId: 'm1', sourceHash: 'hash',
      sourceKeys: ['message:t1:u1:'], excludedAt: '2026',
    }, 1);
    expect(resources).toHaveLength(2);
    expect(resources[1]).toMatchObject({ recordType: 'memory-exclusion', sourceKeys: ['message:t1:u1:'] });
    expect(resources[1]).not.toHaveProperty('text');
    await expect(store.isExcluded('userA', 'other', sourceRefs)).resolves.toBe(true);
    expect(query).toContain('ARRAY_CONTAINS');
    expect(parameters).toContainEqual({ name: '@sourceKey0', value: 'message:t1:u1:' });
  });

  it('passes opaque continuation tokens through so equal timestamps cannot be cursor-filtered away', async () => {
    const seen: Array<{ token?: string; max?: number }> = [];
    const pages = [
      { resources: Array.from({ length: 100 }, (_, index) => ({ id: `m${index}`, userId: 'userA', updatedAt: 'same' })), continuationToken: 'page-2' },
      { resources: [{ id: 'm100', userId: 'userA', updatedAt: 'same' }] },
    ];
    const container = { items: { query: (_spec: unknown, options: { continuationToken?: string; maxItemCount?: number }) => ({
      fetchNext: async () => {
        seen.push({ token: options.continuationToken, max: options.maxItemCount });
        return pages[options.continuationToken ? 1 : 0];
      },
    }) } };
    const store = new CosmosMemoryStore(container as never);
    const first = await store.list('userA', { limit: 100 });
    const second = await store.list('userA', { limit: 100, cursor: first.cursor });
    expect([...first.memories, ...second.memories]).toHaveLength(101);
    expect(seen).toEqual([{ token: undefined, max: 100 }, { token: 'page-2', max: 100 }]);
  });

  it('replaces only the expected memory revision through its ETag', async () => {
    let replaced = 0;
    const stored = {
      id: 'm1', userId: 'userA', kind: 'fact', status: 'active', text: 'Current', revision: 2,
      sourceRefs: [{ type: 'manual', createdAt: '2026' }], confidence: 1, salience: 0.5,
      pinned: false, sensitive: false, visibility: 'normal', createdAt: '2026', updatedAt: '2026', useCount: 0,
    };
    const container = { item: () => ({
      read: async () => ({ resource: { ...stored, _etag: 'etag-2' } }),
      replace: async (record: unknown, options: { accessCondition: { condition: string } }) => {
        replaced++;
        expect(options.accessCondition.condition).toBe('etag-2');
        return { resource: record };
      },
    }) };
    const store = new CosmosMemoryStore(container as never);
    await expect(store.putIfRevision({ ...stored, text: 'New', revision: 3 } as never, 2)).resolves.toMatchObject({ text: 'New', revision: 3 });
    await expect(store.putIfRevision({ ...stored, text: 'Stale', revision: 3 } as never, 1)).resolves.toBeNull();
    expect(replaced).toBe(1);
  });
});