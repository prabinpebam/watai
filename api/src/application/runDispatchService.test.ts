import { describe, expect, it, vi } from 'vitest';
import { InMemoryRunStore } from '../adapters/memory/runStore';
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
