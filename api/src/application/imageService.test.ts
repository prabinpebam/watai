import { describe, it, expect, vi } from 'vitest';
import { ImageService } from './imageService';
import { InMemoryImageStore } from '../adapters/memory/imageStore';
import type { ImageJob, ImageJobStarter } from '../ports/imageJobStarter';
import type { SasMinter } from '../ports/sasMinter';
import type { ImageGenRecord } from '../ports/imageStore';
import { AppError } from '../domain/errors';
import { libraryItemIdFor } from '../domain/library';

function makeClock() {
  let n = 0;
  return { newId: () => `id${n++}`, now: () => `2026-06-01T00:00:${String(n).padStart(2, '0')}Z` };
}

const minter: SasMinter = {
  mint: async ({ blobPath, op }) => ({ url: `https://blob/${blobPath}?${op}`, expiresAt: '2026' }),
};

function creds(image?: string) {
  return {
    getDecrypted: async () => ({
      baseUrl: 'https://r.services.ai.azure.com/openai/v1',
      key: 'k',
      models: { chat: 'gpt-5', ...(image ? { image } : {}) },
    }),
  };
}

function starter(): ImageJobStarter & { jobs: ImageJob[] } {
  const jobs: ImageJob[] = [];
  return { jobs, start: async (job) => void jobs.push(job) };
}

describe('ImageService.create', () => {
  it('persists N queued records and enqueues one job each', async () => {
    const store = new InMemoryImageStore();
    const jobs = starter();
    const svc = new ImageService(store, creds('gpt-image-1'), jobs, minter, makeClock());

    const out = await svc.create('userA', { prompt: 'a fox', size: '1024x1536', count: 2 });

    expect(out).toHaveLength(2);
    expect(out.every((r) => r.status === 'queued' && r.size === '1024x1536')).toBe(true);
    expect(out[0].batchId).toBe(out[1].batchId);
    expect(jobs.jobs).toHaveLength(2);
    const listed = await store.list('userA');
    expect(listed.items).toHaveLength(2);
  });

  it('carries remix lineage onto the record', async () => {
    const store = new InMemoryImageStore();
    await store.put({
      id: 'src',
      userId: 'userA',
      batchId: 'b',
      status: 'ready',
      prompt: 'orig',
      size: '1024x1024',
      outputFormat: 'png',
      model: 'gpt-image-1',
      blobPath: 'userA/images/src.png',
      createdAt: '2026',
      updatedAt: '2026',
    });
    const svc = new ImageService(store, creds('gpt-image-1'), starter(), minter, makeClock());

    const out = await svc.create('userA', { prompt: 'remix', sourceImageId: 'src', useReference: true });
    expect(out[0]).toMatchObject({
      sourceImageId: 'src',
      useReference: true,
      libraryItemId: libraryItemIdFor('userA', 'studio_generated_image', out[0].id),
      referenceItemIds: [libraryItemIdFor('userA', 'studio_generated_image', 'src')],
      provenanceComplete: true,
    });
  });

  it('rejects when no image model is configured', async () => {
    const svc = new ImageService(new InMemoryImageStore(), creds(), starter(), minter, makeClock());
    await expect(svc.create('userA', { prompt: 'x' })).rejects.toBeInstanceOf(AppError);
  });

  it('rejects a remix from an unknown source image', async () => {
    const svc = new ImageService(new InMemoryImageStore(), creds('gpt-image-1'), starter(), minter, makeClock());
    await expect(svc.create('userA', { prompt: 'x', sourceImageId: 'nope' })).rejects.toMatchObject({ code: 'not_found' });
  });

  it('marks the record error when the job cannot be enqueued', async () => {
    const store = new InMemoryImageStore();
    const failing: ImageJobStarter = { start: async () => { throw new Error('queue down'); } };
    const svc = new ImageService(store, creds('gpt-image-1'), failing, minter, makeClock());

    const out = await svc.create('userA', { prompt: 'x' });
    expect(out[0].status).toBe('error');
    const stored = await store.get('userA', out[0].id);
    expect(stored?.status).toBe('error');
  });
});

describe('ImageService.list / get', () => {
  async function seedReady(store: InMemoryImageStore, id: string, prompt: string): Promise<ImageGenRecord> {
    const rec: ImageGenRecord = {
      id,
      userId: 'userA',
      batchId: 'b',
      status: 'ready',
      prompt,
      size: '1024x1024',
      outputFormat: 'png',
      model: 'gpt-image-1',
      blobPath: `userA/images/${id}.png`,
      createdAt: `2026-01-0${id.length}`,
      updatedAt: '2026',
    };
    return store.put(rec);
  }

  it('enriches ready images with a read url and supports prompt search', async () => {
    const store = new InMemoryImageStore();
    await seedReady(store, 'a', 'a red fox');
    await seedReady(store, 'b', 'a blue whale');
    const svc = new ImageService(store, creds('gpt-image-1'), starter(), minter, makeClock());

    const all = await svc.list('userA');
    expect(all.images).toHaveLength(2);
    expect(all.images.every((i) => typeof i.url === 'string' && i.url.includes('?read'))).toBe(true);

    const filtered = await svc.list('userA', { q: 'whale' });
    expect(filtered.images).toHaveLength(1);
    expect(filtered.images[0].prompt).toBe('a blue whale');
  });

  it('omits url for non-ready records', async () => {
    const store = new InMemoryImageStore();
    await store.put({
      id: 'q',
      userId: 'userA',
      batchId: 'b',
      status: 'queued',
      prompt: 'pending',
      size: '1024x1024',
      outputFormat: 'png',
      model: 'gpt-image-1',
      createdAt: '2026',
      updatedAt: '2026',
    });
    const svc = new ImageService(store, creds('gpt-image-1'), starter(), minter, makeClock());
    const got = await svc.get('userA', 'q');
    expect(got.url).toBeUndefined();
  });

  it('throws not_found for a missing image', async () => {
    const svc = new ImageService(new InMemoryImageStore(), creds('gpt-image-1'), starter(), minter, makeClock());
    await expect(svc.get('userA', 'nope')).rejects.toMatchObject({ code: 'not_found' });
  });
});

describe('ImageService.remove', () => {
  it('deletes the blob (delete SAS) and the record', async () => {
    const store = new InMemoryImageStore();
    await store.put({
      id: 'x',
      userId: 'userA',
      batchId: 'b',
      status: 'ready',
      prompt: 'p',
      size: '1024x1024',
      outputFormat: 'png',
      model: 'gpt-image-1',
      blobPath: 'userA/images/x.png',
      createdAt: '2026',
      updatedAt: '2026',
    });
    const fetchImpl = vi.fn(async () => new Response(null, { status: 202 })) as unknown as typeof fetch;
    const svc = new ImageService(store, creds('gpt-image-1'), starter(), minter, makeClock(), fetchImpl);

    await svc.remove('userA', 'x');

    expect(fetchImpl).toHaveBeenCalledWith(expect.stringContaining('?delete'), { method: 'DELETE' });
    expect(await store.get('userA', 'x')).toBeNull();
  });

  it('is idempotent when the image is already gone', async () => {
    const svc = new ImageService(new InMemoryImageStore(), creds('gpt-image-1'), starter(), minter, makeClock());
    await expect(svc.remove('userA', 'nope')).resolves.toBeUndefined();
  });
});
