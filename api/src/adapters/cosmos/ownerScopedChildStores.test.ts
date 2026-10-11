import type { Container, OperationInput, SqlQuerySpec } from '@azure/cosmos';
import { describe, expect, it } from 'vitest';
import type { MessageRecord } from '../../ports/messageStore';
import type { RunRecord } from '../../ports/runStore';
import { CosmosMessageStore } from './messageStore';
import { ownerScopedDocumentId } from './ownerScopedId';
import { CosmosRunStore } from './runStore';

type Document = Record<string, unknown> & { id: string; threadId: string; userId?: string };

function fakeContainer(initial: Document[] = []): { container: Container; documents: Document[] } {
  const documents = initial.map((document) => ({ ...document }));
  const find = (id: string, partitionKey: string) =>
    documents.findIndex((document) => document.id === id && document.threadId === partitionKey);
  const container = {
    item: (id: string, partitionKey: string) => ({
      read: async () => {
        const index = find(id, partitionKey);
        if (index < 0) throw { code: 404 };
        return { resource: { ...documents[index], _etag: String(index + 1) } };
      },
      replace: async (record: Document) => {
        const index = find(id, partitionKey);
        if (index < 0) throw { code: 404 };
        documents[index] = { ...record };
        return { resource: record };
      },
      delete: async () => {
        const index = find(id, partitionKey);
        if (index >= 0) documents.splice(index, 1);
      },
    }),
    items: {
      upsert: async (record: Document) => {
        const index = find(record.id, record.threadId);
        if (index >= 0) documents[index] = { ...record };
        else documents.push({ ...record });
        return { resource: record };
      },
      batch: async (operations: OperationInput[], partitionKey: string) => {
        const createConflict = operations.find((operation) =>
          operation.operationType === 'Create' &&
          find(String(operation.resourceBody.id), partitionKey) >= 0);
        if (createConflict) {
          return { result: operations.map((operation) => ({
            statusCode: operation === createConflict ? 409 : 424,
            requestCharge: 1,
          })) };
        }
        for (const operation of operations) {
          if (operation.operationType === 'Create' || operation.operationType === 'Upsert' || operation.operationType === 'Replace') {
            const record = operation.resourceBody as unknown as Document;
            const index = find(record.id, partitionKey);
            if (index >= 0) documents[index] = { ...record };
            else documents.push({ ...record });
          } else if (operation.operationType === 'Delete') {
            const index = find(operation.id, partitionKey);
            if (index >= 0) documents.splice(index, 1);
          }
        }
        return { result: operations.map(() => ({ statusCode: 200, requestCharge: 1 })) };
      },
      query: (spec: SqlQuerySpec, options: { partitionKey?: string }) => ({
        fetchAll: async () => {
          const parameters = new Map((spec.parameters ?? []).map((parameter) => [parameter.name, parameter.value]));
          let resources = documents.filter((document) => document.threadId === options.partitionKey);
          const userId = parameters.get('@userId') ?? parameters.get('@u');
          if (userId !== undefined) resources = resources.filter((document) => document.userId === userId);
          const since = parameters.get('@since');
          if (typeof since === 'string') {
            const inclusive = spec.query.includes('>= @since');
            resources = resources.filter((document) => inclusive
              ? String(document.createdAt) >= since
              : String(document.createdAt) > since);
          }
          if (spec.query.includes('IS_NULL(c.deletedAt)')) resources = resources.filter((document) => document.deletedAt == null);
          if (spec.query.includes("c.status = 'queued'")) resources = resources.filter((document) => document.status === 'queued' || document.status === 'running');
          resources.sort((left, right) => String(left.createdAt).localeCompare(String(right.createdAt)));
          if (spec.query.startsWith('SELECT c.id ')) return { resources: resources.map(({ id }) => ({ id })) };
          if (spec.query.startsWith('SELECT c.id,')) return { resources: resources.map(({ id, messageId, userId, threadId }) => ({ id, messageId, userId, threadId })) };
          return { resources: resources.map((document) => ({ ...document })) };
        },
      }),
    },
  } as unknown as Container;
  return { container, documents };
}

function message(userId: string, content = userId): MessageRecord {
  return {
    id: 'same-message',
    threadId: 'same-thread',
    userId,
    role: 'user',
    content,
    status: 'complete',
    createdAt: '2026-01-01T00:00:00Z',
    deletedAt: null,
  };
}

