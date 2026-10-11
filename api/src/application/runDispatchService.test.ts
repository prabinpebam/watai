import { describe, expect, it, vi } from 'vitest';
import { InMemoryRunStore } from '../adapters/memory/runStore';
import { CosmosRunStore } from '../adapters/cosmos/runStore';
import { ownerScopedDocumentId } from '../adapters/cosmos/ownerScopedId';
import type { RunStarter } from '../ports/runStarter';
import type { RunRecord } from '../ports/runStore';
import { RunDispatchService } from './runDispatchService';

const clock = { newId: () => 'id', now: () => '2026-01-01T00:00:10Z' };

function run(overrides: Partial<RunRecord> = {}): RunRecord {
  return {
    id: 'run-1', threadId: 'thread-1', userId: 'user-1', assistantMessageId: 'assistant-1',
    status: 'queued', tools: [], allowDestructive: [], createdAt: '2026-01-01T00:00:00Z',
    heartbeatAt: '2026-01-01T00:00:00Z', releaseId: 'release-1', executionToken: 'token-1',
    dispatchAttempt: 1, ...overrides,
  };
}

async function admit(store: InMemoryRunStore, record = run()): Promise<void> {
  await store.admit({ run: record, idempotencyKey: 'message-1', requestFingerprint: 'fingerprint', legacyMessageExists: false });
}

