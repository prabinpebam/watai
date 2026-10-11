import { describe, expect, it, vi } from 'vitest';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { CosmosMemoryStore } from '../adapters/cosmos/memoryStore';
import { MemoryService } from './memoryService';
import { MemoryIndexService } from './memoryIndexService';
import { InMemorySettingsStore } from '../adapters/memory/settingsStore';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { memoryEmbeddingTextHash } from '../domain/memory';
import { claimMemoryIndexJob, memoryIndexJob } from '../domain/memoryIndex';
import type { Embedder } from '../ports/embedder';

const clock = { now: () => '2026-09-11T00:00:00Z', newId: () => 'saved' };

describe('independent memory index admission', () => {
  it.each(['owner', 'id', 'memory', 'model', 'revision', 'hash', 'state', 'token'] as const)
    ('rejects a mismatched index claim before permission or credential reads: %s', async field => {
      const store = new InMemoryMemoryStore();
      const settings = new InMemorySettingsStore();
      await settings.put('owner', DEFAULT_SETTINGS, null);
      await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Private saved text.' });
      const claim = store.claimIndexJob.bind(store);
      vi.spyOn(store, 'claimIndexJob').mockImplementation(async (...args) => {
        const job = (await claim(...args))!;
        return { ...job,
          ...(field === 'owner' ? { userId: 'other-owner' } : {}),
          ...(field === 'id' ? { id: 'other-job' } : {}),
          ...(field === 'memory' ? { memoryId: 'other-memory' } : {}),
          ...(field === 'model' ? { model: 'other-model' } : {}),
          ...(field === 'revision' ? { revision: job.revision + 1 } : {}),
          ...(field === 'hash' ? { textHash: 'b'.repeat(64) } : {}),
          ...(field === 'state' ? { state: 'queued' as const } : {}),
          ...(field === 'token' ? { executionToken: 'other-execution' } : {}),
        };
      });
      const readSettings = vi.spyOn(settings, 'get');
      const readCredentials = vi.fn(async () => ({ baseUrl: 'fixture', key: 'synthetic' }));
      const finish = vi.spyOn(store, 'finishIndexJob');
      const embed = vi.fn(async () => [1, 2]);
      const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed },
        credentials: { getDecrypted: readCredentials }, enabled: () => true, contained: () => false });
      expect(await worker.reconcile()).toEqual({ completed: 0, ignored: 0, deferred: 1 });
      expect(readSettings).not.toHaveBeenCalled();
      expect(readCredentials).not.toHaveBeenCalled();
      expect(embed).not.toHaveBeenCalled();
      expect(finish).not.toHaveBeenCalled();
    });

  it.each(['2026-09-11T00:00:00Z', '2026-09-11T05:30:00+05:30', '2026-09-10T20:00:00-04:00'])
    ('normalizes new index due times without changing assertion time: %s', async timestamp => {
      const store = new InMemoryMemoryStore();
      const saved = await new MemoryService(store, { ...clock, now: () => timestamp }, { store, model: 'model' })
        .createManual('owner', { text: 'Saved preference.' });
      const canonicalNow = '2026-09-11T00:00:00.000Z';
      const jobs = await store.listIndexJobs(canonicalNow, 3);
      expect(jobs).toHaveLength(1);
      expect(jobs[0].availableAt).toBe(canonicalNow);
      expect(await store.get('owner', saved.id)).toMatchObject({ updatedAt: timestamp, revision: 1 });
      expect(claimMemoryIndexJob(jobs[0], canonicalNow, 'worker')?.state).toBe('running');
    });

  it('shares one claimed-work deadline across jobs without aborting earlier success', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(clock.now()));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const store = new InMemoryMemoryStore();
      const settings = new InMemorySettingsStore();
      await settings.put('owner', DEFAULT_SETTINGS, null);
      for (const id of ['first', 'second', 'third']) {
        await new MemoryService(store, { now: () => new Date().toISOString(), newId: () => id }, { store, model: 'model' }).createManual('owner', { text: id });
      }
      const signals: AbortSignal[] = [];
      const embed = vi.fn<Embedder['embed']>(async (_credentials, text, options) => {
        signals.push(options!.signal!);
        if (text === 'first') await new Promise(resolve => setTimeout(resolve, 90_000));
        else await blocked;
        return [1, 2];
      });
      const claim = vi.spyOn(store, 'claimIndexJob');
      const finish = vi.spyOn(store, 'finishIndexJob');
      const worker = new MemoryIndexService({ store, settings, clock: { ...clock, now: () => new Date().toISOString() },
        embedder: { model: 'model', embed }, credentials: { getDecrypted: async () => ({ baseUrl: 'fixture', key: 'synthetic' }) },
        enabled: () => true, contained: () => false });
      let result: Awaited<ReturnType<MemoryIndexService['reconcile']>> | undefined;
      const work = worker.reconcile().then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(120_001);
      expect(result).toEqual({ completed: 1, ignored: 0, deferred: 1 });
      expect(claim).toHaveBeenCalledTimes(2);
      expect(signals.map(signal => signal.aborted)).toEqual([false, true]);
      expect(finish).toHaveBeenCalledOnce();
      release(); await work; await vi.advanceTimersByTimeAsync(0);
      expect(finish).toHaveBeenCalledOnce();
      expect((await store.get('owner', 'second'))?.embedding).toBeUndefined();
      expect((await store.listIndexJobs(new Date().toISOString(), 3)).map(job => job.memoryId)).toEqual(['third']);
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it('caps claimed work by the remaining lease when claim delivery was delayed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(clock.now()));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const store = new InMemoryMemoryStore();
      const settings = new InMemorySettingsStore();
      await settings.put('owner', DEFAULT_SETTINGS, null);
      await new MemoryService(store, { ...clock, now: () => new Date().toISOString() }, { store, model: 'model' }).createManual('owner', { text: 'Saved' });
      const claim = store.claimIndexJob.bind(store);
      vi.spyOn(store, 'claimIndexJob').mockImplementation(async (...args) => {
        const result = await claim(...args);
        vi.setSystemTime(new Date(Date.now() + 90_000));
        return result;
      });
      const worker = new MemoryIndexService({ store, settings, clock: { ...clock, now: () => new Date().toISOString() },
        embedder: { model: 'model', embed: async () => { await blocked; return [1, 2]; } },
        credentials: { getDecrypted: async () => ({ baseUrl: 'fixture', key: 'synthetic' }) }, enabled: () => true, contained: () => false });
      let result: Awaited<ReturnType<MemoryIndexService['reconcile']>> | undefined;
      const work = worker.reconcile().then(value => { result = value; });
      await vi.advanceTimersByTimeAsync(30_001);
      expect(result).toEqual({ completed: 0, ignored: 0, deferred: 1 });
      release(); await work; await vi.advanceTimersByTimeAsync(0);
      expect((await store.get('owner', 'saved'))?.embedding).toBeUndefined();
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it.each(['credentials', 'eligibility', 'embedding'] as const)('bounds claimed index work stalled in %s without late effects', async stage => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date(clock.now()));
    let release!: () => void;
    const blocked = new Promise<void>(resolve => { release = resolve; });
    try {
      const store = new InMemoryMemoryStore();
      const settings = new InMemorySettingsStore();
      await settings.put('owner', DEFAULT_SETTINGS, null);
      await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Private saved text' });
      const get = store.get.bind(store);
      vi.spyOn(store, 'get').mockImplementationOnce(async (...args) => { if (stage === 'eligibility') await blocked; return get(...args); });
      const credentials = { getDecrypted: vi.fn(async () => {
        if (stage === 'credentials') await blocked;
        return { baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' };
      }) };
      let signal: AbortSignal | undefined;
      const embed = vi.fn<Embedder['embed']>(async (_credentials, _text, options) => {
        signal = options?.signal;
        if (stage === 'embedding') await blocked;
        return [1, 2];
      });
      const finish = vi.spyOn(store, 'finishIndexJob');
      const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed }, credentials,
        enabled: () => true, contained: () => false });
      let observed: Awaited<ReturnType<MemoryIndexService['reconcile']>> | undefined;
      const work = worker.reconcile().then(result => { observed = result; });
      await vi.advanceTimersByTimeAsync(120_001);
      const atDeadline = observed;
      release();
      await work;
      await vi.advanceTimersByTimeAsync(0);
      expect(atDeadline).toEqual({ completed: 0, ignored: 0, deferred: 1 });
      expect(finish).not.toHaveBeenCalled();
      expect((await get('owner', 'saved'))?.embedding).toBeUndefined();
      expect(embed).toHaveBeenCalledTimes(stage === 'embedding' ? 1 : 0);
      if (stage === 'embedding') expect(signal?.aborted).toBe(true);
      expect(vi.getTimerCount()).toBe(0);
    } finally { release(); vi.useRealTimers(); }
  });

  it('does not send saved text after permission is revoked during final eligibility reads', async () => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', DEFAULT_SETTINGS, null);
    await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Private saved assertion' });
    const getJob = store.getIndexJob.bind(store);
    let reads = 0;
    vi.spyOn(store, 'getIndexJob').mockImplementation(async (...args) => {
      const job = await getJob(...args);
      if (++reads === 2) await settings.put('owner', { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: false } }, await settings.get('owner'));
      return job;
    });
    const embed = vi.fn(async () => [1, 2]);
    const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    await worker.reconcile();
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['revision', 'updatedAt', 'text'] as const)('rejects index publication that changes assertion %s', async field => {
    const memoryStore = new InMemoryMemoryStore();
    const saved = await new MemoryService(memoryStore, clock, { store: memoryStore, model: 'model' }).createManual('owner', { text: 'Approved' });
    const [queued] = await memoryStore.listIndexJobs(clock.now(), 3);
    const job = (await memoryStore.claimIndexJob('owner', queued.id, clock.now(), 'worker'))!;
    const record = { ...saved, embedding: [1, 2], embeddingModel: 'model', embeddingTextHash: job.textHash,
      ...(field === 'revision' ? { revision: 2 } : field === 'updatedAt' ? { updatedAt: '2026-09-11T00:00:01Z' } : { text: 'Unapproved text' }) };
    const batch = vi.fn();
    const cosmos = new CosmosMemoryStore({ items: { batch } } as never);
    for (const store of [memoryStore, cosmos]) {
      expect(await store.finishIndexJob(job, 'completed', clock.now(), { expected: saved, record })).toBe(false);
    }
    expect(await memoryStore.get('owner', saved.id)).toEqual(saved);
    expect((await memoryStore.getIndexJob('owner', job.id))?.state).toBe('running');
    expect(batch).not.toHaveBeenCalled();
  });

  it('preserves assertion time and editable revision when background indexing completes later', async () => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', DEFAULT_SETTINGS, null);
    const saved = await new MemoryService(store, { ...clock, now: () => '2025-01-01T00:00:00Z' }, { store, model: 'model' })
      .createManual('owner', { text: 'A long-standing preference.' });
    const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed: async () => [1, 2] },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    expect((await worker.reconcile()).completed).toBe(1);
    const writer = new MemoryService(store, clock, { store, model: 'model' });
    const profile = await writer.profile('owner');
    expect(profile.temporal.today.items).toEqual([]);
    expect(profile.temporal.month.items).toEqual([]);
    expect(await store.get('owner', saved.id)).toMatchObject({ revision: saved.revision, updatedAt: saved.updatedAt,
      embedding: [1, 2], embeddingTextHash: memoryEmbeddingTextHash(saved.text) });
    expect(await writer.patch('owner', saved.id, { expectedRevision: saved.revision!, text: 'Corrected preference.' }))
      .toMatchObject({ revision: 2, text: 'Corrected preference.' });
  });

  it('does not embed an ID-excluded record with changed content', async () => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', DEFAULT_SETTINGS, null);
    const saved = await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Changed legacy content' });
    await store.exclude(saved, { id: `memory-exclusion-${saved.id}`, userId: 'owner', memoryId: saved.id,
      sourceHash: 'old-hash', sourceKeys: [], excludedAt: clock.now() }, 1);
    const embed = vi.fn(async () => [1, 2]);
    const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    expect(await worker.reconcile()).toEqual({ completed: 0, ignored: 1, deferred: 0 });
    expect(embed).not.toHaveBeenCalled();
  });

  it.each(['claim', 'settle'] as const)('does not starve the next index job after a %s failure', async failure => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', DEFAULT_SETTINGS, null);
    const writer = new MemoryService(store, { ...clock, newId: () => 'first' }, { store, model: 'model' });
    await writer.createManual('owner', { text: 'First' });
    await new MemoryService(store, { ...clock, newId: () => 'second' }, { store, model: 'model' }).createManual('owner', { text: 'Second' });
    const [first] = await store.listIndexJobs(clock.now(), 3);
    if (failure === 'claim') vi.spyOn(store, 'claimIndexJob').mockRejectedValueOnce(new Error('Synthetic claim failure'));
    else {
      const finish = store.finishIndexJob.bind(store);
      vi.spyOn(store, 'finishIndexJob').mockImplementation((...args) => {
        if (args[0].id === first.id) return Promise.reject(new Error('Synthetic settlement failure'));
        return finish(...args);
      });
    }
    const worker = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed: async () => [1, 2] },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    expect(await worker.reconcile()).toEqual({ completed: 1, ignored: 0, deferred: 1 });
    expect((await store.get('owner', 'second'))?.embedding).toEqual([1, 2]);
    expect((await store.getIndexJob('owner', first.id))?.state).toBe(failure === 'claim' ? 'queued' : 'running');
  });

  it('keeps the registered timer inert unless explicitly enabled', async () => {
    const timer = vi.fn();
    const reconcile = vi.fn(async () => ({ completed: 0, ignored: 0, deferred: 0 }));
    const container = vi.fn(() => ({ memoryIndex: { reconcile } }));
    vi.doMock('@azure/functions', () => ({ app: { timer } }));
    vi.doMock('../composition', () => ({ container }));
    try {
      await import('../functions/memoryIndex');
      const registration = timer.mock.calls[0][1];
      expect(registration.runOnStartup).toBe(false);
      vi.stubEnv('MEMORY_INDEX_ENABLED', '0');
      await registration.handler({}, { warn: vi.fn() });
      expect(container).not.toHaveBeenCalled();
      vi.stubEnv('MEMORY_INDEX_ENABLED', 'true');
      await registration.handler({}, { warn: vi.fn() });
      expect(reconcile).toHaveBeenCalledOnce();
    } finally {
      vi.unstubAllEnvs();
      vi.doUnmock('@azure/functions');
      vi.doUnmock('../composition');
    }
  });

  it.each(['complete', 'empty', 'partial', 'excess', 'conflict', 'stale-memory', 'stale-job'] as const)
    ('requires both fenced Cosmos completion receipts: %s', async outcome => {
      const saved = await new MemoryService(new InMemoryMemoryStore(), clock).createManual('owner', { text: 'Approved' });
      const job = claimMemoryIndexJob(memoryIndexJob(saved, 'model'), clock.now(), 'worker')!;
      const indexed = { ...saved, embedding: [1, 2], embeddingModel: 'model', embeddingTextHash: job.textHash };
      const batch = vi.fn().mockResolvedValue({ result: outcome === 'empty' ? [] : outcome === 'partial' ? [{ statusCode: 200 }] :
        outcome === 'excess' ? [{ statusCode: 200 }, { statusCode: 200 }, { statusCode: 200 }] :
        outcome === 'conflict' ? [{ statusCode: 424 }, { statusCode: 412 }] : [{ statusCode: 200 }, { statusCode: 200 }] });
      const store = new CosmosMemoryStore({ items: { batch }, item: (id: string) => ({ read: async () => ({ resource: id === job.id
        ? { ...job, _etag: 'job-etag', ...(outcome === 'stale-job' ? { executionToken: 'new-worker' } : {}) }
        : { ...saved, _etag: 'memory-etag', ...(outcome === 'stale-memory' ? { revision: 2 } : {}) } }) }) } as never);
      const work = store.finishIndexJob(job, 'completed', clock.now(), { expected: saved, record: indexed });
      if (['empty', 'partial', 'excess'].includes(outcome)) await expect(work).rejects.toThrow('Memory index completion was not confirmed.');
      else expect(await work).toBe(outcome === 'complete');
      if (outcome === 'complete') {
        expect(batch.mock.calls[0][1]).toBe('owner');
        expect(batch.mock.calls[0][0]).toMatchObject([
          { operationType: 'Replace', id: job.id, ifMatch: 'job-etag' },
          { operationType: 'Replace', id: saved.id, ifMatch: 'memory-etag' },
        ]);
      }
      if (outcome.startsWith('stale-')) expect(batch).not.toHaveBeenCalled();
    });

  it('atomically admits a revisioned correction and its index intent', async () => {
    const original = await new MemoryService(new InMemoryMemoryStore(), clock).createManual('owner', { text: 'Original' });
    const batch = vi.fn().mockResolvedValue({ result: [{ statusCode: 200 }, { statusCode: 201 }] });
    const query = vi.fn(() => ({ fetchAll: async () => ({ resources: [] }) }));
    const store = new CosmosMemoryStore({ items: { batch, query }, item: () => ({ read: async () => ({ resource: { ...original, _etag: 'version' } }) }) } as never);
    const saved = await new MemoryService(store, clock, { store, model: 'model' }).patch('owner', original.id, { expectedRevision: 1, text: 'Correction' });
    expect(saved.revision).toBe(2);
    expect(query).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledOnce();
    expect(batch.mock.calls[0][0]).toMatchObject([
      { operationType: 'Replace', id: original.id, ifMatch: 'version' },
      { operationType: 'Create', resourceBody: { revision: 2, textHash: memoryEmbeddingTextHash('Correction') } },
    ]);
  });

  it('does not expose or mutate typed index records through ordinary memory reads/writes', async () => {
    const original = await new MemoryService(new InMemoryMemoryStore(), clock).createManual('owner', { text: 'Original' });
    const job = memoryIndexJob(original, 'model');
    const replace = vi.fn();
    const store = new CosmosMemoryStore({ item: () => ({ read: async () => ({ resource: { ...job, _etag: 'job-version' } }), replace }) } as never);
    expect(await store.get('owner', job.id)).toBeNull();
    expect(await store.putIfRevision({ ...original, id: job.id }, 1)).toBeNull();
    expect(replace).not.toHaveBeenCalled();
  });

  it.each(['missing-permission', 'reference-off', 'contained', 'disabled', 'edited', 'deleted', 'revoked', 'credentials', 'takeover', 'invalid-vector'] as const)
    ('does not publish an ineligible or stale index result: %s', async change => {
      const store = new InMemoryMemoryStore();
      const settings = new InMemorySettingsStore();
      let now = clock.now();
      const testClock = { now: () => now, newId: () => 'worker' };
      if (change !== 'missing-permission') await settings.put('owner', { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: true,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, enabled: true, referenceSaved: change !== 'reference-off', autoExtract: false, learnChats: 'off' } } }, null);
      const writer = new MemoryService(store, testClock, { store, model: 'model' });
      const saved = await writer.createManual('owner', { text: 'Original' });
      const [job] = await store.listIndexJobs(now, 3);
      let credentialKey = 'original-key';
      const embed = vi.fn(async () => {
        if (change === 'edited') await writer.patch('owner', saved.id, { expectedRevision: 1, text: 'Newer correction' });
        if (change === 'deleted') await writer.delete('owner', saved.id);
        if (change === 'revoked') await settings.put('owner', { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: false } }, await settings.get('owner'));
        if (change === 'credentials') credentialKey = 'changed-key';
        if (change === 'takeover') {
          now = '2026-09-11T00:03:00Z';
          await store.claimIndexJob('owner', job.id, now, 'new-worker');
        }
        return change === 'invalid-vector' ? [0, 0] : [1, 2];
      });
      const worker = new MemoryIndexService({ store, settings, clock: testClock, embedder: { model: 'model', embed },
        credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: credentialKey }) },
        enabled: () => change !== 'disabled', contained: () => change === 'contained' });
      await worker.reconcile();
      expect((await store.get('owner', saved.id))?.embedding).toBeUndefined();
      expect(embed).toHaveBeenCalledTimes(['missing-permission', 'reference-off', 'contained', 'disabled'].includes(change) ? 0 : 1);
      if (change === 'edited') expect((await store.get('owner', saved.id))?.text).toBe('Newer correction');
      if (change === 'deleted') expect((await store.get('owner', saved.id))?.status).toBe('deleted');
      if (change === 'takeover') expect(await store.getIndexJob('owner', job.id)).toMatchObject({ executionToken: 'new-worker', state: 'running' });
    });

  it('bounds failed-provider attempts without storing provider text', async () => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', DEFAULT_SETTINGS, null);
    let now = clock.now();
    await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Saved' });
    const [job] = await store.listIndexJobs(now, 3);
    const embed = vi.fn(async () => { throw new Error('Synthetic sensitive provider response'); });
    const worker = new MemoryIndexService({ store, settings, clock: { ...clock, now: () => now }, embedder: { model: 'model', embed },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await worker.reconcile();
      now = new Date(Date.parse(now) + 31_000).toISOString();
    }
    expect(embed).toHaveBeenCalledTimes(3);
    expect(await store.getIndexJob('owner', job.id)).toMatchObject({ state: 'failed', attempts: 3 });
    expect(JSON.stringify(await store.getIndexJob('owner', job.id))).not.toContain('provider response');
  });

  it('keeps imports unindexed until a revisioned explicit approval', async () => {
    const store = new InMemoryMemoryStore();
    const writer = new MemoryService(store, clock, { store, model: 'model' });
    await writer.import('owner', { version: 1, mode: 'commit', memories: [{ text: 'Imported', kind: 'fact', pinned: false, visibility: 'normal',
      sourceRefs: [{ type: 'manual', createdAt: clock.now() }] }] });
    expect(await store.listIndexJobs(clock.now(), 10)).toEqual([]);
    const [imported] = (await store.list('owner')).memories;
    expect(imported.confirmation).toBe('unknown');
    await writer.patch('owner', imported.id, { expectedRevision: 1, text: 'Approved import' });
    expect(await store.listIndexJobs(clock.now(), 10)).toMatchObject([{ revision: 2, textHash: memoryEmbeddingTextHash('Approved import') }]);
  });

  it('indexes an explicit saved preference while chat learning is off', async () => {
    const store = new InMemoryMemoryStore();
    const settings = new InMemorySettingsStore();
    await settings.put('owner', { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: true, memory: {
      ...DEFAULT_SETTINGS.personalization.memory!, enabled: true, referenceSaved: true, paused: true, autoExtract: false, referenceHistory: false, learnChats: 'off',
    } } }, null);
    const embed = vi.fn(async () => [1, 2]);
    const saved = await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Approved preference' });
    expect(embed).not.toHaveBeenCalled();
    const service = new MemoryIndexService({ store, settings, clock, embedder: { model: 'model', embed },
      credentials: { getDecrypted: async () => ({ baseUrl: 'https://fixture.openai.azure.com/openai/v1', key: 'synthetic' }) },
      enabled: () => true, contained: () => false });
    expect(await service.reconcile()).toEqual({ completed: 1, ignored: 0, deferred: 0 });
    expect(embed).toHaveBeenCalledOnce();
    expect(await store.get('owner', saved.id)).toMatchObject({ embedding: [1, 2], embeddingModel: 'model', revision: saved.revision, updatedAt: saved.updatedAt });
    expect(await service.reconcile()).toEqual({ completed: 0, ignored: 0, deferred: 0 });
  });

  it('fences expired or duplicate workers and atomically finishes the current job', async () => {
    const store = new InMemoryMemoryStore();
    const saved = await new MemoryService(store, clock, { store, model: 'model' }).createManual('owner', { text: 'Saved' });
    const [queued] = await store.listIndexJobs(clock.now(), 10);
    const first = await store.claimIndexJob('owner', queued.id, clock.now(), 'first');
    expect(await store.claimIndexJob('owner', queued.id, clock.now(), 'duplicate')).toBeNull();
    const later = '2026-09-11T00:03:00Z';
    const current = await store.claimIndexJob('owner', queued.id, later, 'replacement');
    expect(await store.finishIndexJob(first!, 'completed', later, { expected: saved, record: { ...saved, embedding: [1] } })).toBe(false);
    expect(await store.finishIndexJob(current!, 'completed', later, { expected: saved, record: { ...saved, embedding: [2],
      embeddingModel: 'model', embeddingTextHash: queued.textHash } })).toBe(true);
    expect((await store.get('owner', saved.id))?.embedding).toEqual([2]);
    expect((await store.getIndexJob('owner', queued.id))?.state).toBe('completed');
  });

  it('saves approved memory and a text-free intent without invoking learning or embedding', async () => {
    const store = new InMemoryMemoryStore();
    const service = new MemoryService(store, clock, { store, model: 'embedding-model' });
    const saved = await service.createManual('owner', { text: 'My approved preference' });
    const jobs = await store.listIndexJobs(clock.now(), 10);
    expect(jobs).toHaveLength(1);
    expect(jobs[0]).toMatchObject({ memoryId: saved.id, userId: 'owner', revision: 1, model: 'embedding-model', state: 'queued' });
    expect(JSON.stringify(jobs)).not.toContain(saved.text);
    expect((await store.list('owner')).memories).toHaveLength(1);
    await expect(service.createManual('owner', { text: 'Duplicate identity' })).rejects.toMatchObject({ code: 'conflict' });
    expect((await store.get('owner', saved.id))?.text).toBe(saved.text);
  });

  it.each(['success', 'partial', 'conflict'] as const)('requires complete atomic memory and intent receipts: %s', async outcome => {
    const batch = vi.fn().mockResolvedValue({ result: outcome === 'success' ? [{ statusCode: 201 }, { statusCode: 201 }] :
      outcome === 'conflict' ? [{ statusCode: 424 }, { statusCode: 409 }] : [{ statusCode: 201 }] });
    const query = vi.fn(() => ({ fetchAll: async () => ({ resources: [] }) }));
    const store = new CosmosMemoryStore({ items: { batch, query } } as never);
    const work = new MemoryService(store, clock, { store, model: 'embedding-model' }).createManual('owner', { text: 'Approved' });
    if (outcome === 'success') {
      expect(await work).toMatchObject({ confirmation: 'approved' });
      expect(batch.mock.calls[0][1]).toBe('owner');
      expect(batch.mock.calls[0][0]).toMatchObject([{ operationType: 'Create' }, { operationType: 'Create', resourceBody: { recordType: 'memory-index-job' } }]);
    } else if (outcome === 'conflict') await expect(work).rejects.toMatchObject({ code: 'conflict' });
    else await expect(work).rejects.toThrow('Memory index admission was not confirmed.');
    expect(query).toHaveBeenCalledOnce();
    expect(batch).toHaveBeenCalledOnce();
  });
});