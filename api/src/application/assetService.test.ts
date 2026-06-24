import { describe, it, expect, beforeEach } from 'vitest';
import { ThreadService } from './threadService';
import { AssetService } from './assetService';
import { InMemoryThreadStore } from '../adapters/memory/threadStore';
import { FakeSasMinter } from '../adapters/memory/sasMinter';
import { AppError } from '../domain/errors';

function makeCtx() {
  const threadStore = new InMemoryThreadStore();
  let n = 0;
  let t = 0;
  const clock = { newId: () => `thr_${++n}`, now: () => `2026-01-01T00:00:${String(t++).padStart(2, '0')}Z` };
  const threads = new ThreadService(threadStore, clock);
  const assets = new AssetService(threadStore, new FakeSasMinter(), 300);
  return { threadStore, threads, assets };
}

async function code(fn: () => Promise<unknown>): Promise<string | undefined> {
  try {
    await fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('AssetService.requestSas', () => {
  let ctx: ReturnType<typeof makeCtx>;
  beforeEach(() => (ctx = makeCtx()));

  it('mints a write SAS scoped to the user/thread/asset path', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const r = await ctx.assets.requestSas('userA', {
      threadId: thread.id,
      assetId: 'asset1',
      op: 'write',
      contentType: 'image/png',
    });
    expect(r.blobPath).toBe(`userA/${thread.id}/asset1.png`);
    expect(r.url).toContain(r.blobPath);
    expect(r.url).toContain('op=write');
    expect(r.expiresAt).toBeTruthy();
  });

  it('mints a read SAS for the same path', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    const r = await ctx.assets.requestSas('userA', {
      threadId: thread.id,
      assetId: 'asset1',
      op: 'read',
      contentType: 'image/png',
    });
    expect(r.url).toContain('op=read');
  });

  it('fails closed for another user’s thread (IDOR)', async () => {
    const thread = await ctx.threads.create('userA', { title: 'A', temporary: false });
    expect(
      await code(() =>
        ctx.assets.requestSas('userB', { threadId: thread.id, assetId: 'x', op: 'write', contentType: 'image/png' }),
      ),
    ).toBe('not_found');
  });
});