describe('RunDispatchService', () => {
  it.each(['read', 'discard-ack'] as const)('isolates a dispatch %s failure without starving the next accepted run', async stage => {
    const store = new InMemoryRunStore();
    await admit(store);
    await admit(store, run({ id: 'run-2', threadId: 'thread-2' }));
    if (stage === 'read') vi.spyOn(store, 'get').mockRejectedValueOnce(new Error('Read unavailable'));
    else {
      await store.put(run({ executionToken: 'changed-token' }));
      vi.spyOn(store, 'markDispatchSent').mockRejectedValueOnce(new Error('Acknowledgement unavailable'));
    }
    const start = vi.fn(async () => ({ instanceId: 'instance-2' }));
    const result = await new RunDispatchService(store, { start, cancel: async () => {} }, clock).reconcile();
    expect(result).toEqual({ inspected: 2, sent: 1, discarded: 0, failed: 1 });
    expect(start).toHaveBeenCalledOnce();
    expect(start).toHaveBeenCalledWith(expect.objectContaining({ id: 'run-2', threadId: 'thread-2' }));
    expect((await store.listPendingDispatch()).map(record => record.runId)).toEqual(['run-1']);
  });

  it('does not attach a delayed starter receipt to a replacement queued execution', async () => {
    const store = new InMemoryRunStore();
    await admit(store);
    const replacement = run({ executionToken: 'replacement-token', dispatchAttempt: 2 });
    const start = vi.fn(async () => { await store.put(replacement); return { instanceId: 'obsolete-instance' }; });
    await new RunDispatchService(store, { start, cancel: async () => {} }, clock).reconcile();
    expect(start).toHaveBeenCalledOnce();
    expect(await store.get('user-1', 'thread-1', 'run-1')).toEqual(replacement);
  });

  it.each(['release', 'token', 'attempt', 'missing-etag', 'success'] as const)('requires exact conditional dispatch acknowledgement: %s', async state => {
    const memory = new InMemoryRunStore();
    await admit(memory);
    const original = (await memory.listPendingDispatch())[0];
    const supplied = { ...original,
      ...(state === 'release' ? { releaseId: 'different-release' } : {}),
      ...(state === 'token' ? { executionToken: 'different-token' } : {}),
      ...(state === 'attempt' ? { attempt: 2 } : {}),
    };
    const replace = vi.fn(async (_record, options) => {
      expect(options).toEqual({ accessCondition: { type: 'IfMatch', condition: 'dispatch-etag' } });
    });
    const cosmos = new CosmosRunStore({ item: () => ({ read: async () => ({ resource: {
      ...original, id: ownerScopedDocumentId('run-dispatch', original.userId, original.runId), recordType: 'run-dispatch',
      _etag: state === 'missing-etag' ? undefined : 'dispatch-etag',
    } }), replace }) } as never);
    if (state === 'missing-etag') await expect(cosmos.markDispatchSent(supplied, clock.now())).rejects.toThrow('Run dispatch acknowledgement requires a Cosmos ETag.');
    else {
      await cosmos.markDispatchSent(supplied, clock.now());
      await memory.markDispatchSent(supplied, clock.now());
      expect(await memory.listPendingDispatch()).toHaveLength(state === 'success' ? 0 : 1);
    }
    expect(replace).toHaveBeenCalledTimes(state === 'success' ? 1 : 0);
  });

  it.each(['heartbeat', 'execution', 'unchanged'] as const)('revalidates the exact stale running snapshot before recovery: %s', async change => {
    const store = new InMemoryRunStore();
    const stale = run({ status: 'running', heartbeatAt: '2025-12-31T22:00:00Z' });
    await store.put(stale);
    const current = { ...stale, ...(change === 'heartbeat' ? { heartbeatAt: clock.now() } : {}),
      ...(change === 'execution' ? { executionToken: 'new-execution' } : {}) };
    vi.spyOn(store, 'listStaleActive').mockImplementationOnce(async () => { await store.put(current); return [stale]; });
    const start = vi.fn();
    await new RunDispatchService(store, { start, cancel: async () => {} }, clock).reconcile();
    if (change === 'unchanged') expect(await store.get(stale.userId, stale.threadId, stale.id)).toMatchObject({ status: 'error', error: { code: 'provider_outcome_unknown' } });
    else expect(await store.get(stale.userId, stale.threadId, stale.id)).toEqual(current);
    expect(start).not.toHaveBeenCalled();
  });

  it('retries pending accepted work once and records transport acknowledgement', async () => {
    const store = new InMemoryRunStore();
    await admit(store);
    const start = vi.fn(async () => ({ instanceId: 'instance-1' }));
    const service = new RunDispatchService(store, { start, cancel: async () => {} }, clock);

    await expect(service.reconcile()).resolves.toEqual({ inspected: 1, sent: 1, discarded: 0, failed: 0 });
    await expect(service.reconcile()).resolves.toEqual({ inspected: 0, sent: 0, discarded: 0, failed: 0 });
    expect(start).toHaveBeenCalledTimes(1);
    await expect(store.get('user-1', 'thread-1', 'run-1')).resolves.toMatchObject({ instanceId: 'instance-1' });
  });

  it('keeps a pending dispatch after transient queue failure', async () => {
    const store = new InMemoryRunStore();
    await admit(store);
    const starter: RunStarter = { start: async () => { throw new Error('queue unavailable'); }, cancel: async () => {} };
    const service = new RunDispatchService(store, starter, clock);

    await expect(service.reconcile()).resolves.toEqual({ inspected: 1, sent: 0, discarded: 0, failed: 1 });
    await expect(store.listPendingDispatch()).resolves.toHaveLength(1);
  });

  it('never dispatches stale release or execution-token authority', async () => {
    const store = new InMemoryRunStore();
    await admit(store);
    await store.put(run({ releaseId: 'release-2', executionToken: 'token-2' }));
    const start = vi.fn(async () => ({ instanceId: 'instance' }));
    const service = new RunDispatchService(store, { start, cancel: async () => {} }, clock);

    await expect(service.reconcile()).resolves.toEqual({ inspected: 1, sent: 0, discarded: 1, failed: 0 });
    expect(start).not.toHaveBeenCalled();
    await expect(store.listPendingDispatch()).resolves.toHaveLength(0);
  });

  it('terminalizes stale running work as outcome-unknown without provider replay', async () => {
    const store = new InMemoryRunStore();
    await admit(store, run({ status: 'running', heartbeatAt: '2025-12-31T22:00:00Z' }));
    await store.markDispatchSent((await store.listPendingDispatch())[0], clock.now());
    const start = vi.fn(async () => ({ instanceId: 'never' }));
    await new RunDispatchService(store, { start, cancel: async () => {} }, clock).reconcile();
    expect(start).not.toHaveBeenCalled();
    await expect(store.get('user-1', 'thread-1', 'run-1')).resolves.toMatchObject({
      status: 'error', error: { code: 'provider_outcome_unknown' },
    });
  });
});
