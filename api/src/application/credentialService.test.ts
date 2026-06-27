import { describe, it, expect, beforeEach } from 'vitest';
import { CredentialService } from './credentialService';
import type { CredentialRecord, CredentialStore } from '../ports/credentialStore';
import type { KeyWrapper } from '../ports/keyWrapper';
import { AppError } from '../domain/errors';

class InMemoryCredentialStore implements CredentialStore {
  byUser = new Map<string, CredentialRecord>();
  async get(userId: string) {
    return this.byUser.get(userId) ?? null;
  }
  async put(record: CredentialRecord) {
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
