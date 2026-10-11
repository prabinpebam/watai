import { describe, it, expect, beforeEach, vi } from 'vitest';
import { CredentialService } from './credentialService';
import type { CredentialRecord, CredentialStore, StoredCredential } from '../ports/credentialStore';
import type { KeyWrapper } from '../ports/keyWrapper';
import { AppError } from '../domain/errors';

class InMemoryCredentialStore implements CredentialStore {
  byUser = new Map<string, CredentialRecord>();
  versions = new Map<string, number>();
  async get(userId: string) {
    return this.byUser.get(userId) ?? null;
  }
  async getForUpdate(userId: string): Promise<StoredCredential | null> {
    const record = this.byUser.get(userId);
    return record ? { record: structuredClone(record), versionToken: String(this.versions.get(userId)) } : null;
  }
  async put(record: CredentialRecord, expected: StoredCredential | null) {
    const current = await this.getForUpdate(record.userId);
    if ((current?.versionToken ?? null) !== (expected?.versionToken ?? null)) return null;
    this.versions.set(record.userId, (this.versions.get(record.userId) ?? 0) + 1);
    this.byUser.set(record.userId, { ...record });
    return record;
  }
  async delete(userId: string) {
    this.byUser.delete(userId);
  }
}

/** Identity wrapper (base64) — exercises the service without a real KEK. */
const idWrapper: KeyWrapper = {
  async wrapKey(dek) {
    return { wrapped: dek.toString('base64'), kekVersion: 'test' };
  },
  async unwrapKey(wrapped) {
    return Buffer.from(wrapped, 'base64');
  },
};

function make() {
  const store = new InMemoryCredentialStore();
  let t = 0;
  const svc = new CredentialService(store, idWrapper, {
    now: () => `2026-06-01T00:00:${String(t++).padStart(2, '0')}Z`,
    newId: () => 'id',
  });
  return { store, svc };
}

const input = {
  baseUrl: 'my-res',
  models: { chat: 'gpt-5.4', image: 'gpt-image-2' },
  chatDefaults: { reasoningEffort: 'high' as const },
  key: 'sk-abcdef-1234',
  tavilyKey: 'tvly-zzzz-9999',
};

