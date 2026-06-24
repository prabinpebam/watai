import { describe, it, expect } from 'vitest';
import { createAssetsController } from './assetsController';
import { AssetService } from '../application/assetService';
import { ThreadService } from '../application/threadService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { FakeSasMinter } from '../adapters/memory/sasMinter';

function setup() {
  const threadStore = new InMemoryThreadStore();
  let n = 0;
  let t = 0;
  const clock = {
    newId: () => `id_${++n}`,
    now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z`,
  };
  const threads = new ThreadService(threadStore, clock);
  const assets = new AssetService(threadStore, new FakeSasMinter());
  return { threads, ctrl: createAssetsController(assets) };
}

describe('assetsController', () => {
  it('mints a SAS rooted at the caller’s own prefix → 200', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.requestSas({
      claims: { sub: 'userA' },
      body: { threadId: thread.id, assetId: 'a1', op: 'write', contentType: 'image/png' },
    });
    expect(res.status).toBe(200);
    const body = res.body as { blobPath: string; url: string };
    expect(body.blobPath).toBe(`userA/${thread.id}/a1.png`);
    expect(body.url).toContain('op=write');
  });

  it('cross-user thread → 404 (IDOR fails closed)', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.requestSas({
      claims: { sub: 'userB' },
      body: { threadId: thread.id, assetId: 'a1', op: 'write', contentType: 'image/png' },
    });
    expect(res.status).toBe(404);
  });

  it('unauthenticated → 401', async () => {
    const { ctrl } = setup();
    const res = await ctrl.requestSas({
      claims: {},
      body: { threadId: 't1', assetId: 'a1', op: 'write', contentType: 'image/png' },
    });
    expect(res.status).toBe(401);
  });

  it('disallowed content type → 400', async () => {
    const { threads, ctrl } = setup();
    const thread = await threads.create('userA', { title: 'T', temporary: false });
    const res = await ctrl.requestSas({
      claims: { sub: 'userA' },
      body: { threadId: thread.id, assetId: 'a1', op: 'write', contentType: 'application/pdf' },
    });
    expect(res.status).toBe(400);
  });
});
