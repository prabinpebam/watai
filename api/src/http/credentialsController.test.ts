import { describe, it, expect, beforeEach } from 'vitest';
import { createCredentialsController } from './credentialsController';
import { CredentialService } from '../application/credentialService';
import type { CredentialRecord, CredentialStore } from '../ports/credentialStore';
import type { KeyWrapper } from '../ports/keyWrapper';

class MemStore implements CredentialStore {
  byUser = new Map<string, CredentialRecord>();
  async get(u: string) {
    return this.byUser.get(u) ?? null;
  }
  async put(r: CredentialRecord) {
    this.byUser.set(r.userId, { ...r });
    return r;
  }
  async delete(u: string) {
    this.byUser.delete(u);
  }
}

const idWrapper: KeyWrapper = {
  async wrapKey(dek) {
    return { wrapped: dek.toString('base64'), kekVersion: 'test' };
  },
  async unwrapKey(wrapped) {
    return Buffer.from(wrapped, 'base64');
  },
};

function make() {
  let t = 0;
  const store = new MemStore();
  const svc = new CredentialService(store, idWrapper, {
    now: () => `2026-06-01T00:00:${String(t++).padStart(2, '0')}Z`,
    newId: () => 'id',
  });
  return { store, ctrl: createCredentialsController(svc) };
}

const body = { baseUrl: 'my-res', models: { chat: 'gpt-5.4' }, key: 'sk-secret-7777' };

describe('credentialsController', () => {
  let ctx: ReturnType<typeof make>;
  beforeEach(() => (ctx = make()));

  it('PUT stores the key → 200 status only, never echoing the secret', async () => {
    const res = await ctx.ctrl.put({ claims: { sub: 'userA' }, body });
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ configured: true, keyHint: '…7777' });
    expect(JSON.stringify(res.body)).not.toContain('sk-secret-7777');
  });

  it('GET reports unconfigured before any write → 200', async () => {
    const res = await ctx.ctrl.get({ claims: { sub: 'userA' } });
    expect(res.status).toBe(200);
    expect((res.body as { configured: boolean }).configured).toBe(false);
  });

  it('rejects an unauthenticated request → 401', async () => {
    const res = await ctx.ctrl.get({ claims: {} });
    expect(res.status).toBe(401);
    expect((res.body as { error: { code: string } }).error.code).toBe('unauthorized');
  });

  it('maps an invalid write → 400 envelope', async () => {
    const res = await ctx.ctrl.put({ claims: { sub: 'userA' }, body: { baseUrl: 'r', models: {} } });
    expect(res.status).toBe(400);
    expect((res.body as { error: { code: string } }).error.code).toBe('validation');
  });

  it('DELETE wipes the vault → 204, then GET is unconfigured', async () => {
    await ctx.ctrl.put({ claims: { sub: 'userA' }, body });
    const removed = await ctx.ctrl.remove({ claims: { sub: 'userA' } });
    expect(removed.status).toBe(204);
    expect(removed.body).toBeUndefined();
    const after = await ctx.ctrl.get({ claims: { sub: 'userA' } });
    expect((after.body as { configured: boolean }).configured).toBe(false);
  });

  it('isolates users (B never sees A’s vault)', async () => {
    await ctx.ctrl.put({ claims: { sub: 'userA' }, body });
    const res = await ctx.ctrl.get({ claims: { sub: 'userB' } });
    expect((res.body as { configured: boolean }).configured).toBe(false);
  });
});
