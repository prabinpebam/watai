import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { AppError } from '../domain/errors';
import { isRetrievableMemory, memoryEmbeddingTextHash, parseMemoryRecord } from '../domain/memory';
import { MemoryService } from './memoryService';
import { CosmosMemoryStore } from '../adapters/cosmos/memoryStore';
import { createMemoryController } from '../http/memoryController';

function makeService() {
  const store = new InMemoryMemoryStore();
  let n = 0;
  let t = 0;
  const service = new MemoryService(store, {
    newId: () => `mem_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  });
  return { service, store };
}

function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  return fn()
    .then(() => undefined)
    .catch((e) => (e as AppError).code);
}

describe('MemoryService', () => {
  it.each(['forgotten-text', 'excluded-id'] as const)('does not bypass exclusions through an active edit: %s', async change => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Forgotten preference.' });
    await service.delete('userA', original.id);
    let current = await service.createManual('userA', { text: 'Unrelated current preference.' });
    if (change === 'excluded-id') {
      await service.delete('userA', current.id);
      current = { ...current, sourceHash: 'changed-legacy-hash' };
      await store.put(current);
    }
    const put = vi.spyOn(store, 'putIfRevision');
    await expect(service.patch('userA', current.id, { expectedRevision: current.revision!,
      ...(change === 'forgotten-text' ? { text: original.text } : { pinned: true }),
    })).rejects.toMatchObject({ code: 'conflict' });
    expect(put).not.toHaveBeenCalled();
    expect(await store.get('userA', current.id)).toEqual(current);
  });

  it.each(['hash', 'lineage'].flatMap(match => [false, true].map(indexed => ({ match, indexed }))))
    ('does not report a manual save for excluded content or lineage: %j', async ({ match, indexed }) => {
      const { service, store } = makeService();
      const sourceRef = { type: 'message' as const, threadId: 'source', messageId: 'message', createdAt: '2026-01-01T00:00:00Z' };
      const original = await service.createManual('userA', { text: 'Private preference.', sourceRef });
      await service.delete('userA', original.id);
      const writer = new MemoryService(store, { newId: () => 'retry', now: () => original.createdAt }, indexed ? { store, model: 'model' } : undefined);
      const create = vi.spyOn(store, 'createIfAbsent');
      const index = vi.spyOn(store, 'saveWithIndex');
      await expect(writer.createManual('userA', {
        text: match === 'hash' ? original.text : 'Reworded private preference.',
        ...(match === 'lineage' ? { sourceRef } : {}),
      })).rejects.toMatchObject({ code: 'conflict' });
      expect(create).not.toHaveBeenCalled();
      expect(index).not.toHaveBeenCalled();
      expect(await store.get('userA', 'retry')).toBeNull();
      expect(await store.getExclusion('userA', original.id)).not.toBeNull();
      expect(await writer.createManual('userA', { text: 'Unrelated new preference.' })).toMatchObject({ id: 'retry', confirmation: 'approved' });
    });

  it('does not present an unapproved import as a structured fact before explicit approval', async () => {
    const { service } = makeService();
    await service.import('userA', { version: 1, mode: 'commit', memories: [{ text: 'Use concise explanations.', kind: 'preference',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }], visibility: 'normal', pinned: false,
    }] });
    const inventory = await service.list('userA', {});
    expect(inventory.memories).toHaveLength(1);
    expect(inventory.memories[0].confirmation).toBe('unknown');
    const unapproved = await service.profile('userA');
    expect(unapproved.evidenceCount).toBe(0);
    expect(unapproved.profile.user.preferences.communication).toEqual([]);
    const memory = inventory.memories[0];
    await service.patch('userA', memory.id, { expectedRevision: memory.revision!, text: memory.text });
    const approved = await service.profile('userA');
    expect(approved.evidenceCount).toBe(1);
    expect(approved.profile.user.preferences.communication).toMatchObject([{ text: memory.text, sourceMemoryIds: [memory.id] }]);
  });

  it.each(['created', 'updated', 'source-date', 'validity-date', 'reversed', 'source-identity'] as const)
    ('rejects malformed v2 provenance without repairing it: %s', async field => {
      const { service, store } = makeService();
      const saved = await service.createManual('userA', { text: 'Saved record.' });
      const exported = await service.export('userA', 2);
      const malformed = { ...saved,
        ...(field === 'created' ? { createdAt: 'unknown' } : {}),
        ...(field === 'updated' ? { updatedAt: '2026-02-30T00:00:00Z' } : {}),
        ...(field === 'source-date' ? { sourceRefs: [{ type: 'manual', createdAt: 'unknown' }] } : {}),
        ...(field === 'source-identity' ? { sourceRefs: [{ type: 'message', createdAt: saved.createdAt }] } : {}),
        ...(field === 'validity-date' ? { validAt: 'unknown' } : {}),
        ...(field === 'reversed' ? { validAt: '2030-01-01T00:00:00Z', invalidAt: '2020-01-01T00:00:00Z' } : {}),
      };
      const create = vi.spyOn(store, 'createIfAbsent');
      const result = await createMemoryController(service).import({ claims: { sub: 'userA' }, body: {
        ...exported, mode: 'preview', memories: [malformed],
      } });
      expect(result.status).toBe(400);
      expect(create).not.toHaveBeenCalled();
      expect(await store.get('userA', saved.id)).toEqual(saved);
    });

  it.each(['profile', 'export'] as const)('checks earlier records after later %s pages finish loading', async operation => {
    const { service, store } = makeService();
    const first = await service.createManual('userA', { text: 'Use concise explanations.', kind: 'preference' });
    const second = await service.createManual('userA', { text: 'Another saved record.' });
    vi.spyOn(store, 'list').mockResolvedValueOnce({ memories: [first], cursor: 'second' })
      .mockImplementationOnce(async () => {
        await service.delete('userA', first.id);
        return { memories: [second] };
      });
    await expect(operation === 'profile' ? service.profile('userA') : service.export('userA'))
      .rejects.toMatchObject({ code: 'conflict', message: 'Memory inventory contains excluded records. Retry from the current state.' });
    expect(await store.get('userA', second.id)).toEqual(second);
  });

  it('stops v2 export collection once the active-record limit is exceeded', async () => {
    const { service, store } = makeService();
    const template = await service.createManual('userA', { text: 'Saved' });
    let page = 0;
    const list = vi.spyOn(store, 'list').mockImplementation(async () => ({
      memories: Array.from({ length: 100 }, (_, index) => ({ ...template, id: `memory-${page * 100 + index}` })),
      cursor: String(++page),
    }));
    expect((await createMemoryController(service).export({ claims: { sub: 'userA' }, query: { version: '2' } })).status).toBe(400);
    expect(list).toHaveBeenCalledTimes(11);
  });

  it.each(['commit', 'version', 'foreign-record', 'foreign-summary', 'duplicate', 'inactive', 'too-many', 'extra-field', 'excluded', 'excluded-summary'] as const)
    ('rejects an unsafe v2 archive preview as a whole: %s', async invalid => {
      const { service, store } = makeService();
      const saved = await service.createManual('userA', { text: 'Saved preference.' });
      const exported = await service.export('userA', 2);
      const payload = { ...exported, mode: invalid === 'commit' ? 'commit' : 'preview',
        ...(invalid === 'version' ? { version: 3 } : {}),
        ...(invalid === 'extra-field' ? { authorize: true } : {}),
        memories: invalid === 'too-many' ? Array.from({ length: 1001 }, () => saved) : invalid === 'duplicate' ? [saved, saved] : [{ ...saved,
          ...(invalid === 'foreign-record' ? { userId: 'userB' } : {}),
          ...(invalid === 'inactive' ? { status: 'suppressed' } : {}),
        }],
      };
      if (invalid === 'foreign-summary' || invalid === 'excluded-summary') {
        const summary = await service.putSummary('userA', 'Derived source summary.');
        payload.summary = { ...summary, userId: invalid === 'foreign-summary' ? 'userB' : 'userA', sourceMemoryIds: [saved.id] };
      }
      if (invalid === 'excluded' || invalid === 'excluded-summary') await service.delete('userA', saved.id);
      if (invalid === 'excluded-summary') payload.memories = [];
      const write = vi.spyOn(store, 'createIfAbsent');
      const put = vi.spyOn(store, 'put');
      const summaryWrite = vi.spyOn(store, 'putSummary');
      const result = await createMemoryController(service).import({ claims: { sub: 'userA' }, body: payload });
      expect(result.status).toBe(invalid.startsWith('excluded') ? 409 : 400);
      expect(write).not.toHaveBeenCalled();
      expect(put).not.toHaveBeenCalled();
      expect(summaryWrite).not.toHaveBeenCalled();
    });

  it('keeps default v1 export and import behavior and rejects unknown export versions', async () => {
    const { service, store } = makeService();
    const controller = createMemoryController(service);
    expect((await controller.export({ claims: { sub: 'userA' } })).body).toMatchObject({ version: 1, memories: [] });
    expect((await controller.export({ claims: { sub: 'userA' }, query: { version: '3' } })).status).toBe(400);
    const result = await controller.import({ claims: { sub: 'userA' }, body: { version: 1, mode: 'commit', memories: [{
      text: 'Legacy import.', kind: 'fact', sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
      visibility: 'normal', pinned: false,
    }] } });
    expect(result.status).toBe(200);
    expect(result.body).toMatchObject({ added: 1, skipped: 0, rejected: [] });
    expect((await store.list('userA')).memories[0]).toMatchObject({ origin: 'imported', confirmation: 'unknown' });
  });

  it('round-trips 1000 full active records through v2 export and preview without writes', async () => {
    const store = new InMemoryMemoryStore();
    const now = '2026-01-01T00:00:00.000Z';
    const service = new MemoryService(store, { now: () => now, newId: () => 'template' });
    const template = await service.createManual('userA', { text: 'Saved preference.', kind: 'preference' });
    for (let index = 1; index < 1000; index++) {
      await store.put({ ...template, id: `memory-${index}`, text: `Saved ${index}.`, revision: 3,
        validAt: '2025-01-01T00:00:00Z', invalidAt: '2030-01-01T00:00:00Z',
        validityHistory: [{ validAt: '2024-01-01T00:00:00Z', invalidAt: '2024-12-31T00:00:00Z', revision: 1 }],
        entities: ['Known entity'], topics: ['Known topic'], sensitive: index % 2 === 0,
        embedding: [1, 2], embeddingModel: 'model', embeddingTextHash: memoryEmbeddingTextHash(`Saved ${index}.`),
      });
    }
    const controller = createMemoryController(service);
    const exported = await controller.export({ claims: { sub: 'userA' }, query: { version: '2' } });
    expect(exported.status).toBe(200);
    const archive = exported.body as { version: number; scope: string; memories: unknown[] };
    expect(archive).toMatchObject({ version: 2, scope: 'active-records' });
    expect(archive.memories).toHaveLength(1000);
    const put = vi.spyOn(store, 'put');
    const create = vi.spyOn(store, 'createIfAbsent');
    const index = vi.spyOn(store, 'saveWithIndex');
    const preview = await controller.import({ claims: { sub: 'userA' }, body: JSON.parse(JSON.stringify({ ...archive, mode: 'preview' })) });
    expect(preview.status).toBe(200);
    expect(preview.body).toMatchObject({ added: 0, skipped: 0, rejected: [], archive });
    expect(put).not.toHaveBeenCalled();
    expect(create).not.toHaveBeenCalled();
    expect(index).not.toHaveBeenCalled();
  });

  it.each(['summary', 'export'] as const)('rejects a linked forgotten source in %s even when active inventory is empty', async operation => {
    const { service, store } = makeService();
    const memory = await service.createManual('userA', { text: 'Private source text.' });
    const summary = await service.putSummary('userA', 'Summary derived from private source.');
    await store.putSummary({ ...summary, sourceMemoryIds: [memory.id] });
    await service.delete('userA', memory.id);
    await expect(operation === 'summary' ? service.getSummary('userA') : service.export('userA'))
      .rejects.toMatchObject({ code: 'conflict', message: 'Memory summary contains excluded sources. Rebuild it from current records.' });
    expect(await store.getSummary('userA')).toMatchObject({ text: summary.text });
  });

  it('checks declared summary sources in at most five bounded batches', async () => {
    const { service, store } = makeService();
    const summary = await service.putSummary('userA', 'Stored summary.');
    const linked = { ...summary, sourceMemoryIds: Array.from({ length: 500 }, (_, index) => `source-${index}`) };
    await store.putSummary(linked);
    const check = vi.spyOn(store, 'hasExcludedMemories');
    expect(await service.getSummary('userA')).toEqual(linked);
    expect(check).toHaveBeenCalledTimes(5);
    expect(check.mock.calls.every(([owner, records]) => owner === 'userA' && records.length === 100)).toBe(true);
  });

  it.each(['id', 'hash', 'lineage', 'foreign', 'unrelated'] as const)('matches inventory exclusions by %s within the owner boundary', async match => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Original private preference.', sourceRef: {
      type: 'message', threadId: 'source-thread', messageId: 'source-message', createdAt: '2026-01-01T00:00:00Z',
    } });
    await service.delete('userA', original.id);
    const candidate = { ...original,
      id: match === 'id' ? original.id : 'different-id',
      userId: match === 'foreign' ? 'userB' : 'userA',
      sourceHash: match === 'hash' ? original.sourceHash : 'different-hash',
      sourceRefs: match === 'lineage' ? original.sourceRefs : [{ type: 'manual' as const, createdAt: original.createdAt }],
    };
    expect(await store.hasExcludedMemories(candidate.userId, [candidate])).toBe(['id', 'hash', 'lineage'].includes(match));
  });

  it('rejects oversized and foreign exclusion batches before database I/O', async () => {
    const { service, store } = makeService();
    const memory = await service.createManual('userA', { text: 'Saved' });
    const query = vi.fn();
    const cosmos = new CosmosMemoryStore({ items: { query } } as never);
    for (const adapter of [store, cosmos]) {
      expect(await adapter.hasExcludedMemories('userA', [])).toBe(false);
      await expect(adapter.hasExcludedMemories('userA', Array.from({ length: 101 }, () => memory)))
        .rejects.toThrow('Memory exclusion batch binding failed.');
      await expect(adapter.hasExcludedMemories('userB', [memory])).rejects.toThrow('Memory exclusion batch binding failed.');
    }
    expect(query).not.toHaveBeenCalled();
  });

  it('checks 1000 exported records with ten owner-scoped exclusion queries, never their text', async () => {
    const original = await makeService().service.createManual('userA', { text: 'Private text must not enter exclusion query parameters.' });
    const records = Array.from({ length: 1000 }, (_, index) => ({ ...original, id: `memory-${index}` }));
    const exclusionQueries: Array<{ query: string; parameters: Array<{ name: string; value: unknown }> }> = [];
    const query = vi.fn((statement: { query: string; parameters: Array<{ name: string; value: unknown }> }, options: { partitionKey: string; continuationToken?: string }) => {
      expect(options.partitionKey).toBe('userA');
      if (statement.query.includes('SELECT TOP 1 c.id')) {
        exclusionQueries.push(statement);
        return { fetchAll: async () => ({ resources: [] }) };
      }
      const offset = Number(options.continuationToken ?? 0);
      return { fetchNext: async () => ({ resources: records.slice(offset, offset + 100),
        ...(offset + 100 < records.length ? { continuationToken: String(offset + 100) } : {}),
      }) };
    });
    const store = new CosmosMemoryStore({ items: { query }, item: () => ({ read: async () => ({ resource: undefined }) }) } as never);
    const service = new MemoryService(store, { now: () => original.createdAt, newId: () => 'unused' });
    expect((await service.export('userA')).memories).toHaveLength(1000);
    expect(exclusionQueries).toHaveLength(10);
    for (const statement of exclusionQueries) {
      expect(statement.query).toContain('c.userId = @userId AND c.recordType = @recordType');
      expect(statement.query).toContain('ARRAY_CONTAINS(@ids, c.memoryId)');
      expect(statement.query).toContain('ARRAY_CONTAINS(@hashes, c.sourceHash)');
      expect(statement.query).toContain('ARRAY_CONTAINS(@sourceKeys, sourceKey)');
      expect(statement.parameters).toContainEqual({ name: '@recordType', value: 'memory-exclusion' });
      expect(statement.parameters.find(parameter => parameter.name === '@ids')?.value).toHaveLength(100);
      expect(JSON.stringify(statement)).not.toContain(original.text);
    }
  });

  it('does not publish a partial export after an exclusion read fails', async () => {
    const { service, store } = makeService();
    await service.createManual('userA', { text: 'Saved' });
    const failure = new Error('Synthetic exclusion read failure');
    vi.spyOn(store, 'hasExcludedMemories').mockRejectedValueOnce(failure);
    const summary = vi.spyOn(store, 'getSummary');
    await expect(service.export('userA')).rejects.toBe(failure);
    expect(summary).not.toHaveBeenCalled();
  });

  it.each(['profile', 'export'] as const)('does not redisclose a forgotten record through a stale %s inventory', async operation => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Use concise explanations.', kind: 'preference' });
    await service.delete('userA', original.id);
    vi.spyOn(store, 'list').mockResolvedValue({ memories: [original] });
    await expect(operation === 'profile' ? service.profile('userA') : service.export('userA'))
      .rejects.toMatchObject({ code: 'conflict', message: 'Memory inventory contains excluded records. Retry from the current state.' });
    expect(await store.getExclusion('userA', original.id)).not.toBeNull();
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'deleted' });
  });

  it('rejects restoration when the memory ID has an exclusion receipt for older content', async () => {
    const { service, store } = makeService();
    const created = await service.createManual('userA', { text: 'Changed legacy content.' });
    const outdated = await service.patch('userA', created.id, { expectedRevision: 1, status: 'invalidated' });
    vi.spyOn(store, 'getExclusion').mockResolvedValue({ id: `memory-exclusion-${created.id}`, userId: 'userA',
      memoryId: created.id, sourceHash: 'older-content-hash', sourceKeys: [], excludedAt: created.createdAt });
    await expect(service.patch('userA', created.id, { expectedRevision: 2, status: 'active' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.get('userA', created.id)).toEqual(outdated);
  });

  it('restores an ended assertion with a new validity interval and preserved prior interval', async () => {
    const { service, store } = makeService();
    const created = await service.createManual('userA', { text: 'I prefer concise answers.' });
    await store.put({ ...created, validAt: '2025-01-01T00:00:00Z' });
    const outdated = await service.patch('userA', created.id, { expectedRevision: 1, status: 'invalidated' });
    const restored = await service.patch('userA', created.id, { expectedRevision: 2, status: 'active' });
    expect(isRetrievableMemory(restored, restored.updatedAt)).toBe(true);
    expect(restored).toMatchObject({ revision: 3, validAt: restored.updatedAt,
      validityHistory: [{ validAt: '2025-01-01T00:00:00Z', invalidAt: outdated.invalidAt, revision: 2 }] });
    expect(restored.invalidAt).toBeUndefined();
    expect(restored.text).toBe(created.text);
    expect(restored.sourceRefs).toEqual(created.sourceRefs);
    expect(parseMemoryRecord(restored)).toEqual(restored);
    await service.delete('userA', created.id);
    expect((await store.get('userA', created.id))?.validityHistory).toBeUndefined();
  });

  it('refuses to truncate full validity history during restoration', async () => {
    const { service, store } = makeService();
    const created = await service.createManual('userA', { text: 'Historical assertion.' });
    const outdated = parseMemoryRecord({ ...created, revision: 17, status: 'invalidated', invalidAt: created.createdAt,
      validityHistory: Array.from({ length: 16 }, (_, index) => ({ invalidAt: '2025-01-01T00:00:00Z', revision: index + 1 })) });
    await store.put(outdated);
    await expect(service.patch('userA', created.id, { expectedRevision: 17, status: 'active' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.get('userA', created.id)).toEqual(outdated);
  });

  it('preserves a concurrent correction made while restore eligibility is checked', async () => {
    const { service, store } = makeService();
    const created = await service.createManual('userA', { text: 'Original assertion.' });
    const outdated = await service.patch('userA', created.id, { expectedRevision: 1, status: 'invalidated' });
    const newer = { ...outdated, revision: 3, text: 'Newer correction' };
    vi.spyOn(store, 'isExcluded').mockImplementationOnce(async () => { await store.put(newer); return false; });
    await expect(service.patch('userA', created.id, { expectedRevision: 2, status: 'active' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.get('userA', created.id)).toEqual(newer);
  });

  it.each(['excluded', 'active-expired', 'future', 'missing-cutoff', 'superseded'] as const)('rejects unsupported historical restoration without mutation: %s', async state => {
    const { service, store } = makeService();
    const created = await service.createManual('userA', { text: 'Prior assertion.' });
    const outdated = { ...created, status: state === 'active-expired' ? 'active' as const : 'invalidated' as const,
      invalidAt: state === 'missing-cutoff' ? undefined : state === 'future' ? '2030-01-01T00:00:00Z' : created.createdAt,
      ...(state === 'superseded' ? { supersededBy: 'replacement' } : {}) };
    await store.put(outdated);
    if (state === 'excluded') vi.spyOn(store, 'isExcluded').mockResolvedValue(true);
    await expect(service.patch('userA', created.id, { expectedRevision: 1, status: 'active' })).rejects.toMatchObject({ code: 'conflict' });
    expect(await store.get('userA', created.id)).toEqual(outdated);
  });

  it.each(['text', 'same-text', 'pin'] as const)('keeps manual correction metadata aligned with current text: %s', async change => {
    const { service, store } = makeService();
    const saved = await service.createManual('userA', { text: 'I prefer old tooling.', kind: 'preference',
      sourceRef: { type: 'message', threadId: 'source', messageId: 'message', createdAt: '2026-01-01T00:00:00Z', quote: 'My daughter Mira is 9 years old.' } });
    const original = parseMemoryRecord({ ...saved, summary: 'My daughter Mira is 9 years old.', entities: ['Mira'], topics: ['old-topic'],
      route: { layer: 'long_term_profile', profilePath: 'user.family.children', entity: { type: 'family_member', name: 'Mira' },
        relationship: { predicate: 'HAS_FAMILY_MEMBER', attributes: { relationship: 'daughter', age: 9 } } },
      embedding: [1, 2], embeddingModel: 'model', embeddingTextHash: memoryEmbeddingTextHash(saved.text),
      validAt: '2025-01-01T00:00:00Z', supersedes: ['prior-record'] });
    await store.put(original);
    const corrected = await service.patch('userA', saved.id, { expectedRevision: 1,
      ...(change === 'pin' ? { pinned: true } : { text: change === 'text' ? 'I prefer concise explanations.' : original.text }) });
    expect(corrected.sourceRefs).toEqual(original.sourceRefs);
    expect(corrected.validAt).toBe(original.validAt);
    expect(corrected.supersedes).toEqual(original.supersedes);
    if (change === 'text') {
      expect(corrected.route).toBeUndefined();
      expect(corrected.summary).toBeUndefined();
      expect(corrected.entities).toBeUndefined();
      expect(corrected.topics).toBeUndefined();
      expect(corrected.embedding).toBeUndefined();
      const profile = await service.profile('userA');
      expect(profile.profile.user.family.children).toEqual([]);
      expect(profile.profile.user.preferences.communication).toMatchObject([{ text: corrected.text, sourceMemoryIds: [saved.id] }]);
    } else {
      expect(corrected.route).toEqual(original.route);
      expect(corrected.summary).toBe(original.summary);
      expect(corrected.entities).toEqual(original.entities);
      expect(corrected.topics).toEqual(original.topics);
      expect(corrected.embedding).toEqual(original.embedding);
    }
  });

  it('does not approve or revise a memory for an empty patch', async () => {
    const { service, store } = makeService();
    const saved = await service.createManual('userA', { text: 'Unconfirmed imported assertion.' });
    const imported = { ...saved, origin: 'imported' as const, confirmation: 'unknown' as const };
    await store.put(imported);
    await expect(service.patch('userA', saved.id, { expectedRevision: 1 })).rejects.toMatchObject({ code: 'validation' });
    expect(await store.get('userA', saved.id)).toEqual(imported);
  });

  it.each(['identical', 'changed', 'foreign-owner', 'inactive'] as const)('keeps inventory pages owner-bound and non-contradictory: %s', async state => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'One saved assertion.' });
    const second = { ...original,
      ...(state === 'changed' ? { text: 'Concurrent correction.', revision: 2 } : {}),
      ...(state === 'foreign-owner' ? { id: 'foreign', userId: 'userB' } : {}),
      ...(state === 'inactive' ? { status: 'deleted' as const } : {}),
    };
    const list = vi.spyOn(store, 'list').mockResolvedValueOnce({ memories: [original], cursor: 'page-2' })
      .mockResolvedValueOnce({ memories: [second] });
    if (state === 'identical') expect((await service.export('userA')).memories).toEqual([original]);
    else await expect(service.export('userA')).rejects.toMatchObject({ code: 'conflict', message: 'Memory inventory changed during collection. Retry from the current state.' });
    expect(list).toHaveBeenCalledTimes(2);
  });

  it.each(['profile', 'export'].flatMap(operation => ['repeat', 'cycle'].map(cursor => ({ operation, cursor }))))('fails non-progressing inventory pagination without returning partial data: %j', async ({ operation, cursor }) => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'First inventory item.' });
    const tokens = cursor === 'repeat' ? ['page-2', 'page-2'] : ['page-2', 'page-3', 'page-2'];
    let reads = 0;
    const list = vi.spyOn(store, 'list').mockImplementation(async () => {
      if (reads >= tokens.length) throw new Error('Read beyond detected cursor cycle.');
      return { memories: [original], cursor: tokens[reads++] };
    });
    const result = operation === 'profile' ? service.profile('userA') : service.export('userA');
    await expect(result).rejects.toMatchObject({ code: 'internal', message: 'Memory inventory pagination did not advance.' });
    expect(list).toHaveBeenCalledTimes(tokens.length);
  });

  it('keeps all known hashes excluded when historical hashes recur during repair', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Known deleted assertion.' });
    await service.delete('userA', original.id);
    const hashes = [original.sourceHash!, 'a'.repeat(64), 'b'.repeat(64), 'a'.repeat(64), 'c'.repeat(64)];
    for (const hash of hashes) {
      const tombstone = (await store.get('userA', original.id))!;
      await store.put({ ...tombstone, sourceHash: hash, revision: tombstone.revision! + 1 });
      await service.delete('userA', original.id);
    }
    for (const hash of new Set(hashes)) expect(await store.isExcluded('userA', hash, [])).toBe(true);
    expect((await store.get('userA', original.id))?.text).toBe('Deleted memory');
  });

  it('minimizes legacy deleted payload even when exclusion is already recorded', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Private legacy payload.' });
    await store.exclude({ ...original, status: 'deleted', summary: 'Private summary.', embedding: [1, 0], embeddingModel: 'stub' }, {
      id: `memory-exclusion-${original.id}`, userId: 'userA', memoryId: original.id,
      sourceHash: original.sourceHash, sourceKeys: [], excludedAt: '2026-01-01T00:00:00Z',
    }, 1);
    await service.delete('userA', original.id);
    const tombstone = await store.get('userA', original.id);
    expect(tombstone?.text).toBe('Deleted memory');
    expect(tombstone).not.toHaveProperty('summary');
    expect(tombstone).not.toHaveProperty('embedding');
    expect(tombstone).not.toHaveProperty('embeddingModel');
    await service.delete('userA', original.id);
    expect(await store.get('userA', original.id)).toEqual(tombstone);
  });

  it('retains earlier source exclusions when repairing an incomplete tombstone receipt', async () => {
    const { service, store } = makeService();
    const currentSource = { type: 'message' as const, threadId: 'current-thread', messageId: 'current-source', createdAt: '2026-01-01T00:00:00Z' };
    const oldSource = { type: 'message' as const, threadId: 'old-thread', messageId: 'old-source', createdAt: '2025-01-01T00:00:00Z' };
    const original = await service.createManual('userA', { text: 'Deleted detail.', sourceRef: currentSource });
    await store.exclude({ ...original, status: 'deleted' }, {
      id: `memory-exclusion-${original.id}`, userId: 'userA', memoryId: original.id,
      sourceHash: original.sourceHash, sourceKeys: ['message:old-thread:old-source:'], excludedAt: '2026-01-01T00:00:00Z',
    }, 1);
    await service.delete('userA', original.id);
    expect(await store.isExcluded('userA', undefined, [currentSource])).toBe(true);
    expect(await store.isExcluded('userA', undefined, [oldSource])).toBe(true);
  });

  it('preserves a conflicting historical exclusion hash while completing repair', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Deleted detail.' });
    const previousHash = 'a'.repeat(64);
    await store.exclude({ ...original, status: 'deleted' }, {
      id: `memory-exclusion-${original.id}`, userId: 'userA', memoryId: original.id,
      sourceHash: previousHash, sourceKeys: [], excludedAt: '2026-01-01T00:00:00Z',
    }, 1);
    await expect(service.delete('userA', original.id)).resolves.toMatchObject({ servingExcluded: true });
    expect(await store.isExcluded('userA', previousHash, [])).toBe(true);
    expect(await store.isExcluded('userA', original.sourceHash, [])).toBe(true);
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'deleted', text: 'Deleted memory', revision: 2 });
  });

  it('repairs a legacy tombstone exclusion before acknowledging repeated deletion', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Previously deleted personal detail.' });
    await store.put({ ...original, status: 'deleted' });
    await expect(service.delete('userA', original.id)).resolves.toMatchObject({ servingExcluded: true });
    expect(await store.isExcluded('userA', original.sourceHash, original.sourceRefs)).toBe(true);
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'deleted', text: 'Deleted memory' });
  });

  it('does not acknowledge exclusion for a tombstone with unknown provenance', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Original detail.' });
    await store.put({ ...original, status: 'deleted', text: 'Deleted memory', sourceHash: undefined });
    await expect(service.delete('userA', original.id)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('clears the vector text binding when the user corrects a memory', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Original text.' });
    await store.put({ ...original, embedding: [1, 0], embeddingModel: 'stub', embeddingTextHash: memoryEmbeddingTextHash(original.text) });
    const corrected = await service.patch('userA', original.id, { expectedRevision: 1, text: 'Corrected text.' });
    expect(corrected.text).toBe('Corrected text.');
    expect(corrected.embedding).toBeUndefined();
    expect(corrected.embeddingModel).toBeUndefined();
    expect(corrected.embeddingTextHash).toBeUndefined();
  });

  it.each(['manual', 'import'] as const)('never overwrites an existing memory on a generated %s ID collision', async mode => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Keep the approved memory.' });
    const colliding = new MemoryService(store, { newId: () => original.id, now: () => '2026-01-02T00:00:00Z' });
    if (mode === 'manual') {
      await expect(colliding.createManual('userA', { text: 'Unrelated new memory.' })).rejects.toMatchObject({ code: 'conflict' });
    } else {
      expect(await colliding.import('userA', { version: 1, mode: 'commit', memories: [{
        text: 'Unrelated new memory.', kind: 'fact', pinned: false, visibility: 'normal',
        sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
      }] })).toMatchObject({ added: 0, skipped: 1 });
    }
    expect(await store.get('userA', original.id)).toEqual(original);
  });

  it('derives exact-content exclusion for a legacy memory without a stored hash', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Legacy forgotten assertion.' });
    await store.put({ ...original, sourceHash: undefined });
    await service.delete('userA', original.id);
    expect(await store.isExcluded('userA', original.sourceHash, [])).toBe(true);
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'deleted', text: 'Deleted memory', sourceHash: original.sourceHash });
  });

  it('does not exclude unrelated manual records when forgetting an unidentified manual source', async () => {
    const { service, store } = makeService();
    const deleted = await service.createManual('userA', { text: 'Forgotten preference.' });
    const retained = await service.createManual('userA', { text: 'Unrelated saved preference.' });
    await service.delete('userA', deleted.id);
    expect(await store.isExcluded('userA', deleted.sourceHash, [])).toBe(true);
    expect(await store.isExcluded('userA', retained.sourceHash, retained.sourceRefs)).toBe(false);
  });

  it('retries deletion from the current corrected revision and source lineage', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Original assertion.' });
    const sourceRefs = [{ type: 'message' as const, threadId: 'corrected-thread', messageId: 'corrected-source', createdAt: '2026-01-01T00:00:00Z' }];
    let correctedHash: string | undefined;
    const exclude = vi.spyOn(store, 'exclude').mockImplementationOnce(async () => {
      const corrected = await service.patch('userA', original.id, { expectedRevision: 1, text: 'Corrected assertion.' });
      correctedHash = corrected.sourceHash;
      await store.put({ ...corrected, sourceRefs });
      return false;
    });
    await service.delete('userA', original.id);
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'deleted', revision: 3, text: 'Deleted memory' });
    expect(await store.isExcluded('userA', correctedHash, [])).toBe(true);
    expect(await store.isExcluded('userA', undefined, sourceRefs)).toBe(true);
    expect(exclude).toHaveBeenCalledTimes(2);
  });

  it('does not acknowledge deletion after repeated revision conflicts', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', { text: 'Keep until excluded.' });
    const exclude = vi.spyOn(store, 'exclude').mockResolvedValue(false);
    await expect(service.delete('userA', original.id)).rejects.toMatchObject({ code: 'conflict' });
    expect(exclude).toHaveBeenCalledTimes(3);
    expect(await store.get('userA', original.id)).toMatchObject({ status: 'active', revision: 1 });
  });

  it('minimizes deleted payload while preserving the original exclusion and idempotent tombstone', async () => {
    const { service, store } = makeService();
    const original = await service.createManual('userA', {
      text: 'Private stored assertion.',
      sourceRef: { type: 'message', threadId: 't1', messageId: 'm1', quote: 'Private quoted detail.', createdAt: '2026-01-01T00:00:00Z' },
    });
    await store.put({ ...original, summary: 'Private summary.', entities: ['Private person'], topics: ['Private topic'], embedding: [1, 0], embeddingModel: 'private-model' });
    await service.delete('userA', original.id);
    const tombstone = (await store.get('userA', original.id))!;
    expect(tombstone).toMatchObject({ id: original.id, userId: 'userA', status: 'deleted', text: 'Deleted memory', revision: 2 });
    expect(() => parseMemoryRecord(tombstone)).not.toThrow();
    for (const field of ['normalizedText', 'summary', 'entities', 'topics', 'embedding', 'embeddingModel']) {
      expect(tombstone).not.toHaveProperty(field);
    }
    expect(JSON.stringify(tombstone).toLowerCase()).not.toContain('private');
    expect(await store.isExcluded('userA', original.sourceHash, [])).toBe(true);
    expect(await store.isExcluded('userA', undefined, original.sourceRefs)).toBe(true);
    await service.delete('userA', original.id);
    expect(await store.get('userA', original.id)).toEqual(tombstone);
    expect(await store.putIfRevision({ ...original, revision: 3 }, 2)).toBeNull();
  });

  it('creates manual memories with server-owned defaults', async () => {
    const { service } = makeService();
    const record = await service.createManual('userA', {
      text: '  Remember that Watai deploys to rg-watai-dev.  ',
      kind: 'fact',
      pinned: true,
      visibility: 'top_of_mind',
    });
    expect(record).toMatchObject({
      id: 'mem_1',
      userId: 'userA',
      kind: 'fact',
      status: 'active',
      text: 'Remember that Watai deploys to rg-watai-dev.',
      normalizedText: 'remember that watai deploys to rg-watai-dev.',
      confidence: 1,
      salience: 0.7,
      pinned: true,
      sensitive: false,
      visibility: 'top_of_mind',
      useCount: 0,
    });
    expect(record.sourceRefs).toEqual([{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }]);
  });

  it('lists caller-scoped memories with status, kind, q, and limit filters', async () => {
    const { service } = makeService();
    await service.createManual('userA', { text: 'User prefers short implementation plans.', kind: 'preference' });
    await service.createManual('userA', { text: 'Watai deploys to rg-watai-dev.', kind: 'fact' });
    await service.createManual('userB', { text: 'Other user prefers verbose plans.', kind: 'preference' });

    const q = await service.list('userA', { q: 'deploy', limit: 10 });
    expect(q.memories.map((m) => m.text)).toEqual(['Watai deploys to rg-watai-dev.']);

    const prefs = await service.list('userA', { kind: 'preference' });
    expect(prefs.memories.map((m) => m.text)).toEqual(['User prefers short implementation plans.']);
  });

  it('uses deterministic pagination cursors', async () => {
    const { service } = makeService();
    await service.createManual('userA', { text: 'One' });
    await service.createManual('userA', { text: 'Two' });
    await service.createManual('userA', { text: 'Three' });

    const first = await service.list('userA', { limit: 2 });
    expect(first.memories.map((m) => m.text)).toEqual(['Three', 'Two']);
    expect(first.cursor).toBeTruthy();

    const second = await service.list('userA', { limit: 2, cursor: first.cursor });
    expect(second.memories.map((m) => m.text)).toEqual(['One']);
    expect(second.cursor).toBeUndefined();
  });

  it('paginates 1000 equal-timestamp records without omissions', async () => {
    const { service, store } = makeService();
    for (let index = 0; index < 1000; index++) {
      await store.put({
        id: `memory-${String(index).padStart(4, '0')}`, userId: 'userA', kind: 'fact', status: 'active',
        text: `Memory ${index}`, sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
        confidence: 1, salience: 0.5, pinned: false, sensitive: false, visibility: 'normal',
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', useCount: 0,
      });
    }
    const ids: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await service.list('userA', { status: 'active', limit: 100, cursor });
      ids.push(...page.memories.map((memory) => memory.id));
      cursor = page.cursor;
    } while (cursor);
    expect(ids).toHaveLength(1000);
    expect(new Set(ids).size).toBe(1000);
  });

  it('patches status and excludes suppressed/deleted memories from default list', async () => {
    const { service } = makeService();
    const active = await service.createManual('userA', { text: 'Keep this.' });
    const hidden = await service.createManual('userA', { text: 'Hide this.' });
    await service.patch('userA', hidden.id, { expectedRevision: 1, status: 'suppressed' });
    await service.delete('userA', active.id);

    expect((await service.list('userA', {})).memories).toHaveLength(0);
    expect((await service.list('userA', { status: 'suppressed' })).memories.map((m) => m.id)).toEqual([hidden.id]);
    expect((await service.list('userA', { status: 'deleted' })).memories.map((m) => m.id)).toEqual([active.id]);
  });

  it('does not restore an excluded memory through import', async () => {
    const { service } = makeService();
    const sourceRef = { type: 'message' as const, threadId: 't1', messageId: 'm1', createdAt: '2026-01-01T00:00:00Z' };
    const memory = await service.createManual('userA', { text: 'User prefers concise plans.', kind: 'preference', sourceRef });
    await service.delete('userA', memory.id);
    const result = await service.import('userA', {
      version: 1,
      mode: 'commit',
      memories: [{ text: 'User prefers concise plans.', kind: 'preference', sourceRefs: [sourceRef], visibility: 'normal', pinned: false }],
    });
    expect(result).toMatchObject({ added: 0, skipped: 1 });
    expect((await service.list('userA', {})).memories).toEqual([]);
  });

  it('invalidates with invalidAt and rejects patching deleted memories', async () => {
    const { service } = makeService();
    const record = await service.createManual('userA', { text: 'Old fact.' });
    const invalidated = await service.patch('userA', record.id, { expectedRevision: 1, status: 'invalidated' });
    expect(invalidated.invalidAt).toBe('2026-01-01T00:00:01Z');

    await service.delete('userA', record.id);
    expect(await code(() => service.patch('userA', record.id, { expectedRevision: 2, text: 'New text.' }))).toBe('conflict');
  });

  it('rejects stale edits and preserves the newer approved correction', async () => {
    const { service } = makeService();
    const record = await service.createManual('userA', { text: 'Original' });
    const corrected = await service.patch('userA', record.id, { expectedRevision: 1, text: 'Corrected' });
    expect(corrected.revision).toBe(2);
    await expect(service.patch('userA', record.id, { expectedRevision: 1, text: 'Stale overwrite' }))
      .rejects.toMatchObject({ code: 'conflict' });
    await expect(service.list('userA', {})).resolves.toMatchObject({ memories: [{ text: 'Corrected', revision: 2 }] });
  });

  it('stores and replaces the user summary', async () => {
    const { service } = makeService();
    expect(await service.getSummary('userA')).toBeNull();
    const summary = await service.putSummary('userA', '  User prefers concise engineering detail.  ');
    expect(summary).toMatchObject({ id: 'memory-summary', kind: 'summary', text: 'User prefers concise engineering detail.', version: 1 });
    const replaced = await service.putSummary('userA', 'Updated summary.');
    expect(replaced).toMatchObject({ text: 'Updated summary.', version: 2 });
  });
});