describe('CredentialService.save', () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => (ctx = make()));

  it('stores ciphertext only and returns non-secret status', async () => {
    const status = await ctx.svc.save('userA', input);
    expect(status).toMatchObject({
      configured: true,
      baseUrl: 'https://my-res.services.ai.azure.com/openai/v1',
      keyHint: '…1234',
      tavilyConfigured: true,
      tavilyHint: '…9999',
      chatDefaults: { reasoningEffort: 'high' },
    });
    // The persisted record must not contain the plaintext anywhere.
    const blob = JSON.stringify(ctx.store.byUser.get('userA'));
    expect(blob).not.toContain('sk-abcdef-1234');
    expect(blob).not.toContain('tvly-zzzz-9999');
  });

  it('status never leaks the key or ciphertext', async () => {
    const status = await ctx.svc.save('userA', input);
    const blob = JSON.stringify(status);
    expect(blob).not.toContain('sk-abcdef-1234');
    expect(blob).not.toContain('aoai');
    expect(blob).not.toContain('wrappedDek');
  });

  it('preserves createdAt across an update', async () => {
    await ctx.svc.save('userA', input);
    const created = ctx.store.byUser.get('userA')!.createdAt;
    await ctx.svc.save('userA', { ...input, key: 'sk-new-5678' });
    const rec = ctx.store.byUser.get('userA')!;
    expect(rec.createdAt).toBe(created);
    expect(rec.updatedAt).not.toBe(created);
    expect(rec.keyHint).toBe('…5678');
  });

  it('rejects invalid input', async () => {
    await expect(ctx.svc.save('userA', { baseUrl: 'r', models: {} })).rejects.toBeInstanceOf(AppError);
  });

  it('requires a key on first save but keeps the stored key (and tavily) when an update omits it', async () => {
    await expect(ctx.svc.save('userB', { baseUrl: 'r', models: { chat: 'c' } })).rejects.toBeInstanceOf(AppError);

    await ctx.svc.save('userA', input);
    const status = await ctx.svc.save('userA', { baseUrl: 'my-res', models: { chat: 'gpt-6' } });

    expect(status.keyHint).toBe('…1234'); // original key preserved
    expect(status.models?.chat).toBe('gpt-6'); // model updated
    expect(status.tavilyConfigured).toBe(true); // tavily preserved (not provided)
    expect((await ctx.svc.getDecrypted('userA')).key).toBe('sk-abcdef-1234');
  });

  it.each([undefined, '', '   '])('rejects endpoint changes without a replacement key: %j', async (key) => {
    await ctx.svc.save('userA', input);
    const before = structuredClone(ctx.store.byUser.get('userA'));
    await expect(ctx.svc.save('userA', { baseUrl: 'other-resource', models: input.models, key }))
      .rejects.toMatchObject({ code: 'validation' });
    expect(ctx.store.byUser.get('userA')).toEqual(before);
    expect((await ctx.svc.getDecrypted('userA')).baseUrl).toBe('https://my-res.services.ai.azure.com/openai/v1');
  });

  it('allows equivalent normalized endpoints to keep the stored key', async () => {
    await ctx.svc.save('userA', input);
    await ctx.svc.save('userA', { baseUrl: 'https://my-res.services.ai.azure.com/openai/v1/', models: input.models });
    expect((await ctx.svc.getDecrypted('userA')).key).toBe(input.key);
  });

  it('requires explicit knowledge-base binding when replacing the endpoint and key', async () => {
    await ctx.svc.save('userA', { ...input, knowledgeBaseVectorStoreId: 'vs-old-resource' });
    await ctx.svc.save('userA', { baseUrl: 'other-resource', models: input.models, key: 'replacement-key' });
    expect(await ctx.svc.getDecrypted('userA')).toMatchObject({
      baseUrl: 'https://other-resource.services.ai.azure.com/openai/v1',
      key: 'replacement-key',
      knowledgeBaseVectorStoreId: undefined,
    });
  });

  it.each(['', '   ', null])('persists explicit optional integration clears across reload and later omission: %j', async (value) => {
    await ctx.svc.save('userA', { ...input, knowledgeBaseVectorStoreId: 'vs-existing' });
    const status = await ctx.svc.save('userA', {
      baseUrl: input.baseUrl, models: input.models,
      tavilyKey: value, knowledgeBaseVectorStoreId: value,
    });
    expect(status).toMatchObject({ tavilyConfigured: false, tavilyHint: null, knowledgeBaseVectorStoreId: null });
    const reloaded = new CredentialService(ctx.store, idWrapper, { now: () => 'later', newId: () => 'id' });
    await reloaded.save('userA', { baseUrl: input.baseUrl, models: { chat: 'next-model' } });
    expect(await reloaded.getDecrypted('userA')).toMatchObject({ key: input.key, tavilyKey: undefined, knowledgeBaseVectorStoreId: undefined });
    expect(ctx.store.byUser.get('userA')).toMatchObject({ tavily: null, tavilyHint: null, knowledgeBaseVectorStoreId: null });
  });

  it('does not let a concurrent stale model save restore cleared integrations', async () => {
    await ctx.svc.save('userA', { ...input, knowledgeBaseVectorStoreId: 'vs-existing' });
    let releaseWrite!: () => void;
    let enteredWrite!: () => void;
    const waiting = new Promise<void>((resolve) => { releaseWrite = resolve; });
    const entered = new Promise<void>((resolve) => { enteredWrite = resolve; });
    const write = ctx.store.put.bind(ctx.store);
    vi.spyOn(ctx.store, 'put').mockImplementationOnce(async (...arguments_) => {
      enteredWrite();
      await waiting;
      return write(...arguments_);
    });
    const modelSave = ctx.svc.save('userA', { baseUrl: input.baseUrl, models: { chat: 'updated-model' } });
    await entered;
    await ctx.svc.save('userA', { baseUrl: input.baseUrl, models: input.models, tavilyKey: null, knowledgeBaseVectorStoreId: null });
    releaseWrite();
    await modelSave;
    expect(await ctx.svc.getStatus('userA')).toMatchObject({
      tavilyConfigured: false, tavilyHint: null, knowledgeBaseVectorStoreId: null,
      models: { chat: 'updated-model' },
    });
  });

  it('stops after three conditional-write conflicts', async () => {
    await ctx.svc.save('userA', input);
    const write = vi.spyOn(ctx.store, 'put').mockResolvedValue(null);
    await expect(ctx.svc.save('userA', { baseUrl: input.baseUrl, models: { chat: 'updated-model' } }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledTimes(3);
    expect((await ctx.svc.getStatus('userA')).models?.chat).toBe(input.models.chat);
  });

  it('does not recreate a record removed during a conditional update', async () => {
    await ctx.svc.save('userA', input);
    const write = vi.spyOn(ctx.store, 'put').mockImplementationOnce(async () => {
      ctx.store.byUser.delete('userA');
      return null;
    });
    await expect(ctx.svc.save('userA', { ...input, key: 'new-explicit-key' }))
      .rejects.toMatchObject({ code: 'conflict' });
    expect(write).toHaveBeenCalledOnce();
    expect(await ctx.svc.getStatus('userA')).toMatchObject({ configured: false });
  });

  it('rejects a missing version token before writing', async () => {
    await ctx.svc.save('userA', input);
    vi.spyOn(ctx.store, 'getForUpdate').mockResolvedValue({ record: ctx.store.byUser.get('userA')!, versionToken: '' });
    const write = vi.spyOn(ctx.store, 'put');
    await expect(ctx.svc.save('userA', input)).rejects.toMatchObject({ code: 'conflict' });
    expect(write).not.toHaveBeenCalled();
  });

  it('rereads after a create conflict instead of overwriting a concurrent record unconditionally', async () => {
    const write = ctx.store.put.bind(ctx.store);
    const put = vi.spyOn(ctx.store, 'put').mockImplementationOnce(async (record) => {
      await write({ ...record, tavily: null, tavilyHint: null, knowledgeBaseVectorStoreId: null }, null);
      return null;
    });
    await ctx.svc.save('userA', { baseUrl: input.baseUrl, models: input.models, key: input.key });
    expect(put).toHaveBeenCalledTimes(2);
    expect(put.mock.calls[0][1]).toBeNull();
    expect(put.mock.calls[1][1]?.versionToken).toBe('1');
    expect(await ctx.svc.getStatus('userA')).toMatchObject({ configured: true, tavilyConfigured: false });
  });
});

