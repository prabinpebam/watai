import type { Container, OperationInput } from '@azure/cosmos';
import { describe, expect, it, vi } from 'vitest';
import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import { CosmosMemoryJobStore } from './memoryJobStore';
import { InMemoryMemoryJobStore } from '../memory/memoryJobStore';

const job: MemoryExtractionJobRecord = {
  id: 'job-1', userId: 'user-1', threadId: 'thread-1', kind: 'turn', status: 'queued',
  assistantMessageId: 'assistant-1', dedupeKey: 'turn:assistant-1:revision', sourceRevision: 'a'.repeat(64),
  releaseId: 'release-1', executionToken: 'token-1', dispatchAttempt: 1, attempts: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('CosmosMemoryJobStore', () => {
  it.each([[], [201], [201, 201, 201]].map(statuses => ({ statuses })))('rejects incomplete memory admission receipts: %j', async ({ statuses }) => {
    const batch = vi.fn().mockResolvedValue({ result: statuses.map(statusCode => ({ statusCode })) });
    const store = new CosmosMemoryJobStore({ items: { batch } } as never);
    await expect(store.admit(job)).rejects.toThrow('Memory job admission failed');
  });

  it.each(['missing-etag', 'changed-release'] as const)('does not acknowledge a dispatch with %s', async condition => {
    const dispatch = { jobId: job.id, userId: job.userId, releaseId: job.releaseId, executionToken: job.executionToken,
      attempt: job.dispatchAttempt, state: 'pending' as const, createdAt: job.createdAt, updatedAt: job.updatedAt };
    const replace = vi.fn();
    const resource = { ...dispatch, id: `memory-dispatch-${job.id}`, recordType: 'memory-dispatch',
      releaseId: condition === 'changed-release' ? 'other-release' : job.releaseId,
      _etag: condition === 'missing-etag' ? undefined : 'etag' };
    const store = new CosmosMemoryJobStore({ item: () => ({ read: async () => ({ resource }), replace }) } as never);
    await store.markDispatchSent(dispatch, '2026-01-01T00:01:00Z');
    expect(replace).not.toHaveBeenCalled();
  });

  it('queries stale running work with a parameterized cutoff and bounded result limit', async () => {
    const query = vi.fn().mockReturnValue({ fetchAll: async () => ({ resources: [job] }) });
    const store = new CosmosMemoryJobStore({ items: { query } } as never);
    const before = '2026-01-01T00:30:00.000Z';
    expect(await store.listStaleRunning(before, 20)).toEqual([job]);
    expect(query).toHaveBeenCalledWith({
      query: "SELECT * FROM c WHERE c.status = 'running' AND c.updatedAt < @before OFFSET 0 LIMIT @limit",
      parameters: [{ name: '@before', value: before }, { name: '@limit', value: 20 }],
    });
  });

  it.each([
    { id: 'other' }, { userId: 'other' }, { status: 'failed' as const }, { releaseId: 'other' },
    { executionToken: 'other' }, { dispatchAttempt: 2 }, { attempts: 2 }, { updatedAt: 'later' },
  ])('rejects conditional completion for a changed execution snapshot: %j', async changed => {
    const expected = { ...job, status: 'running' as const, attempts: 1 };
    const current = { ...expected, ...changed };
    const replace = vi.fn();
    const cosmos = new CosmosMemoryJobStore({ item: () => ({ read: async () => ({ resource: { ...current, _etag: 'etag' } }), replace }) } as never);
    const memory = new InMemoryMemoryJobStore();
    await memory.put(current);
    for (const store of [cosmos, memory]) {
      expect(await store.putIfCurrent({ ...expected, status: 'completed' }, expected)).toBeNull();
    }
    expect(replace).not.toHaveBeenCalled();
  });

  it('replaces only the current job using an ETag and never falls back after a conflict', async () => {
    const expected = { ...job, status: 'running' as const, attempts: 1 };
    const replace = vi.fn().mockResolvedValue({});
    const read = vi.fn().mockResolvedValue({ resource: { ...expected, _etag: 'expected-etag' } });
    const cosmos = new CosmosMemoryJobStore({ item: () => ({ read, replace }) } as never);
    const completed = { ...expected, status: 'completed' as const };
    expect(await cosmos.putIfCurrent(completed, expected)).toEqual(completed);
    expect(replace).toHaveBeenCalledWith(completed, { accessCondition: { type: 'IfMatch', condition: 'expected-etag' } });
    replace.mockRejectedValue({ code: 412 });
    expect(await cosmos.putIfCurrent(completed, expected)).toBeNull();
    read.mockResolvedValue({ resource: expected });
    expect(await cosmos.putIfCurrent(completed, expected)).toBeNull();
    read.mockResolvedValue({ resource: undefined });
    expect(await cosmos.putIfCurrent(completed, expected)).toBeNull();
    expect(replace).toHaveBeenCalledTimes(2);
    const memory = new InMemoryMemoryJobStore();
    await memory.put(expected);
    expect(await memory.putIfCurrent(completed, expected)).toEqual(completed);
    expect(await memory.putIfCurrent(completed, expected)).toBeNull();
  });

  it('atomically admits job plus dispatch and claims queued work by ETag', async () => {
    const documents = new Map<string, Record<string, unknown>>();
    const container = {
      items: {
        batch: async (operations: OperationInput[]) => {
          for (const operation of operations) {
            if (operation.operationType === 'Create') {
              const resource = operation.resourceBody as Record<string, unknown>;
              documents.set(String(resource.id), resource);
            }
          }
          return { result: operations.map(() => ({ statusCode: 201 })) };
        },
      },
      item: (id: string) => ({
        read: async () => {
          const resource = documents.get(id);
          if (!resource) throw { code: 404 };
          return { resource: { ...resource, _etag: 'etag-1' } };
        },
        replace: async (resource: Record<string, unknown>, options: { accessCondition: { condition: string } }) => {
          expect(options.accessCondition.condition).toBe('etag-1');
          documents.set(id, resource);
          return { resource };
        },
      }),
    } as unknown as Container;
    const store = new CosmosMemoryJobStore(container);

    await expect(store.admit(job)).resolves.toMatchObject({ outcome: 'accepted', job: { id: 'job-1' } });
    expect([...documents.values()]).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'job-1', status: 'queued' }),
      expect.objectContaining({ id: 'memory-dispatch-job-1', state: 'pending' }),
    ]));
    await expect(store.claim('user-1', 'job-1', '2026-01-01T00:01:00Z', {
      releaseId: 'release-1', executionToken: 'token-1', attempt: 1,
    })).resolves.toMatchObject({ status: 'running', attempts: 1 });
    await expect(store.claim('user-1', 'job-1', '2026-01-01T00:02:00Z', {
      releaseId: 'release-old', executionToken: 'token-old', attempt: 1,
    })).resolves.toBeNull();
  });
});