function run(userId: string): RunRecord {
  return {
    id: 'same-run',
    threadId: 'same-thread',
    userId,
    assistantMessageId: 'assistant',
    status: 'queued',
    tools: [],
    allowDestructive: [],
    createdAt: '2026-01-01T00:00:00Z',
    heartbeatAt: '2026-01-01T00:00:00Z',
    releaseId: 'release-1',
    executionToken: `token-${userId}`,
    dispatchAttempt: 1,
  };
}

describe('owner-scoped Cosmos child stores', () => {
  it('creates initial messages without falling back to streaming upsert', async () => {
    const record = message('owner-a');
    const create = vi.fn().mockResolvedValue({});
    const upsert = vi.fn();
    const store = new CosmosMessageStore({ items: { create, upsert } } as never);
    expect(await store.createIfAbsent(record)).toEqual(record);
    expect(create).toHaveBeenCalledWith({ ...record, id: ownerScopedDocumentId('message', record.userId, record.id), messageId: record.id });
    create.mockRejectedValueOnce({ code: 409 });
    expect(await store.createIfAbsent(record)).toBeNull();
    create.mockRejectedValueOnce({ code: 500 });
    await expect(store.createIfAbsent(record)).rejects.toMatchObject({ code: 500 });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each(['valid', 'owner', 'thread', 'document-id'] as const)('binds every bulk-delete identity before any destructive request: %s', async change => {
    const scoped = { id: ownerScopedDocumentId('message', 'owner-a', 'one'), messageId: 'one', userId: 'owner-a', threadId: 'same-thread' };
    const legacy = { id: 'legacy', userId: 'owner-a', threadId: 'same-thread' };
    const second = change === 'valid' ? legacy : { ...scoped,
      ...(change === 'owner' ? { userId: 'owner-b' } : {}),
      ...(change === 'thread' ? { threadId: 'other-thread' } : {}),
      ...(change === 'document-id' ? { id: 'unrelated' } : {}),
    };
    const remove = vi.fn(async () => {});
    const query = vi.fn((_statement: SqlQuerySpec) => ({ fetchAll: async () => ({ resources: [scoped, second] }) }));
    const item = vi.fn(() => ({ delete: remove }));
    const store = new CosmosMessageStore({ items: { query }, item } as never);
    const work = store.deleteByThread('owner-a', 'same-thread');
    if (change === 'valid') {
      await work;
      expect(item.mock.calls).toEqual([[scoped.id, 'same-thread'], ['legacy', 'same-thread']]);
      expect(query.mock.calls[0][0].query).toContain('SELECT c.id, c.messageId, c.userId, c.threadId');
    } else {
      await expect(work).rejects.toThrow('Message result binding failed.');
      expect(remove).not.toHaveBeenCalled();
    }
  });

  it.each([404, 500])('only treats confirmed absence as a successful bulk deletion: %s', async code => {
    const first = { id: 'first', userId: 'owner-a', threadId: 'same-thread' };
    const second = { ...first, id: 'second' };
    const remove = vi.fn().mockRejectedValueOnce({ code }).mockResolvedValue(undefined);
    const store = new CosmosMessageStore({ items: { query: () => ({ fetchAll: async () => ({ resources: [first, second] }) }) },
      item: () => ({ delete: remove }) } as never);
    const work = store.deleteByThread('owner-a', 'same-thread');
    if (code === 404) { await work; expect(remove).toHaveBeenCalledTimes(2); }
    else { await expect(work).rejects.toMatchObject({ code }); expect(remove).toHaveBeenCalledOnce(); }
  });

  it.each([null, 42, {}, ''])('rejects malformed list message identities before hashing: %j', async messageId => {
    const record = { ...message('owner-a'), messageId };
    const store = new CosmosMessageStore({ items: { query: () => ({ fetchAll: async () => ({ resources: [record] }) }) } } as never);
    await expect(store.list('owner-a', 'same-thread')).rejects.toThrow('Message result binding failed.');
  });

  it.each(['scoped', 'legacy'].flatMap(storage =>
    ['valid', 'owner', 'thread', 'logical-id', 'document-id'].map(change => ({ storage, change })),
  ))('validates point-read message identity before returning it: %j', async ({ storage, change }) => {
    const original = message('owner-a');
    const scopedId = ownerScopedDocumentId('message', original.userId, original.id);
    const document = { ...original,
      id: change === 'document-id' ? 'unexpected-document' : storage === 'legacy' ? original.id : scopedId,
      ...(storage === 'scoped' ? { messageId: original.id } : {}),
      ...(change === 'logical-id' ? { messageId: 'other-message' } : {}),
      ...(change === 'owner' ? { userId: 'owner-b' } : {}),
      ...(change === 'thread' ? { threadId: 'other-thread' } : {}),
    };
    const store = new CosmosMessageStore({ item: (id: string) => ({ read: async () => {
      if (storage === 'legacy' && id === scopedId) throw { code: 404 };
      return { resource: document };
    } }) } as never);
    expect(await store.get(original.userId, original.threadId, original.id)).toEqual(change === 'valid' ? original : null);
  });

  it.each(['owner', 'thread', 'document-id'] as const)('rejects a whole message page with contaminated %s binding', async change => {
    const original = message('owner-a');
    const own = { ...original, id: ownerScopedDocumentId('message', original.userId, original.id), messageId: original.id };
    const contaminated = { ...own,
      ...(change === 'owner' ? { userId: 'owner-b' } : {}),
      ...(change === 'thread' ? { threadId: 'other-thread' } : {}),
      ...(change === 'document-id' ? { id: 'wrong-document' } : {}),
    };
    const store = new CosmosMessageStore({ items: { query: () => ({ fetchAll: async () => ({ resources: [own, contaminated] }) }) } } as never);
    await expect(store.list(original.userId, original.threadId)).rejects.toThrow('Message result binding failed.');
  });

  it.each(['scoped', 'legacy'].flatMap(storage =>
    ['valid', 'owner', 'thread', 'logical-id', 'document-id'].map(change => ({ storage, change })),
  ))('validates point-read run identity before returning or changing it: %j', async ({ storage, change }) => {
    const original = run('owner-a');
    const scopedId = ownerScopedDocumentId('run', original.userId, original.id);
    const record = {
      ...original,
      id: change === 'document-id' ? 'unexpected-document' : storage === 'legacy' ? original.id : scopedId,
      ...(storage === 'scoped' ? { runId: original.id } : {}),
      ...(change === 'logical-id' ? { runId: 'other-run' } : {}),
      ...(change === 'owner' ? { userId: 'owner-b' } : {}),
      ...(change === 'thread' ? { threadId: 'other-thread' } : {}),
      _etag: 'etag',
    };
    const replace = vi.fn();
    const container = { item: (id: string) => ({ read: async () => {
      if (storage === 'legacy' && id === scopedId) throw { code: 404 };
      return { resource: record };
    }, replace }) };
    const store = new CosmosRunStore(container as never);
    const result = await store.get(original.userId, original.threadId, original.id);
    if (change === 'valid') expect(result).toMatchObject(original);
    else {
      expect(result).toBeNull();
      if (storage === 'scoped') {
        expect(await store.acknowledgeStart(original.userId, original.threadId, original.id, 'instance')).toBeNull();
        expect(await store.transition(original.userId, original.threadId, original.id, ['queued'], { heartbeatAt: 'later' })).toEqual({ outcome: 'missing' });
        expect(replace).not.toHaveBeenCalled();
      }
    }
  });

  it('stores and reads identical public IDs independently for each owner', async () => {
    const messages = fakeContainer();
    const runs = fakeContainer();
    const messageStore = new CosmosMessageStore(messages.container);
    const runStore = new CosmosRunStore(runs.container);

    await messageStore.append(message('owner-a'));
    await messageStore.append(message('owner-b'));
    await runStore.put(run('owner-a'));
    await runStore.put(run('owner-b'));

    expect(messages.documents.map(({ id }) => id).sort()).toEqual([
      ownerScopedDocumentId('message', 'owner-a', 'same-message'),
      ownerScopedDocumentId('message', 'owner-b', 'same-message'),
    ].sort());
    expect(runs.documents.map(({ id }) => id).sort()).toEqual([
      ownerScopedDocumentId('run', 'owner-a', 'same-run'),
      ownerScopedDocumentId('run', 'owner-b', 'same-run'),
    ].sort());
    await expect(messageStore.get('owner-a', 'same-thread', 'same-message')).resolves.toMatchObject({ userId: 'owner-a', id: 'same-message' });
    await expect(messageStore.get('owner-b', 'same-thread', 'same-message')).resolves.toMatchObject({ userId: 'owner-b', id: 'same-message' });
    await expect(runStore.listActive('owner-a', 'same-thread')).resolves.toMatchObject([{ userId: 'owner-a', id: 'same-run' }]);
    await expect(runStore.listActive('owner-b', 'same-thread')).resolves.toMatchObject([{ userId: 'owner-b', id: 'same-run' }]);
  });

  it('deletes only the selected owner records', async () => {
    const messages = fakeContainer();
    const runs = fakeContainer();
    const messageStore = new CosmosMessageStore(messages.container);
    const runStore = new CosmosRunStore(runs.container);
    await messageStore.append(message('owner-a'));
    await messageStore.append(message('owner-b'));
    await runStore.put(run('owner-a'));
    await runStore.put(run('owner-b'));

    await messageStore.deleteByThread('owner-a', 'same-thread');
    await runStore.deleteByThread('owner-a', 'same-thread');

    await expect(messageStore.get('owner-a', 'same-thread', 'same-message')).resolves.toBeNull();
    await expect(messageStore.get('owner-b', 'same-thread', 'same-message')).resolves.toMatchObject({ userId: 'owner-b' });
    await expect(runStore.get('owner-a', 'same-thread', 'same-run')).resolves.toBeNull();
    await expect(runStore.get('owner-b', 'same-thread', 'same-run')).resolves.toMatchObject({ userId: 'owner-b' });
  });

  it('reads proven same-owner legacy rows and quarantines missing or mismatched ownership', async () => {
    const proven = message('owner-a', 'legacy');
    proven.id = 'legacy-message';
    const messages = fakeContainer([
      proven as unknown as Document,
      { ...message('owner-b'), id: 'foreign-message' } as unknown as Document,
      { ...message('owner-a'), id: 'ownerless-message', userId: undefined } as unknown as Document,
    ]);
    const store = new CosmosMessageStore(messages.container);

    await expect(store.get('owner-a', 'same-thread', 'legacy-message')).resolves.toMatchObject({ content: 'legacy', userId: 'owner-a' });
    await expect(store.get('owner-a', 'same-thread', 'foreign-message')).resolves.toBeNull();
    await expect(store.get('owner-a', 'same-thread', 'ownerless-message')).resolves.toBeNull();

    await store.append({ ...proven, content: 'migrated' });
    await expect(store.list('owner-a', 'same-thread')).resolves.toMatchObject([{ id: 'legacy-message', content: 'migrated' }]);
  });

  it('atomically owns an active run slot and replays only matching submissions', async () => {
    const runs = fakeContainer();
    const store = new CosmosRunStore(runs.container);
    const first = run('owner-a');
    first.id = 'run-first';
    const second = { ...run('owner-a'), id: 'run-second' };

    await expect(store.admit({ run: first, idempotencyKey: 'message-first', requestFingerprint: 'fingerprint-a', legacyMessageExists: false }))
      .resolves.toMatchObject({ outcome: 'accepted', run: { id: 'run-first' } });
    await expect(store.admit({ run: second, idempotencyKey: 'message-second', requestFingerprint: 'fingerprint-b', legacyMessageExists: false }))
      .resolves.toEqual({ outcome: 'active_conflict' });
    await expect(store.admit({ run: second, idempotencyKey: 'message-first', requestFingerprint: 'fingerprint-a', legacyMessageExists: true }))
      .resolves.toMatchObject({ outcome: 'replay', run: { id: 'run-first' } });
    await expect(store.admit({ run: second, idempotencyKey: 'message-first', requestFingerprint: 'changed', legacyMessageExists: true }))
      .resolves.toEqual({ outcome: 'payload_mismatch' });

    await expect(store.transition('owner-a', 'same-thread', 'run-first', ['queued'], { status: 'complete' }))
      .resolves.toMatchObject({ outcome: 'updated', run: { status: 'complete' } });
    await expect(store.admit({ run: second, idempotencyKey: 'message-second', requestFingerprint: 'fingerprint-b', legacyMessageExists: false }))
      .resolves.toMatchObject({ outcome: 'accepted', run: { id: 'run-second' } });
  });

  it('does not regress a run that advanced before start acknowledgement', async () => {
    const runs = fakeContainer();
    const store = new CosmosRunStore(runs.container);
    const record = run('owner-a');
    await store.admit({ run: record, idempotencyKey: 'message', requestFingerprint: 'fingerprint', legacyMessageExists: false });
    await store.put({ ...record, status: 'running' });

    await expect(store.acknowledgeStart('owner-a', 'same-thread', 'same-run', 'instance'))
      .resolves.toMatchObject({ status: 'running' });
    await expect(store.get('owner-a', 'same-thread', 'same-run')).resolves.toMatchObject({ status: 'running' });
  });
});