describe('CredentialService.getStatus / getDecrypted / delete', () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => (ctx = make()));

  it('reports unconfigured before any save', async () => {
    expect(await ctx.svc.getStatus('userA')).toEqual({ configured: false, tavilyConfigured: false });
  });

  it('decrypts the key + tavily for the run engine', async () => {
    await ctx.svc.save('userA', input);
    const dec = await ctx.svc.getDecrypted('userA');
    expect(dec.key).toBe('sk-abcdef-1234');
    expect(dec.tavilyKey).toBe('tvly-zzzz-9999');
    expect(dec.baseUrl).toBe('https://my-res.services.ai.azure.com/openai/v1');
    expect(dec.chatDefaults).toEqual({ reasoningEffort: 'high' });
  });

  it('rejects an unapproved legacy destination before decrypting its key', async () => {
    await ctx.svc.save('userA', input);
    ctx.store.byUser.get('userA')!.baseUrl = 'https://attacker.invalid/openai/v1';
    const unwrap = vi.spyOn(idWrapper, 'unwrapKey');
    try {
      await expect(ctx.svc.getDecrypted('userA')).rejects.toMatchObject({ code: 'validation' });
      expect(unwrap).not.toHaveBeenCalled();
    } finally {
      unwrap.mockRestore();
    }
  });

  it('omits tavily when not configured', async () => {
    await ctx.svc.save('userA', { baseUrl: 'r', models: { chat: 'c' }, key: 'sk-x' });
    const dec = await ctx.svc.getDecrypted('userA');
    expect(dec.tavilyKey).toBeUndefined();
    expect((await ctx.svc.getStatus('userA')).tavilyConfigured).toBe(false);
  });

  it('getDecrypted throws not_found when unconfigured', async () => {
    expect(await ctx.svc.getDecrypted('nobody').catch((e) => (e as AppError).code)).toBe('not_found');
  });

  it('delete removes the vault doc', async () => {
    await ctx.svc.save('userA', input);
    await ctx.svc.delete('userA');
    expect(await ctx.svc.getStatus('userA')).toEqual({ configured: false, tavilyConfigured: false });
  });

  it('isolates users', async () => {
    await ctx.svc.save('userA', input);
    expect(await ctx.svc.getStatus('userB')).toEqual({ configured: false, tavilyConfigured: false });
  });
});
