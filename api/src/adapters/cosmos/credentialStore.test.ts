import { describe, expect, it, vi } from 'vitest';
import type { Container } from '@azure/cosmos';
import { CosmosCredentialStore } from './credentialStore';
import type { CredentialRecord, StoredCredential } from '../../ports/credentialStore';

const record = {
  id: 'cred', userId: 'owner', baseUrl: 'https://resource.services.ai.azure.com/openai/v1',
  models: { chat: 'model' }, keyHint: 'test', createdAt: 'now', updatedAt: 'now',
} as CredentialRecord;
const snapshot: StoredCredential = { record, versionToken: 'etag-1' };

function setup() {
  const read = vi.fn().mockResolvedValue({ resource: { ...record, _etag: 'etag-1' } });
  const replace = vi.fn().mockResolvedValue({ resource: record });
  const create = vi.fn().mockResolvedValue({ resource: record });
  const upsert = vi.fn();
  const item = vi.fn().mockReturnValue({ read, replace });
  const store = new CosmosCredentialStore({ item, items: { create, upsert } } as unknown as Container);
  return { store, read, replace, create, upsert, item };
}

describe('CosmosCredentialStore conditional updates', () => {
  it('reads the owner partition and requires its ETag', async () => {
    const { store, item } = setup();
    expect(await store.getForUpdate('owner')).toMatchObject(snapshot);
    expect(item).toHaveBeenCalledWith('cred', 'owner');
  });

  it.each([{ ...record }, { ...record, userId: 'other', _etag: 'etag-1' }])('rejects an unversioned or wrong-owner snapshot', async (resource) => {
    const { store, read } = setup();
    read.mockResolvedValue({ resource });
    await expect(store.getForUpdate('owner')).rejects.toThrow('owner-bound version token');
  });

  it('replaces only with IfMatch and never upserts', async () => {
    const { store, replace, create, upsert } = setup();
    expect(await store.put(record, snapshot)).toEqual(record);
    expect(replace).toHaveBeenCalledWith(record, { accessCondition: { type: 'IfMatch', condition: 'etag-1' } });
    expect(create).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('uses create for an absent snapshot', async () => {
    const { store, create, replace } = setup();
    expect(await store.put(record, null)).toEqual(record);
    expect(create).toHaveBeenCalledWith(record);
    expect(replace).not.toHaveBeenCalled();
  });

  it.each([404, 409, 412])('surfaces conditional conflict %s as null', async (code) => {
    const { store, replace } = setup();
    replace.mockRejectedValue({ code });
    expect(await store.put(record, snapshot)).toBeNull();
  });

  it('surfaces a concurrent create as a conflict', async () => {
    const { store, create } = setup();
    create.mockRejectedValue({ code: 409 });
    expect(await store.put(record, null)).toBeNull();
  });

  it('does not downgrade missing ETag to an unconditional write', async () => {
    const { store, replace, upsert } = setup();
    await expect(store.put(record, { ...snapshot, versionToken: '' })).rejects.toThrow('owner-bound version token');
    expect(replace).not.toHaveBeenCalled();
    expect(upsert).not.toHaveBeenCalled();
  });

  it('does not hide unrelated database failures as retryable conflicts', async () => {
    const { store, replace } = setup();
    replace.mockRejectedValue({ code: 500 });
    await expect(store.put(record, snapshot)).rejects.toMatchObject({ code: 500 });
  });
});