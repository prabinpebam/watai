import { describe, expect, it, vi } from 'vitest';
import { createHash } from 'node:crypto';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { InMemoryMemoryJobStore } from '../adapters/memory/memoryJobStore';
import { InMemoryMessageStore } from '../adapters/memory/messageStore';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { DEFAULT_SETTINGS } from '../domain/settings';
import { memoryEmbeddingTextHash, parseMemoryRecord } from '../domain/memory';
import type { Embedder } from '../ports/embedder';
import { MemoryExtractionService, type MemoryExtractorPort, type MemoryQueuePort } from './memoryExtractionService';
import { MemoryService } from './memoryService';
import { MemoryDispatchService } from './memoryDispatchService';
import { MemoryPublicationUnconfirmedError } from '../ports/memoryStore';
import { parseMemoryExtractionJobRecord } from '../domain/memoryExtraction';

function setup(
  extractor: MemoryExtractorPort,
  embedder?: Embedder,
  settingsOverride?: { get: () => Promise<typeof DEFAULT_SETTINGS> },
  queueOverride?: MemoryQueuePort,
  contained?: () => boolean,
) {
  const memoryStore = new InMemoryMemoryStore();
  const jobStore = new InMemoryMemoryJobStore();
  const messageStore = new InMemoryMessageStore();
  const threadStore = new InMemoryThreadStore();
  const enqueued: string[] = [];
  const queue: MemoryQueuePort = queueOverride ?? { enqueue: async (job) => void enqueued.push(job.id) };
  let n = 0;
  let t = 0;
  const clock = { newId: () => `id_${++n}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  const settings = settingsOverride ?? { get: async () => ({ ...DEFAULT_SETTINGS, data: { ...DEFAULT_SETTINGS.data, sync: true } }) };
  const credentials = { getDecrypted: async () => ({ baseUrl: 'https://example.com/openai/v1', key: 'k', models: { chat: 'gpt-4.1' } }) };
  const sends: Array<{ target: string; payload: unknown }> = [];
  const signalr = { negotiate: () => ({}) as never, sendToUser: async (_userId: string, target: string, payload: unknown) => void sends.push({ target, payload }) };
  const svc = new MemoryExtractionService({ memoryStore, jobStore, messageStore, threadStore, queue, settings, credentials, extractor, embedder, signalr: signalr as never, contained, clock });
  return { svc, memoryStore, jobStore, messageStore, threadStore, enqueued, sends, clock };
}

async function seedThread(ctx: ReturnType<typeof setup>, temporary = false, userContent = 'I prefer concise implementation plans.') {
  await ctx.threadStore.put({
    id: 't1',
    userId: 'userA',
    title: 'T',
    pinned: false,
    archived: false,
    temporary,
    messageCount: 2,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  });
  await ctx.messageStore.append({ id: 'u1', threadId: 't1', userId: 'userA', role: 'user', content: userContent, status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:01Z', deletedAt: null });
  await ctx.messageStore.append({ id: 'a1', threadId: 't1', userId: 'userA', role: 'assistant', content: 'Got it.', status: 'complete', createdAt: '2026-01-01T00:00:02Z', orderAt: '2026-01-01T00:00:02Z', deletedAt: null });
}

describe('MemoryExtractionService', () => {
  it.each(['thread', 'kind', 'user-message', 'assistant-message', 'revision', 'dedupe', 'run', 'created'] as const)
    ('fences an extractor after immutable job source %s changes without a token change', async field => {
      let jobId = '';
      const ctx = setup(async () => {
        const current = (await ctx.jobStore.get('userA', jobId))!;
        await ctx.jobStore.put({ ...current,
          ...(field === 'thread' ? { threadId: 'other-thread' } : {}),
          ...(field === 'kind' ? { kind: 'command' as const } : {}),
          ...(field === 'user-message' ? { userMessageId: 'other-user-message' } : {}),
          ...(field === 'assistant-message' ? { assistantMessageId: 'other-assistant-message' } : {}),
          ...(field === 'revision' ? { sourceRevision: 'b'.repeat(64) } : {}),
          ...(field === 'dedupe' ? { dedupeKey: 'other-source' } : {}),
          ...(field === 'run' ? { runId: 'other-run' } : {}),
          ...(field === 'created' ? { createdAt: '2025-01-01T00:00:00Z' } : {}),
        });
        return { operations: [{ op: 'add', sensitivity: 'normal', kind: 'preference', text: 'I prefer concise implementation plans.',
          confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'Direct user statement.' }] };
      });
      await seedThread(ctx);
      jobId = (await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'original-run'))!.id;
      await ctx.svc.processJob('userA', jobId);
      expect((await ctx.memoryStore.list('userA')).memories).toEqual([]);
      expect(await ctx.jobStore.get('userA', jobId)).toMatchObject({ status: 'running' });
      expect(ctx.sends).toEqual([]);
    });

  it.each(['lookup', 'obsolete-ack', 'job-owner', 'job-id'] as const)
    ('keeps later dispatch and stale recovery progressing after %s fails', async failure => {
      const ctx = setup(async () => ({ operations: [] }));
      const base = parseMemoryExtractionJobRecord({
        id: 'first', userId: 'userA', threadId: 't1', kind: 'turn', assistantMessageId: 'a1',
        dedupeKey: 'first-source', sourceRevision: 'a'.repeat(64), status: 'queued', attempts: 0,
        releaseId: 'release', executionToken: 'token', dispatchAttempt: 1,
        createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      });
      await ctx.jobStore.admit(base);
      await ctx.jobStore.admit({ ...base, id: 'ready', dedupeKey: 'ready-source' });
      await ctx.jobStore.put({ ...base, id: 'stale', dedupeKey: 'stale-source', status: 'running' });
      if (failure === 'obsolete-ack') await ctx.jobStore.put({ ...base, status: 'completed' });
      const get = ctx.jobStore.get.bind(ctx.jobStore);
      vi.spyOn(ctx.jobStore, 'get').mockImplementation(async (owner, id) => {
        if (id !== 'first') return get(owner, id);
        if (failure === 'lookup') throw new Error('Synthetic lookup failure');
        const record = (await get(owner, id))!;
        return { ...record,
          ...(failure === 'job-owner' ? { userId: 'other-owner' } : {}),
          ...(failure === 'job-id' ? { id: 'other-job' } : {}),
        };
      });
      const acknowledge = ctx.jobStore.markDispatchSent.bind(ctx.jobStore);
      vi.spyOn(ctx.jobStore, 'markDispatchSent').mockImplementation(async (dispatch, now) => {
        if (dispatch.jobId === 'first' && failure === 'obsolete-ack') throw new Error('Synthetic acknowledgement failure');
        await acknowledge(dispatch, now);
      });
      const enqueue = vi.fn(async () => {});
      const recovery = new MemoryDispatchService(ctx.jobStore, { enqueue }, { ...ctx.clock, now: () => '2026-01-01T01:00:00Z' });
      expect(await recovery.reconcile()).toEqual({ inspected: 3, sent: 1, discarded: 0, failed: 1 });
      expect(enqueue).toHaveBeenCalledExactlyOnceWith(expect.objectContaining({ id: 'ready', userId: 'userA' }));
      expect((await ctx.jobStore.listPendingDispatch()).map(dispatch => dispatch.jobId)).toEqual(['first']);
      expect(await get('userA', 'stale')).toMatchObject({ status: 'failed', terminalReason: 'worker_outcome_unconfirmed' });
    });

  it.each(['command', 'turn'].flatMap(kind => ['thread-owner', 'thread-id', 'message-thread', 'message-id', 'message-deleted'].map(change => ({ kind, change }))))
    ('does not admit an extraction source with invalid identity: %j', async ({ kind, change }) => {
      const ctx = setup(async () => ({ operations: [] }));
      await seedThread(ctx);
      const sourceId = kind === 'command' ? 'u1' : 'a1';
      if (change.startsWith('thread-')) {
        const thread = (await ctx.threadStore.get('userA', 't1'))!;
        vi.spyOn(ctx.threadStore, 'get').mockResolvedValue({ ...thread,
          ...(change === 'thread-owner' ? { userId: 'other-owner' } : { id: 'other-thread' }),
        });
      } else {
        const source = (await ctx.messageStore.get('userA', 't1', sourceId))!;
        vi.spyOn(ctx.messageStore, 'get').mockResolvedValue({ ...source,
          ...(change === 'message-thread' ? { threadId: 'other-thread' } : {}),
          ...(change === 'message-id' ? { id: 'other-message' } : {}),
          ...(change === 'message-deleted' ? { deletedAt: '2026-01-01T00:01:00Z' } : {}),
        });
      }
      const admit = vi.spyOn(ctx.jobStore, 'admit');
      const result = kind === 'command'
        ? await ctx.svc.enqueueCommand('userA', 't1', sourceId)
        : await ctx.svc.enqueueTurn('userA', 't1', sourceId);
      expect(result).toBeNull();
      expect(admit).not.toHaveBeenCalled();
      expect(ctx.enqueued).toEqual([]);
    });

  it.each(['owner', 'id'] as const)('rejects a misbound worker claim before any further work: %s', async field => {
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const job = (await ctx.svc.enqueueTurn('userA', 't1', 'a1'))!;
    vi.spyOn(ctx.jobStore, 'claim').mockResolvedValue({ ...job, status: 'running', attempts: 1,
      ...(field === 'owner' ? { userId: 'other-owner' } : { id: 'other-job' }),
    });
    const readThread = vi.spyOn(ctx.threadStore, 'get');
    const settle = vi.spyOn(ctx.jobStore, 'putIfCurrent');
    await expect(ctx.svc.processJob('userA', job.id)).rejects.toThrow('Memory job claim binding failed.');
    expect(readThread).not.toHaveBeenCalled();
    expect(extractor).not.toHaveBeenCalled();
    expect(settle).not.toHaveBeenCalled();
  });

  it.each(['command', 'turn'].flatMap(kind => ['same', 'thread', 'revision'].map(change => ({ kind, change }))))
    ('preserves only exact-source legacy job replay: %j', async ({ kind, change }) => {
      const ctx = setup(async () => ({ operations: [] }));
      await seedThread(ctx);
      const messageId = kind === 'command' ? 'u1' : 'a1';
      const source = (await ctx.messageStore.get('userA', 't1', messageId))!;
      const sourceRevision = createHash('sha256').update(`${source.id}\n${source.createdAt}\n${source.content}`).digest('hex');
      const dedupeKey = `memory-${kind}:${messageId}:${sourceRevision.slice(0, 24)}`;
      const legacy = parseMemoryExtractionJobRecord({
        id: `memory-job-${createHash('sha256').update(dedupeKey).digest('hex').slice(0, 32)}`,
        userId: 'userA', threadId: change === 'thread' ? 'other-thread' : 't1', kind, status: 'queued',
        ...(kind === 'command' ? { userMessageId: messageId } : { assistantMessageId: messageId }),
        sourceRevision: change === 'revision' ? `${sourceRevision.slice(0, 63)}${sourceRevision.endsWith('0') ? '1' : '0'}` : sourceRevision,
        dedupeKey, releaseId: 'legacy-release', executionToken: 'legacy-token', dispatchAttempt: 1, attempts: 0,
        createdAt: source.createdAt, updatedAt: source.createdAt,
      });
      await ctx.jobStore.admit(legacy);
      const result = kind === 'command'
        ? await ctx.svc.enqueueCommand('userA', 't1', messageId)
        : await ctx.svc.enqueueTurn('userA', 't1', messageId);
      expect(result).toMatchObject({ threadId: 't1', kind, sourceRevision });
      if (change === 'same') {
        expect(result).toEqual(legacy);
        expect(ctx.enqueued).toEqual([]);
      } else {
        expect(result!.id).not.toBe(legacy.id);
        expect(ctx.enqueued).toEqual([result!.id]);
      }
      expect(await ctx.jobStore.get('userA', legacy.id)).toEqual(legacy);
    });

  it.each(['owner', 'thread', 'kind', 'revision', 'message', 'id'] as const)
    ('rejects a mismatched admission replay before queue dispatch: %s', async field => {
      const ctx = setup(async () => ({ operations: [] }));
      await seedThread(ctx);
      vi.spyOn(ctx.jobStore, 'admit').mockImplementation(async record => ({
        outcome: 'replay', job: { ...record,
          ...(field === 'owner' ? { userId: 'other-owner' } : {}),
          ...(field === 'thread' ? { threadId: 'other-thread' } : {}),
          ...(field === 'kind' ? { kind: 'command' as const } : {}),
          ...(field === 'revision' ? { sourceRevision: 'different-revision' } : {}),
          ...(field === 'message' ? { assistantMessageId: 'other-message' } : {}),
          ...(field === 'id' ? { id: 'other-job' } : {}),
        },
      }));
      await expect(ctx.svc.enqueueTurn('userA', 't1', 'a1')).rejects.toThrow('Memory job source binding failed.');
      expect(ctx.enqueued).toEqual([]);
    });

  it.each(['command', 'turn'] as const)('admits concurrent matching %s sources only once', async kind => {
    const ctx = setup(async () => ({ operations: [] }));
    await seedThread(ctx);
    const enqueue = () => kind === 'command'
      ? ctx.svc.enqueueCommand('userA', 't1', 'u1')
      : ctx.svc.enqueueTurn('userA', 't1', 'a1');
    const results = await Promise.all([enqueue(), enqueue()]);
    expect(results[0]).not.toBeNull();
    expect(results[1]).toEqual(results[0]);
    expect(ctx.enqueued).toEqual([results[0]!.id]);
  });

  it.each(['command', 'turn'] as const)('keeps identical %s message revisions in different threads independent', async kind => {
    const ctx = setup(async () => ({ operations: [] }));
    await seedThread(ctx);
    await ctx.threadStore.put({ ...(await ctx.threadStore.get('userA', 't1'))!, id: 't2' });
    for (const messageId of ['u1', 'a1']) {
      await ctx.messageStore.append({ ...(await ctx.messageStore.get('userA', 't1', messageId))!, threadId: 't2' });
    }
    const enqueue = (threadId: string) => kind === 'command'
      ? ctx.svc.enqueueCommand('userA', threadId, 'u1')
      : ctx.svc.enqueueTurn('userA', threadId, 'a1');
    const first = await enqueue('t1');
    const second = await enqueue('t2');
    expect(first).toMatchObject({ threadId: 't1', kind });
    expect(second).toMatchObject({ threadId: 't2', kind });
    expect(second!.id).not.toBe(first!.id);
    expect(second!.dedupeKey).not.toBe(first!.dedupeKey);
    expect(await enqueue('t1')).toEqual(first);
    expect(await enqueue('t2')).toEqual(second);
    expect(ctx.enqueued).toEqual([first!.id, second!.id]);
  });

  it.each(['missing', 'stale', 'current'] as const)('only stamps legacy vector text after fresh embedding: %s', async state => {
    const embed = vi.fn(async () => [1, 0]);
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'No new assertion.' }] }), { model: 'stub', embed });
    await seedThread(ctx);
    const memory = await new MemoryService(ctx.memoryStore, ctx.clock).createManual('userA', { text: 'Current saved text.' });
    await ctx.memoryStore.put({ ...memory, embedding: [0, 1], embeddingModel: 'stub',
      embeddingTextHash: state === 'missing' ? undefined : memoryEmbeddingTextHash(state === 'stale' ? 'Old text.' : memory.text) });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(embed).toHaveBeenCalledTimes(state === 'current' ? 0 : 1);
    if (state !== 'current') expect(embed).toHaveBeenCalledWith(expect.anything(), memory.text);
    expect(await ctx.memoryStore.get('userA', memory.id)).toMatchObject({
      text: memory.text, embedding: state === 'current' ? [0, 1] : [1, 0],
      embeddingTextHash: memoryEmbeddingTextHash(memory.text),
      revision: memory.revision, updatedAt: memory.updatedAt,
    });
  });

  it('fails a job with an unconfirmed publication instead of claiming an ignored proposal', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal', kind: 'fact',
      text: 'New detail.', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'Direct statement.' }] }));
    await seedThread(ctx);
    vi.spyOn(ctx.memoryStore, 'createIfAbsent').mockRejectedValue(new MemoryPublicationUnconfirmedError());
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await expect(ctx.svc.processJob('userA', job!.id)).rejects.toThrow('Memory extraction failed.');
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'failed' });
    expect(ctx.sends).toEqual([]);
  });

  it.each(['merge', 'invalidate', 'suppress', 'supersede'].flatMap(operation =>
    ['changed', 'unprovided'].map(target => ({ operation, target })),
  ))('rejects extractor mutations against a stale or unprovided target: %j', async ({ operation, target }) => {
    let ctx!: ReturnType<typeof setup>;
    ctx = setup(async () => {
      const original = (await ctx.memoryStore.get('userA', 'existing'))!;
      if (target === 'changed') await ctx.memoryStore.put({ ...original, text: 'Newer concurrent detail.', revision: 2 });
      const common = { sourceMessageIds: ['u1'], reason: 'Obsolete proposal.' };
      if (operation === 'supersede') return { operations: [{ ...common, op: 'add', sensitivity: 'normal', kind: 'fact', text: 'Stale replacement.', confidence: 0.99, salience: 0.99, supersedes: ['existing'] }] };
      if (operation === 'merge') return { operations: [{ ...common, op: 'merge', sensitivity: 'normal', memoryId: 'existing', text: 'Stale replacement.' }] };
      return { operations: [{ ...common, op: operation === 'invalidate' ? 'invalidate' : 'suppress', memoryId: 'existing' }] };
    });
    await seedThread(ctx);
    const original = parseMemoryRecord({
      id: 'existing', userId: 'userA', kind: 'fact', status: 'active', text: 'Original detail.',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    });
    await ctx.memoryStore.put(original);
    if (target === 'unprovided') vi.spyOn(ctx.memoryStore, 'list').mockResolvedValueOnce({ memories: [] });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(await ctx.memoryStore.get('userA', 'existing')).toMatchObject({
      status: 'active', text: target === 'changed' ? 'Newer concurrent detail.' : original.text,
      revision: target === 'changed' ? 2 : 1,
    });
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toHaveLength(1);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
  });

  it.each([undefined, 'unknown', 'sensitive', 'normal'] as const)('admits inferred adds only with explicit normal sensitivity: %s', async sensitivity => {
    const embed = vi.fn(async () => [1, 0]);
    const ctx = setup(async () => ({ operations: [{
      op: 'add', sensitivity, kind: 'fact', text: 'A durable personal detail.', confidence: 0.99,
      salience: 0.9, sourceMessageIds: ['u1'], reason: 'Direct statement without a sensitivity decision.',
    }] }), { model: 'stub', embed });
    await seedThread(ctx, false, 'A durable personal detail.');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const accepted = sensitivity === 'normal' ? 1 : 0;
    expect(embed).toHaveBeenCalledTimes(accepted);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toHaveLength(accepted);
    if (accepted) expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories[0]).toMatchObject({
      embeddingTextHash: memoryEmbeddingTextHash('A durable personal detail.'),
    });
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: accepted, rejectedCount: 1 - accepted });
  });

  it.each([undefined, 'unknown', 'sensitive', 'normal'] as const)('never discloses or downgrades stored sensitive memories during inferred merges: %s', async sensitivity => {
    const embed = vi.fn(async () => [1, 0]);
    let memoryId = '';
    const extractor = vi.fn<MemoryExtractorPort>(async () => ({ operations: [{
      op: 'merge', sensitivity, memoryId, text: 'Updated personal detail.',
      sourceMessageIds: ['u1'], reason: 'Updated evidence.',
    }] }));
    const ctx = setup(extractor, { model: 'stub', embed });
    await seedThread(ctx, false, 'Updated personal detail.');
    const original = await new MemoryService(ctx.memoryStore, ctx.clock).createManual('userA', { text: 'Original personal detail.' });
    memoryId = original.id;
    await ctx.memoryStore.put({ ...original, origin: 'inferred', confirmation: 'automatic', sensitive: true });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(extractor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ existingMemories: [] }));
    expect(embed).not.toHaveBeenCalled();
    expect(await ctx.memoryStore.get('userA', memoryId)).toMatchObject({
      text: original.text, sensitive: true,
    });
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
  });

  it('bounds existing-memory revalidation to 20 owner-matching candidates', async () => {
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const saved = await new MemoryService(ctx.memoryStore, ctx.clock).createManual('userA', { text: 'Current preference.' });
    const get = vi.spyOn(ctx.memoryStore, 'get');
    const excluded = vi.spyOn(ctx.memoryStore, 'isExcluded');
    vi.spyOn(ctx.memoryStore, 'list').mockResolvedValueOnce({ memories: [
      { ...saved, userId: 'foreign-owner' },
      ...Array.from({ length: 25 }, () => ({ ...saved })),
    ] });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(get.mock.calls.length).toBeLessThanOrEqual(20);
    expect(excluded.mock.calls.length).toBeLessThanOrEqual(20);
    expect(get.mock.calls.every(([userId]) => userId === 'userA')).toBe(true);
    expect(extractor).toHaveBeenCalledOnce();
  });

  it.each(['deleted', 'edited', 'excluded', 'unavailable', 'unchanged'] as const)('revalidates existing memory context before extraction: %s', async change => {
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const memory = new MemoryService(ctx.memoryStore, ctx.clock);
    const original = await memory.createManual('userA', { text: 'Private existing preference.' });
    const list = ctx.memoryStore.list.bind(ctx.memoryStore);
    vi.spyOn(ctx.memoryStore, 'list').mockImplementationOnce(async (...args) => {
      const page = await list(...args);
      if (change === 'deleted') await memory.delete('userA', original.id);
      if (change === 'edited') await memory.patch('userA', original.id, { expectedRevision: 1, text: 'Corrected preference.' });
      if (change === 'excluded') await ctx.memoryStore.exclude(original, {
        id: 'excluded', userId: 'userA', memoryId: original.id, sourceHash: original.sourceHash, sourceKeys: [], excludedAt: ctx.clock.now(),
      }, 1);
      if (change === 'unavailable') vi.spyOn(ctx.memoryStore, 'get').mockRejectedValue(new Error('Read unavailable'));
      return page;
    });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(extractor).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({
      existingMemories: change === 'unchanged' ? [expect.objectContaining({ id: original.id, text: original.text })] : [],
    }));
  });

  it.each(['learning-off', 'contained', 'thread-deleted', 'source-deleted', 'source-edited'] as const)('does not disclose extraction input after preparation becomes %s', async change => {
    let learning = true;
    let contained = false;
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor, undefined, { get: async () => ({ ...DEFAULT_SETTINGS, personalization: {
      ...DEFAULT_SETTINGS.personalization,
      memory: { enabled: true, paused: !learning, referenceSaved: true, referenceHistory: true, autoExtract: true },
    } }) }, undefined, () => contained);
    await seedThread(ctx);
    const list = ctx.memoryStore.list.bind(ctx.memoryStore);
    vi.spyOn(ctx.memoryStore, 'list').mockImplementationOnce(async (...args) => {
      const page = await list(...args);
      if (change === 'learning-off') learning = false;
      if (change === 'contained') contained = true;
      if (change === 'thread-deleted') await ctx.threadStore.put({ ...(await ctx.threadStore.get('userA', 't1'))!, deletedAt: ctx.clock.now() });
      if (change === 'source-deleted' || change === 'source-edited') {
        const source = (await ctx.messageStore.get('userA', 't1', 'u1'))!;
        await ctx.messageStore.append({ ...source, ...(change === 'source-deleted' ? { deletedAt: ctx.clock.now() } : { content: 'Changed before extraction.' }) });
      }
      return page;
    });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(extractor).not.toHaveBeenCalled();
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'ignored', acceptedCount: 0 });
  });

  it('discards a late extractor result after stale-job reconciliation', async () => {
    let ctx!: ReturnType<typeof setup>;
    const enqueue = vi.fn();
    ctx = setup(async () => {
      const recovery = new MemoryDispatchService(ctx.jobStore, { enqueue }, { ...ctx.clock, now: () => '2026-01-01T01:00:00Z' });
      await recovery.reconcile();
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Expired result.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'late' }] };
    });
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'failed', lastErrorCode: 'provider_outcome_unknown' });
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect(ctx.sends).toEqual([]);
    expect(enqueue).not.toHaveBeenCalled();
  });

  it('does not emit a success notice when job completion is unconfirmed', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Concise plans.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'preference' }] }));
    await seedThread(ctx);
    vi.spyOn(ctx.jobStore, 'putIfCurrent').mockResolvedValue(null);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(ctx.sends).toEqual([]);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'running' });
  });

  it.each(['extractor', 'embedding'].flatMap(stage => ['expired', 'replaced'].map(change => ({ stage, change }))))('rejects work after claimed job ownership changes: %j', async ({ stage, change }) => {
    let ctx!: ReturnType<typeof setup>;
    let jobId = '';
    const revoke = async () => {
      const current = (await ctx.jobStore.get('userA', jobId))!;
      await ctx.jobStore.put({ ...current, status: change === 'expired' ? 'failed' : 'running',
        executionToken: change === 'replaced' ? 'replacement-execution' : current.executionToken,
        terminalReason: 'test-owner-changed' });
    };
    ctx = setup(async () => {
      if (stage === 'extractor') await revoke();
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Must not be committed.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'obsolete worker' }] };
    }, { model: 'stub', embed: async () => { if (stage === 'embedding') await revoke(); return [1, 0]; } });
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    jobId = job!.id;
    await ctx.svc.processJob('userA', jobId);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect(await ctx.jobStore.get('userA', jobId)).toMatchObject({ status: change === 'expired' ? 'failed' : 'running', terminalReason: 'test-owner-changed' });
    expect(ctx.sends).toEqual([]);
  });

  it('reuses a persisted assertion when an unfinished job is redelivered outside the candidate window', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'User prefers concise plans.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'same assertion' }] }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    vi.spyOn(ctx.jobStore, 'putIfCurrent').mockRejectedValueOnce(new Error('Completion receipt unavailable'));
    await expect(ctx.svc.processJob('userA', job!.id)).rejects.toThrow('Memory extraction failed.');
    const original = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(original).toHaveLength(1);
    const failed = (await ctx.jobStore.get('userA', job!.id))!;
    await ctx.jobStore.put({ ...failed, status: 'queued' });
    vi.spyOn(ctx.memoryStore, 'list').mockResolvedValueOnce({ memories: [] });
    await ctx.svc.processJob('userA', job!.id);
    const replayed = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(replayed).toHaveLength(1);
    expect(replayed[0].id).toBe(original[0].id);
    expect(replayed[0].sourceRefs).toHaveLength(1);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'completed', acceptedCount: 1 });
  });

  it.each(['deleted', 'approved', 'hash-mismatch', 'missing'] as const)('does not overwrite an inferred creation collision: %s', async condition => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'New assertion.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'same identity' }] }));
    await seedThread(ctx);
    let attemptedId = '';
    vi.spyOn(ctx.memoryStore, 'createIfAbsent').mockImplementationOnce(async record => {
      attemptedId = record.id;
      if (condition !== 'missing') await ctx.memoryStore.put({
        ...record, text: 'Protected existing value.',
        status: condition === 'deleted' ? 'deleted' : 'active',
        confirmation: condition === 'approved' ? 'approved' : 'automatic',
        sourceHash: condition === 'hash-mismatch' ? 'different-content-hash' : record.sourceHash,
      });
      return null;
    });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const current = await ctx.memoryStore.get('userA', attemptedId);
    if (condition === 'missing') expect(current).toBeNull();
    else expect(current?.text).toBe('Protected existing value.');
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
  });

  it('creates one inferred assertion for overlapping source jobs', async () => {
    let arrivals = 0;
    let release!: () => void;
    const barrier = new Promise<void>(resolve => { release = resolve; });
    const ctx = setup(async () => {
      if (++arrivals === 2) release();
      await barrier;
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'User prefers concise plans.', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'same assertion' }] };
    });
    await seedThread(ctx);
    const assistant = (await ctx.messageStore.get('userA', 't1', 'a1'))!;
    await ctx.messageStore.append({ ...assistant, id: 'a2', createdAt: '2026-01-01T00:00:03Z', orderAt: '2026-01-01T00:00:03Z' });
    const first = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    const second = await ctx.svc.enqueueTurn('userA', 't1', 'a2', 'run2');
    await Promise.all([ctx.svc.processJob('userA', first!.id), ctx.svc.processJob('userA', second!.id)]);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toHaveLength(1);
    const firstReceipt = await ctx.jobStore.get('userA', first!.id);
    const secondReceipt = await ctx.jobStore.get('userA', second!.id);
    expect((firstReceipt?.acceptedCount ?? 0) + (secondReceipt?.acceptedCount ?? 0)).toBe(2);
  });

  it('logs only fixed diagnostics after write embedding failures', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Concise plans', confidence: 0.99, salience: 0.9, sourceMessageIds: ['u1'], reason: 'user preference' }] }), {
        model: 'stub', embed: async () => { throw new Error('Private source; provider credential=synthetic'); },
      });
      await seedThread(ctx);
      const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
      await ctx.svc.processJob('userA', job!.id);
      expect(warn).toHaveBeenCalled();
      expect(warn.mock.calls.every(args => args.length === 1 && args[0] === '[memory] write embed failed after retry')).toBe(true);
    } finally {
      warn.mockRestore();
    }
  });

  it('does not persist or propagate provider error payloads from failed extraction', async () => {
    const ctx = setup(async () => { throw new Error('Private source payload; api-key=synthetic-secret'); });
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await expect(ctx.svc.processJob('userA', job!.id)).rejects.toThrow(/^Memory extraction failed\.$/);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({
      status: 'failed', lastErrorCode: 'extract_failed', lastErrorMessage: 'Memory extraction failed.',
    });
  });

  it.each([false, true])('deduplicates successful adds within one batch (first write fails=%s)', async failFirst => {
    const ctx = setup(async () => ({ operations: ['New preference', 'New   preference', 'new preference'].map(text => ({
      op: 'add' as const, sensitivity: 'normal' as const, kind: 'preference' as const, text, confidence: 0.99, salience: 0.9,
      sourceMessageIds: ['u1'], reason: 'same assertion',
    })) }));
    await seedThread(ctx);
    if (failFirst) vi.spyOn(ctx.memoryStore, 'createIfAbsent').mockRejectedValueOnce(new Error('Write unavailable'));
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const records = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(records).toHaveLength(1);
    expect(records[0].revision).toBe(failFirst ? 2 : 3);
    expect(records[0].sourceRefs).toHaveLength(1);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: failFirst ? 2 : 3, rejectedCount: failFirst ? 1 : 0 });
  });

  it.each(['command', 'turn'] as const)('rejects a queued %s job whose target source revision changed', async kind => {
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const targetId = kind === 'command' ? 'u1' : 'a1';
    const job = kind === 'command'
      ? await ctx.svc.enqueueCommand('userA', 't1', targetId, 'run')
      : await ctx.svc.enqueueTurn('userA', 't1', targetId, 'run');
    const target = (await ctx.messageStore.get('userA', 't1', targetId))!;
    await ctx.messageStore.append({ ...target, content: 'A revised statement after enqueue' });
    await ctx.svc.processJob('userA', job!.id);
    expect(extractor).not.toHaveBeenCalled();
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'ignored', acceptedCount: 0, terminalReason: 'source_missing_or_changed' });
  });

  it.each(['deleted', 'approved', 'contained', 'conflict', 'success'] as const)('conditionally suppresses only eligible unchanged memories: %s', async outcome => {
    let contained = false;
    const ctx = setup(async () => ({ operations: [{ op: 'suppress', memoryId: 'existing', sourceMessageIds: ['u1'], reason: 'no longer relevant' }] }), undefined, undefined, undefined, () => contained);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'existing', userId: 'userA', kind: 'fact', status: 'active', text: 'Existing fact',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    const get = ctx.memoryStore.get.bind(ctx.memoryStore);
    let changed = false;
    vi.spyOn(ctx.memoryStore, 'get').mockImplementation(async (userId, memoryId) => {
      const snapshot = await get(userId, memoryId);
      if (!changed && snapshot) {
        changed = true;
        if (outcome === 'contained') contained = true;
        if (outcome === 'deleted') await ctx.memoryStore.put({ ...snapshot, status: 'deleted' });
        if (outcome === 'approved') await ctx.memoryStore.put({ ...snapshot, confirmation: 'approved', text: 'User correction', revision: 2 });
      }
      return snapshot;
    });
    if (outcome === 'conflict') vi.spyOn(ctx.memoryStore, 'putIfRevision').mockResolvedValue(null);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const current = await get('userA', 'existing');
    if (outcome === 'success') expect(current).toMatchObject({ status: 'suppressed', revision: 2 });
    else if (outcome === 'deleted') expect(current?.status).toBe('deleted');
    else if (outcome === 'approved') expect(current).toMatchObject({ status: 'active', confirmation: 'approved', text: 'User correction', revision: 2 });
    else expect(current).toMatchObject({ status: 'active', revision: 1 });
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: outcome === 'success' ? 1 : 0 });
  });

  it.each(['contained', 'source-edited', 'excluded', 'write-failed', 'store-conflict', 'embedding-failed', 'zero-vector', 'non-finite-vector', 'approved', 'success'] as const)('creates replacements before guarded supersession: %s', async condition => {
    let contained = false;
    let ctx!: ReturnType<typeof setup>;
    const embedder: Embedder = { model: 'test-embed', embed: async () => {
      if (condition === 'embedding-failed') throw new Error('Embedding unavailable');
      if (condition === 'zero-vector') return [0, 0];
      if (condition === 'non-finite-vector') return [Infinity, 1];
      if (condition === 'contained') contained = true;
      if (condition === 'source-edited') {
        const source = (await ctx.messageStore.get('userA', 't1', 'u1'))!;
        await ctx.messageStore.append({ ...source, content: 'Changed source' });
      }
      if (condition === 'excluded') {
        const current = (await ctx.memoryStore.get('userA', 'old'))!;
        await ctx.memoryStore.exclude(current, { id: 'exclusion', userId: 'userA', memoryId: 'old', sourceKeys: ['message:t1:u1:'], excludedAt: ctx.clock.now() }, current.revision ?? 1);
      }
      return [1, 0];
    } };
    ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'fact', text: 'New replacement', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], supersedes: ['old'], reason: 'replacement' }] }), embedder, undefined, undefined, () => contained);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'old', userId: 'userA', kind: 'fact', status: 'active', text: 'Old fact',
      origin: 'inferred', confirmation: condition === 'approved' ? 'approved' : 'automatic', revision: 1,
      confidence: 0.9, salience: 0.9, pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      embedding: [0, 1], embeddingModel: 'test-embed',
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    const mutations: string[] = [];
    const put = ctx.memoryStore.put.bind(ctx.memoryStore);
    vi.spyOn(ctx.memoryStore, 'put').mockImplementation(async record => {
      mutations.push(`${record.id}:${record.status}`);
      return put(record);
    });
    const create = ctx.memoryStore.createIfAbsent.bind(ctx.memoryStore);
    vi.spyOn(ctx.memoryStore, 'createIfAbsent').mockImplementation(async (record, predecessors) => {
      mutations.push(`${record.id}:${record.status}`);
      if (condition === 'write-failed') throw new Error('Persist failure');
      if (condition === 'store-conflict') return null;
      return create(record, predecessors);
    });
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const records = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    if (condition === 'success') {
      expect((await ctx.memoryStore.get('userA', 'old'))?.status).toBe('invalidated');
      expect(records.some(record => record.text === 'New replacement')).toBe(true);
      expect(mutations[0]).not.toBe('old:invalidated');
    } else {
      expect((await ctx.memoryStore.get('userA', 'old'))?.status).toBe('active');
      if (condition !== 'approved') expect(records.map(record => record.text)).toEqual(['Old fact']);
    }
  });

  it.each(['containment', 'source', 'deletion', 'approval', 'retry-revoked'] as const)('rejects a merge invalidated during embedding: %s', async change => {
    let contained = false;
    let ctx!: ReturnType<typeof setup>;
    let embedCalls = 0;
    const embedder: Embedder = { model: 'test-embed', embed: async () => {
      embedCalls += 1;
      if (change === 'retry-revoked') { contained = true; throw new Error('Embedding unavailable'); }
      if (change === 'containment') contained = true;
      if (change === 'source') {
        const source = (await ctx.messageStore.get('userA', 't1', 'u1'))!;
        await ctx.messageStore.append({ ...source, content: 'Changed source statement' });
      }
      if (change === 'deletion') await new MemoryService(ctx.memoryStore, ctx.clock).delete('userA', 'existing');
      if (change === 'approval') {
        const current = (await ctx.memoryStore.get('userA', 'existing'))!;
        await ctx.memoryStore.put({ ...current, text: 'User-approved edit', confirmation: 'approved', revision: 2 });
      }
      return [1, 0];
    } };
    ctx = setup(async () => ({ operations: [{ op: 'merge', sensitivity: 'normal' as const, memoryId: 'existing', text: 'Stale proposed edit', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'merge' }] }), embedder, undefined, undefined, () => contained);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'existing', userId: 'userA', kind: 'fact', status: 'active', text: 'Existing fact',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      embedding: [0, 1], embeddingModel: 'test-embed', createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const current = await ctx.memoryStore.get('userA', 'existing');
    expect(current?.text).not.toBe('Stale proposed edit');
    if (change === 'deletion') expect(current?.status).toBe('deleted');
    if (change === 'approval') expect(current).toMatchObject({ text: 'User-approved edit', confirmation: 'approved', revision: 2,
      embeddingTextHash: memoryEmbeddingTextHash('User-approved edit') });
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
    if (change === 'retry-revoked') expect(embedCalls).toBe(1);
  });

  it.each(['success', 'failed', 'unchanged'] as const)('keeps merged text, content hash and embedding consistent: %s', async outcome => {
    const embed = vi.fn(async () => {
      if (outcome === 'failed') throw new Error('Embedding unavailable');
      return [1, 0];
    });
    const nextText = outcome === 'unchanged' ? 'Existing fact' : 'Updated fact';
    const ctx = setup(async () => ({ operations: [{ op: 'merge', sensitivity: 'normal' as const, memoryId: 'existing', text: nextText, sourceMessageIds: ['u1'], reason: 'new evidence' }] }), { model: 'test-embed', embed });
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'existing', userId: 'userA', kind: 'fact', status: 'active', text: 'Existing fact',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      sourceHash: 'old-content-hash', embedding: [0, 1], embeddingModel: 'test-embed',
      embeddingTextHash: memoryEmbeddingTextHash('Existing fact'),
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const current = (await ctx.memoryStore.get('userA', 'existing'))!;
    if (outcome === 'failed') {
      expect(current).toMatchObject({
        text: 'Existing fact', sourceHash: 'old-content-hash', revision: 1,
        embedding: [0, 1], embeddingModel: 'test-embed',
      });
      expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
    } else {
      expect(current.text).toBe(nextText);
      expect(current.sourceHash).not.toBe('old-content-hash');
      expect(current.embedding).toEqual(outcome === 'unchanged' ? [0, 1] : [1, 0]);
      expect(current.embeddingModel).toBe('test-embed');
    }
    if (outcome === 'unchanged') expect(embed).not.toHaveBeenCalled();
    expect(current.embeddingTextHash).toBe(memoryEmbeddingTextHash(current.text));
  });

  it.each([false, true])('counts a guarded merge only after successful revision write (conflict=%s)', async conflict => {
    const ctx = setup(async () => ({ operations: [{ op: 'merge', sensitivity: 'normal' as const, memoryId: 'existing', text: 'Updated fact', sourceMessageIds: ['u1'], reason: 'new evidence' }] }));
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'existing', userId: 'userA', kind: 'fact', status: 'active', text: 'Existing fact',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    if (conflict) vi.spyOn(ctx.memoryStore, 'putIfRevision').mockResolvedValue(null);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: conflict ? 0 : 1, rejectedCount: conflict ? 1 : 0 });
    expect((await ctx.memoryStore.get('userA', 'existing'))?.text).toBe(conflict ? 'Existing fact' : 'Updated fact');
  });

  it.each([['a1'], ['u1', 'a1'], [], ['unknown']].map(ids => ({ ids })))('rejects operations with assistant, mixed, absent or unknown source evidence: %j', async ({ ids }) => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'fact', text: 'Must not be accepted', confidence: 0.99, salience: 0.99, sourceMessageIds: ids, reason: 'unverified' }] }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ acceptedCount: 0, rejectedCount: 1 });
  });

  it('detects source edits beyond the stored quote prefix even when chronology is unchanged', async () => {
    const prefix = 'x'.repeat(600);
    let ctx!: ReturnType<typeof setup>;
    ctx = setup(async () => {
      const source = (await ctx.messageStore.get('userA', 't1', 'u1'))!;
      source.content = prefix + 'changed user statement';
      await ctx.messageStore.append(source);
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'fact', text: 'Stale extracted statement', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'stale' }] };
    });
    await seedThread(ctx, false, prefix + 'original user statement');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
  });

  it('deduplicates explicit user sources instead of counting the same quote twice', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'User prefers concise plans', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1', 'u1'], reason: 'user statement' }] }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const records = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(records).toHaveLength(1);
    expect(records[0].sourceRefs).toHaveLength(1);
  });

  it.each([{ userId: 'foreign-owner' }, { threadId: 'foreign-thread' }])('rejects foreign source records even when returned by the window store: %j', async fields => {
    const extractor = vi.fn(async () => ({ operations: [{ op: 'add' as const, sensitivity: 'normal' as const, kind: 'fact' as const, text: 'Untrusted statement', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'foreign' }] }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    const list = ctx.messageStore.list.bind(ctx.messageStore);
    vi.spyOn(ctx.messageStore, 'list').mockImplementation(async (...arguments_) =>
      (await list(...arguments_)).map(message => message.id === 'u1' ? { ...message, ...fields } : message));
    await ctx.svc.processJob('userA', job!.id);
    expect(extractor).not.toHaveBeenCalled();
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
  });

  it('rejects a source whose speaker changes during extraction', async () => {
    let ctx!: ReturnType<typeof setup>;
    ctx = setup(async () => {
      const get = ctx.messageStore.get.bind(ctx.messageStore);
      vi.spyOn(ctx.messageStore, 'get').mockImplementation(async (...arguments_) => {
        const message = await get(...arguments_);
        return message?.id === 'u1' ? { ...message, role: 'assistant' } : message;
      });
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'fact', text: 'Changed speaker', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'stale speaker' }] };
    });
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
  });

  it('blocks new and already-queued extraction work when release containment activates', async () => {
    let contained = false;
    const extractor = vi.fn(async () => ({ operations: [] }));
    const ctx = setup(extractor, undefined, undefined, undefined, () => contained);
    await seedThread(ctx);
    const queued = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(queued).not.toBeNull();

    contained = true;
    await expect(ctx.svc.enqueueCommand('userA', 't1', 'u1', 'run2')).resolves.toBeNull();
    await ctx.svc.processJob('userA', queued!.id);

    expect(extractor).not.toHaveBeenCalled();
    expect(await ctx.jobStore.get('userA', queued!.id)).toMatchObject({
      status: 'ignored',
      terminalReason: 'policy_or_source_ineligible',
      acceptedCount: 0,
    });
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
  });

  it('enqueues turn jobs idempotently and applies LLM add output', async () => {
    const extractor = vi.fn(async () => ({
      operations: [{ op: 'add' as const, sensitivity: 'normal' as const, kind: 'preference' as const, text: 'User prefers concise implementation plans.', confidence: 0.92, salience: 0.8, sourceMessageIds: ['u1'], reason: 'Stable preference.' }],
    }));
    const ctx = setup(extractor);
    await seedThread(ctx);
    const first = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    const second = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(first?.id).toBe(second?.id);
    expect(ctx.enqueued).toEqual([first?.id]);

    await ctx.svc.processJob('userA', first!.id);
    await ctx.svc.processJob('userA', first!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ kind: 'preference', text: 'User prefers concise implementation plans.' });
    expect(memories[0].sourceRefs[0]).toMatchObject({ type: 'message', threadId: 't1', messageId: 'u1' });
    expect((await ctx.jobStore.get('userA', first!.id))?.status).toBe('completed');
    expect(extractor).toHaveBeenCalledTimes(1);
    expect(ctx.sends).toEqual([{ target: 'memory', payload: expect.objectContaining({ acceptedCount: 1, threadId: 't1', assistantMessageId: 'a1' }) }]);
  });

  it('lets only one simultaneous duplicate delivery claim the extraction job', async () => {
    let release!: () => void;
    const blocked = new Promise<void>((resolve) => { release = resolve; });
    const extractor = vi.fn(async () => {
      await blocked;
      return { operations: [{ op: 'ignore' as const, reason: 'done once' }] };
    });
    const ctx = setup(extractor);
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    const first = ctx.svc.processJob('userA', job!.id);
    const second = ctx.svc.processJob('userA', job!.id);
    await vi.waitFor(() => expect(extractor).toHaveBeenCalledTimes(1));
    release();
    await Promise.all([first, second]);
    expect(extractor).toHaveBeenCalledTimes(1);
    expect((await ctx.jobStore.get('userA', job!.id))?.attempts).toBe(1);
  });

  it('keeps accepted learning work pending when immediate queue dispatch fails', async () => {
    const ctx = setup(
      async () => ({ operations: [{ op: 'ignore', reason: 'unused' }] }),
      undefined,
      undefined,
      { enqueue: async () => { throw new Error('queue unavailable'); } },
    );
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(job?.status).toBe('queued');
    await expect(ctx.jobStore.listPendingDispatch()).resolves.toMatchObject([{ jobId: job?.id, state: 'pending' }]);
  });

  it('does not recreate a deleted memory when extraction is replayed with a paraphrase from the same source', async () => {
    let invocation = 0;
    const ctx = setup(async () => ({
      operations: [{
        op: 'add', sensitivity: 'normal' as const, kind: 'preference',
        text: invocation++ === 0 ? 'User prefers concise implementation plans.' : 'Keep implementation plans brief.',
        confidence: 0.95, salience: 0.9, sourceMessageIds: ['u1'], reason: 'same lineage',
      }],
    }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    const [created] = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    await new MemoryService(ctx.memoryStore, ctx.clock).delete('userA', created.id);

    await ctx.svc.processJob('userA', job!.id);

    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
  });

  it('does not let automatic extraction overwrite an approved correction', async () => {
    const ctx = setup(async () => ({ operations: [{
      op: 'merge', sensitivity: 'normal' as const, memoryId: 'approved', text: 'Automatic replacement', confidence: 0.99, salience: 0.99,
      sourceMessageIds: ['u1'], reason: 'must not replace approved value',
    }] }));
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'approved', userId: 'userA', kind: 'preference', status: 'active', text: 'User-approved value',
      confidence: 1, salience: 0.8, pinned: true, sensitive: false, visibility: 'top_of_mind', useCount: 0,
      origin: 'manual', confirmation: 'approved', revision: 3,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    }));
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    await expect(ctx.memoryStore.get('userA', 'approved')).resolves.toMatchObject({ text: 'User-approved value', revision: 3 });
  });

  it('commits zero memories when learning is revoked while extraction is running', async () => {
    let enabled = true;
    const settings = { get: async () => ({
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memoryEnabled: enabled,
        memory: { enabled, paused: false, referenceSaved: enabled, referenceHistory: enabled, autoExtract: enabled },
      },
    }) };
    const ctx = setup(async () => {
      enabled = false;
      return { operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Must not persist.', confidence: 0.99, salience: 0.99, sourceMessageIds: ['u1'], reason: 'revoked' }] };
    }, undefined, settings);
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'ignored', terminalReason: 'policy_revoked' });
  });

  it('rejects mutation when a source message is deleted during extraction', async () => {
    let ctx: ReturnType<typeof setup>;
    ctx = setup(async () => {
      await ctx.messageStore.delete('userA', 't1', 'u1');
      return { operations: [{
        op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'Must not persist.', confidence: 0.99, salience: 0.99,
        sourceMessageIds: ['u1'], reason: 'source deleted',
      }] };
    });
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect(await ctx.jobStore.get('userA', job!.id)).toMatchObject({ status: 'ignored', terminalReason: 'no_operations_accepted' });
  });

  it('records ignored decisions and rejects one-off/low-confidence output', async () => {
    const ctx = setup(async () => ({
      operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'User wants this answer to be poetic.', confidence: 0.2, salience: 0.2, sourceMessageIds: ['u1'], reason: 'Too weak.' }],
    }));
    await seedThread(ctx);
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);
    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await ctx.jobStore.get('userA', job!.id))?.status).toBe('ignored');
    expect(ctx.sends).toEqual([]);
  });

  it('requires stronger scores for automatic turn extraction than explicit command extraction', async () => {
    const extractor: MemoryExtractorPort = async () => ({
      operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'preference', text: 'User prefers occasional poetic phrasing.', confidence: 0.75, salience: 0.6, sourceMessageIds: ['u1'], reason: 'Moderate signal.' }],
    });
    const automatic = setup(extractor);
    await seedThread(automatic);
    const turnJob = await automatic.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await automatic.svc.processJob('userA', turnJob!.id);
    expect((await automatic.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await automatic.jobStore.get('userA', turnJob!.id))?.status).toBe('ignored');

    const explicit = setup(extractor);
    await seedThread(explicit);
    const commandJob = await explicit.svc.enqueueCommand('userA', 't1', 'u1', 'run1');
    await explicit.svc.processJob('userA', commandJob!.id);
    expect((await explicit.memoryStore.list('userA', { status: 'active' })).memories).toHaveLength(1);
    expect((await explicit.jobStore.get('userA', commandJob!.id))?.status).toBe('completed');
  });

  it('enqueues substantive turns and lets the extractor decide to ignore non-durable content', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'No durable memory.' }] }));
    await seedThread(ctx, false, 'Write a debounce hook in TypeScript.');

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(job).not.toBeNull();
    await ctx.svc.processJob('userA', job!.id);

    expect((await ctx.memoryStore.list('userA', { status: 'active' })).memories).toEqual([]);
    expect((await ctx.jobStore.get('userA', job!.id))?.status).toBe('ignored');
    expect(ctx.sends).toEqual([]);
  });

  it('captures a keyword-free personal fact spread across short turns', async () => {
    const ctx = setup(async () => ({
      operations: [{ op: 'add', sensitivity: 'normal' as const, kind: 'fact', text: 'User has a dog named Chopper, a Lhasa Apso.', confidence: 0.9, salience: 0.85, sourceMessageIds: ['u2'], reason: 'Durable personal fact.' }],
    }));
    // No gate keyword ("my dog", "I have") anywhere — the extractor alone decides.
    await ctx.threadStore.put({ id: 't1', userId: 'userA', title: 'T', pinned: false, archived: false, temporary: false, messageCount: 4, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'u1', threadId: 't1', userId: 'userA', role: 'user', content: 'we finally caved and got a little guy', status: 'complete', createdAt: '2026-01-01T00:00:01Z', orderAt: '2026-01-01T00:00:01Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'a1', threadId: 't1', userId: 'userA', role: 'assistant', content: 'congrats! tell me about him', status: 'complete', createdAt: '2026-01-01T00:00:02Z', orderAt: '2026-01-01T00:00:02Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'u2', threadId: 't1', userId: 'userA', role: 'user', content: "he's a lhasa apso, we went with Chopper", status: 'complete', createdAt: '2026-01-01T00:00:03Z', orderAt: '2026-01-01T00:00:03Z', deletedAt: null });
    await ctx.messageStore.append({ id: 'a2', threadId: 't1', userId: 'userA', role: 'assistant', content: 'Chopper is a great name!', status: 'complete', createdAt: '2026-01-01T00:00:04Z', orderAt: '2026-01-01T00:00:04Z', deletedAt: null });

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a2', 'run1');
    expect(job).not.toBeNull();
    await ctx.svc.processJob('userA', job!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0]).toMatchObject({ kind: 'fact', text: 'User has a dog named Chopper, a Lhasa Apso.' });
  });

  it('passes the full threaded conversation (not just the last few messages) to the extractor', async () => {
    let seen: Array<{ id: string; role: string }> = [];
    const ctx = setup(async (_creds, input) => {
      seen = input.messages.map((m) => ({ id: m.id, role: m.role }));
      return { operations: [{ op: 'ignore', reason: 'context only' }] };
    });
    await ctx.threadStore.put({ id: 't1', userId: 'userA', title: 'T', pinned: false, archived: false, temporary: false, messageCount: 8, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', deletedAt: null });
    // The thread's framing ("a speech for my son") is the FIRST message — outside the old 5-message
    // window. The extractor must still receive it so it can attribute the later speech lines correctly.
    const seq: Array<[string, 'user' | 'assistant', string]> = [
      ['u1', 'user', 'Help me write a school speech for my 5-year-old son.'],
      ['a1', 'assistant', 'Sure — share the details.'],
      ['u2', 'user', 'one moment'],
      ['a2', 'assistant', 'Take your time.'],
      ['u3', 'user', 'here goes'],
      ['a3', 'assistant', 'Ready.'],
      ['u4', 'user', 'My school is Keystone. I like cars. My favorite place is Fun Zone.'],
      ['a4', 'assistant', 'Done — here is the speech.'],
    ];
    let s = 1;
    for (const [id, role, content] of seq) {
      await ctx.messageStore.append({ id, threadId: 't1', userId: 'userA', role, content, status: 'complete', createdAt: `2026-01-01T00:00:0${s}Z`, orderAt: `2026-01-01T00:00:0${s}Z`, deletedAt: null });
      s++;
    }
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a4', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    // All eight messages reach the extractor (the old window would have dropped u1/a1/u2).
    expect(seen.map((m) => m.id)).toEqual(['u1', 'a1', 'u2', 'a2', 'u3', 'a3', 'u4', 'a4']);
  });

  it('mechanically skips trivial windows without calling the extractor', async () => {
    let called = false;
    const ctx = setup(async () => {
      called = true;
      return { operations: [{ op: 'ignore', reason: 'x' }] };
    });
    await seedThread(ctx, false, 'ok');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    expect(job).toBeNull();
    expect(ctx.enqueued).toEqual([]);
    expect(called).toBe(false);
  });

  it('does not enqueue for temporary threads', async () => {
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'x' }] }));
    await seedThread(ctx, true);
    await expect(ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1')).resolves.toBeNull();
    expect(ctx.enqueued).toEqual([]);
  });

  it('does not auto-commit or enqueue while learning mode is review', async () => {
    const settings = { get: async () => ({
      ...DEFAULT_SETTINGS,
      personalization: {
        ...DEFAULT_SETTINGS.personalization,
        memory: { ...DEFAULT_SETTINGS.personalization.memory!, learnChats: 'review' as const },
      },
    }) };
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'review' }] }), undefined, settings);
    await seedThread(ctx);
    await expect(ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1')).resolves.toBeNull();
    expect(ctx.enqueued).toEqual([]);
  });

  it('persists the routed target proposed by the planner', async () => {
    const ctx = setup(async () => ({
      operations: [{
        op: 'add', sensitivity: 'normal' as const,
        kind: 'fact',
        text: 'User has a daughter named Laija who is 9 years old.',
        target: {
          layer: 'long_term_profile',
          profilePath: 'user.family.children',
          entity: { type: 'family_member', name: 'Laija' },
          relationship: { predicate: 'HAS_FAMILY_MEMBER', object: { type: 'family_member', name: 'Laija' }, attributes: { relationship: 'daughter', age: 9 } },
          temporal: { bucket: 'long_term' },
          evidenceStrategy: 'merge',
        },
        confidence: 0.94,
        salience: 0.88,
        sourceMessageIds: ['u1'],
        reason: 'Stable family profile fact.',
      }],
    }));
    await seedThread(ctx, false, 'My daughter is named Laija and she is 9.');
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    const memories = (await ctx.memoryStore.list('userA', { status: 'active' })).memories;
    expect(memories).toHaveLength(1);
    expect(memories[0].route).toMatchObject({ layer: 'long_term_profile', profilePath: 'user.family.children' });
    expect(memories[0].route?.relationship?.attributes).toMatchObject({ relationship: 'daughter', age: 9 });
  });

  it('backfills embeddings for active memories that lack a current-model vector', async () => {
    const embedder: Embedder = { model: 'stub-embed', embed: async (_c, text) => [text.length % 5, 1, 0] };
    const ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'nothing durable' }] }), embedder);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'old', userId: 'userA', kind: 'fact', status: 'active', text: 'User likes tea.',
      confidence: 0.9, salience: 0.7, pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'manual', createdAt: '2026-01-01T00:00:00Z' }],
    }));

    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run1');
    await ctx.svc.processJob('userA', job!.id);

    const healed = (await ctx.memoryStore.list('userA', { status: 'active' })).memories.find((m) => m.id === 'old');
    expect(healed?.embedding?.length).toBeGreaterThan(0);
    expect(healed?.embeddingModel).toBe('stub-embed');
  });

  it.each(['deleted', 'contained', 'edited', 'excluded', 'execution-revoked'] as const)('discards stale backfill results when the memory becomes %s', async change => {
    let contained = false;
    let ctx!: ReturnType<typeof setup>;
    const embedder: Embedder = { model: 'stub-embed', embed: async () => {
      const current = (await ctx.memoryStore.get('userA', 'backfill-target'))!;
      if (change === 'deleted') await new MemoryService(ctx.memoryStore, ctx.clock).delete('userA', current.id);
      if (change === 'contained') contained = true;
      if (change === 'execution-revoked') await ctx.jobStore.put({ ...(await ctx.jobStore.get('userA', job!.id))!, status: 'failed', terminalReason: 'execution_revoked' });
      if (change === 'edited') await ctx.memoryStore.put({ ...current, text: 'New approved value', confirmation: 'approved', revision: 2 });
      if (change === 'excluded') await ctx.memoryStore.exclude(current, { id: 'excluded', userId: 'userA', memoryId: current.id, sourceHash: current.sourceHash, sourceKeys: ['message:t1:u1:'], excludedAt: ctx.clock.now() }, current.revision ?? 1);
      return [1, 0];
    } };
    ctx = setup(async () => ({ operations: [{ op: 'ignore', reason: 'backfill only' }] }), embedder, undefined, undefined, () => contained);
    await seedThread(ctx);
    await ctx.memoryStore.put(parseMemoryRecord({
      id: 'backfill-target', userId: 'userA', kind: 'fact', status: 'active', text: 'Original value',
      origin: 'inferred', confirmation: 'automatic', revision: 1, confidence: 0.9, salience: 0.9,
      pinned: false, sensitive: false, visibility: 'normal', useCount: 0,
      createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'u1', createdAt: '2026-01-01T00:00:01Z' }],
    }));
    const job = await ctx.svc.enqueueTurn('userA', 't1', 'a1', 'run');
    await ctx.svc.processJob('userA', job!.id);
    const after = await ctx.memoryStore.get('userA', 'backfill-target');
    expect(after?.embedding).toBeUndefined();
    if (change === 'deleted') expect(after?.status).toBe('deleted');
    if (change === 'edited') expect(after).toMatchObject({ text: 'New approved value', revision: 2 });
  });
});