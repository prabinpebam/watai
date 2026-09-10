import type { Container, OperationInput } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import type { MemoryExtractionJobRecord } from '../../domain/memoryExtraction';
import { CosmosMemoryJobStore } from './memoryJobStore';

const job: MemoryExtractionJobRecord = {
  id: 'job-1', userId: 'user-1', threadId: 'thread-1', kind: 'turn', status: 'queued',
  assistantMessageId: 'assistant-1', dedupeKey: 'turn:assistant-1:revision', sourceRevision: 'a'.repeat(64),
  releaseId: 'release-1', executionToken: 'token-1', dispatchAttempt: 1, attempts: 0,
  createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z',
};

describe('CosmosMemoryJobStore', () => {
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
