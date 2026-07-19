import { describe, it, expect, vi } from 'vitest';
import { processImageJob, type ImageWorkerDeps } from './imageWorker';
import { InMemoryImageStore } from '../adapters/memory/imageStore';
import type { ImageGenRecord } from '../ports/imageStore';
import type { SasMinter } from '../ports/sasMinter';
import type { SignalRSender } from '../adapters/azure/signalr';
import type { ImageResult } from '../ai/image';
import { aiError } from '../ai/errors';
import { libraryItemIdFor } from '../domain/library';
import type { LibraryItemRecord } from '../domain/library';
import type { LibraryStore } from '../ports/libraryStore';

const minter: SasMinter = {
  mint: async ({ blobPath, op }) => ({ url: `https://blob/${blobPath}?${op}`, expiresAt: '2026' }),
};

function makeClock() {
  let n = 0;
  return { newId: () => `id${n++}`, now: () => `2026-06-01T00:00:${String(n++).padStart(2, '0')}Z` };
}

function fakeSignalR() {
  const sends: Array<{ target: string; payload: unknown }> = [];
  const signalr = {
    negotiate: () => ({}) as never,
    sendToUser: async (_u: string, target: string, payload: unknown) => void sends.push({ target, payload }),
  } as unknown as SignalRSender;
  return { signalr, sends };
}

function creds(image?: string) {
  return {
    getDecrypted: async () => ({
      baseUrl: 'https://r.services.ai.azure.com/openai/v1',
      key: 'k',
      models: { chat: 'gpt-5', ...(image ? { image } : {}) },
    }),
  };
}

function okFetch() {
  return vi.fn(async (_url: string, init?: { method?: string }) => {
    if (init?.method === 'PUT' || init?.method === 'DELETE') return new Response(null, { status: 201 });
    return new Response(new Uint8Array([1, 2, 3]), { status: 200 }); // source download
  }) as unknown as typeof fetch;
}

async function seedQueued(store: InMemoryImageStore, over: Partial<ImageGenRecord> = {}): Promise<ImageGenRecord> {
  const rec: ImageGenRecord = {
    id: 'img1',
    userId: 'userA',
    batchId: 'b',
    status: 'queued',
    prompt: 'a red fox',
    size: '1024x1024',
    outputFormat: 'png',
    model: 'gpt-image-1',
    error: null,
    createdAt: '2026',
    updatedAt: '2026',
    ...over,
  };
  return store.put(rec);
}

describe('processImageJob', () => {
  it('drives queued -> generating -> ready, uploads the blob, and pushes each change', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const { signalr, sends } = fakeSignalR();
    const generateImage = vi.fn(
      async (): Promise<ImageResult[]> => [{ b64: Buffer.from('png').toString('base64'), revisedPrompt: 'a vivid red fox' }],
    );
    const library = new Map<string, LibraryItemRecord>();
    const libraryStore = {
      get: async (_userId: string, id: string) => library.get(id) ?? null,
      put: async (item: LibraryItemRecord) => { library.set(item.id, item); return item; },
    } as unknown as LibraryStore;
    const deps: ImageWorkerDeps = { imageStore: store, libraryStore, credentials: creds('gpt-image-1'), minter, clock: makeClock(), signalr, generateImage, fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img1');

    const rec = await store.get('userA', 'img1');
    expect(rec?.status).toBe('ready');
    const libraryId = libraryItemIdFor('userA', 'studio_generated_image', 'img1');
    expect(rec?.blobPath).toBe(`userA/library/${libraryId}.png`);
    expect(rec?.libraryItemId).toBe(libraryId);
    expect(library.get(libraryId)).toMatchObject({ state: 'active', origin: 'studio_generated_image', blobPath: rec?.blobPath, bytes: 3 });
    expect(rec?.revisedPrompt).toBe('a vivid red fox');
    expect(generateImage).toHaveBeenCalledOnce();
    expect(sends.map((s) => (s.payload as { image: ImageGenRecord }).image.status)).toEqual(['generating', 'ready']);
    // The ready push carries a read url.
    const ready = sends[1].payload as { image: { url?: string } };
    expect(ready.image.url).toContain('?read');
  });

  it('errors with no_image_model when no image model is configured', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds(), minter, clock: makeClock(), fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img1');

    const rec = await store.get('userA', 'img1');
    expect(rec?.status).toBe('error');
    expect(rec?.error?.code).toBe('no_image_model');
  });

  it('remixes via editImage using the source image bytes', async () => {
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
    await seedQueued(store, { id: 'img2', sourceImageId: 'src', useReference: true, prompt: 'remix it' });
    const editImage = vi.fn(async (p: { image: Uint8Array }): Promise<ImageResult[]> => {
      expect(p.image).toHaveLength(3); // bytes from the source download
      return [{ b64: Buffer.from('png').toString('base64') }];
    });
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => []);
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), editImage, generateImage, fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img2');

    expect(editImage).toHaveBeenCalledOnce();
    expect(generateImage).not.toHaveBeenCalled();
    expect((await store.get('userA', 'img2'))?.status).toBe('ready');
  });

  it('is a no-op for an already-terminal record (idempotent redelivery)', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store, { status: 'ready', blobPath: 'userA/images/img1.png' });
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => []);
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img1');
    expect(generateImage).not.toHaveBeenCalled();
  });

  it('surfaces a content-filter error code from the generator', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => {
      throw aiError('content_filtered', 'The response was filtered by the content policy.');
    });
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img1');

    const rec = await store.get('userA', 'img1');
    expect(rec?.status).toBe('error');
    expect(rec?.error?.code).toBe('content_filtered');
  });

  it('does not resurrect a record deleted mid-generation', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => {
      await store.delete('userA', 'img1'); // user deletes while generating
      return [{ b64: Buffer.from('png').toString('base64') }];
    });
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() };

    await processImageJob(deps, 'userA', 'img1');
    expect(await store.get('userA', 'img1')).toBeNull();
  });
});
