import { describe, expect, it, vi } from 'vitest';
import type { Container } from '@azure/cosmos';
import { CosmosThreadStore } from './threadStore';
import type { ThreadRecord } from '../../ports/threadStore';

const record: ThreadRecord = { id: 'thread', userId: 'owner', title: 'Title', pinned: false, archived: false, temporary: false, messageCount: 0, createdAt: 'now', updatedAt: 'now', deletedAt: null };
function setup() {
  const replace = vi.fn().mockResolvedValue({ resource: record });
  const upsert = vi.fn().mockResolvedValue({ resource: record });
  const create = vi.fn().mockResolvedValue({ resource: record });
  const item = vi.fn().mockReturnValue({ replace });
  return { store: new CosmosThreadStore({ item, items: { upsert, create } } as unknown as Container), replace, upsert, item, create };
}

describe('CosmosThreadStore no-create conditional writes', () => {
  it.each(['owner', 'id'] as const)('rejects mismatched point and versioned thread reads: %s', async mismatch => {
    const resource = { ...record, [mismatch === 'owner' ? 'userId' : 'id']: 'other', _etag: 'version' };
    const store = new CosmosThreadStore({ item: () => ({ read: async () => ({ resource }) }) } as never);
    expect(await store.get(record.userId, record.id)).toBeNull();
    expect(await store.getForUpdate(record.userId, record.id)).toBeNull();
  });

  it.each([undefined, '', ' ', 'version'])('requires a nonblank token for versioned thread reads: %s', async etag => {
    const resource = { ...record, _etag: etag };
    const store = new CosmosThreadStore({ item: () => ({ read: async () => ({ resource }) }) } as never);
    if (etag === 'version') expect(await store.getForUpdate(record.userId, record.id)).toEqual({ record: resource, etag });
    else await expect(store.getForUpdate(record.userId, record.id)).rejects.toThrow('Conditional thread writes require a version token.');
  });

  it('rejects a contaminated thread page instead of returning partial results', async () => {
    const store = new CosmosThreadStore({ items: { query: () => ({ fetchAll: async () => ({ resources: [record, { ...record, userId: 'other' }] }) }) } } as never);
    await expect(store.list(record.userId)).rejects.toThrow('Thread owner binding failed.');
  });

  it('uses owner-partitioned replace with mandatory IfMatch, never upsert', async () => {
    const { store, replace, upsert, item } = setup();
    expect(await store.putIfMatch(record, 'etag-1')).toEqual(record);
    expect(item).toHaveBeenCalledWith('thread', 'owner');
    expect(replace).toHaveBeenCalledWith(record, { accessCondition: { type: 'IfMatch', condition: 'etag-1' } });
    expect(upsert).not.toHaveBeenCalled();
  });

  it.each([404, 412])('returns a conflict after concurrent deletion/version change: %s', async code => {
    const { store, replace, upsert } = setup();
    replace.mockRejectedValue({ code });
    expect(await store.putIfMatch(record, 'etag-1')).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('refuses a missing ETag without attempting any database write', async () => {
    const { store, replace, upsert } = setup();
    await expect(store.putIfMatch(record, '')).rejects.toThrow();
    expect(replace).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('creates without overwriting an existing document', async () => {
    const { store, create, upsert } = setup();
    expect(await store.createIfAbsent(record)).toEqual(record);
    expect(create).toHaveBeenCalledWith(record);
    create.mockRejectedValueOnce({ code: 409 });
    expect(await store.createIfAbsent(record)).toBeNull();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not treat an unavailable database as a create conflict', async () => {
    const { store, create } = setup();
    create.mockRejectedValue({ code: 500 });
    await expect(store.createIfAbsent(record)).rejects.toMatchObject({ code: 500 });
  });
});