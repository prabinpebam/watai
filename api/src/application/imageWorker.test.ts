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
  it.each(['trashed', 'purged', 'foreign', 'wrong-id', 'create-conflict', 'purged-after-create', 'active'] as const)('preserves unavailable Library records during image publication: %s', async state => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const id = libraryItemIdFor('userA', 'studio_generated_image', 'img1');
    const tombstone = { id, userId: 'userA', state: 'purged' } as LibraryItemRecord;
    let current = ['create-conflict', 'purged-after-create'].includes(state) ? null : {
      id: state === 'wrong-id' ? 'other' : id, userId: state === 'foreign' ? 'userB' : 'userA',
      state: state === 'trashed' ? 'trashed' : state === 'purged' ? 'purged' : 'active',
    } as LibraryItemRecord;
    const put = vi.fn(async (record: LibraryItemRecord) => { current = record; return record; });
    const createIfAbsent = vi.fn(async () => { current = tombstone; return state === 'create-conflict' ? null : tombstone; });
    const upload = vi.fn(async () => new Response(null, { status: 201 }));
    await processImageJob({ imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(),
      generateImage: async () => [{ b64: Buffer.from('png').toString('base64') }], fetchImpl: upload,
      libraryStore: { get: async () => current, put, createIfAbsent } as unknown as LibraryStore,
    }, 'userA', 'img1');
    expect((await store.get('userA', 'img1'))?.status).toBe(state === 'active' ? 'ready' : 'error');
    expect(put).not.toHaveBeenCalled();
    expect(upload).toHaveBeenCalledTimes(['create-conflict', 'purged-after-create', 'active'].includes(state) ? 1 : 0);
    if (state === 'create-conflict' || state === 'purged-after-create') expect(current).toEqual(tombstone);
  });

  it('handles heartbeat storage failure without aborting the accepted image job', async () => {
    vi.useFakeTimers();
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const transition = store.transition.bind(store);
    vi.spyOn(store, 'transition').mockImplementation((...args) => args[3].status === undefined
      ? Promise.reject(new Error('Heartbeat storage unavailable')) : transition(...args));
    let resolve!: (results: ImageResult[]) => void;
    const result = new Promise<ImageResult[]>(done => { resolve = done; });
    const generateImage = vi.fn(() => result);
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const running = processImageJob({ imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() }, 'userA', 'img1');
    try {
      await vi.waitFor(() => expect(generateImage).toHaveBeenCalledOnce());
      await vi.advanceTimersByTimeAsync(60_000);
      expect(warn).toHaveBeenCalledWith('[image] Heartbeat update unavailable.');
      resolve([{ b64: Buffer.from('png').toString('base64') }]);
      await running;
      expect((await store.get('userA', 'img1'))?.status).toBe('ready');
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      resolve([]);
      await running;
      warn.mockRestore();
      vi.useRealTimers();
    }
  });

  it('does not persist or push unexpected provider error payloads', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const { signalr, sends } = fakeSignalR();
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => { throw new Error('Private provider payload; credential=synthetic-secret'); });
    await processImageJob({ imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), signalr, generateImage, fetchImpl: okFetch() }, 'userA', 'img1');
    expect((await store.get('userA', 'img1'))?.error).toEqual({ code: 'internal', message: 'Image generation failed.' });
    expect(JSON.stringify(sends)).not.toContain('synthetic-secret');
  });

  it('starts provider work only once for overlapping delivery of the same image job', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store, { releaseId: 'release', executionToken: 'original', dispatchAttempt: 1 });
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => [{ b64: Buffer.from('png').toString('base64') }]);
    const deps: ImageWorkerDeps = { imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() };
    await Promise.all([processImageJob(deps, 'userA', 'img1'), processImageJob(deps, 'userA', 'img1')]);
    expect(generateImage).toHaveBeenCalledOnce();
    expect((await store.get('userA', 'img1'))?.status).toBe('ready');
  });

  it.each(['success', 'error'] as const)('does not finalize a replacement execution after late %s', async outcome => {
    const store = new InMemoryImageStore();
    await seedQueued(store, { releaseId: 'release', executionToken: 'original', dispatchAttempt: 1 });
    const replaceExecution = async () => {
      const current = (await store.get('userA', 'img1'))!;
      await store.put({ ...current, executionToken: 'replacement', dispatchAttempt: 2 });
    };
    const libraryStore = { get: async () => null, createIfAbsent: async (record: LibraryItemRecord) => { await replaceExecution(); return record; } } as unknown as LibraryStore;
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => {
      if (outcome === 'error') { await replaceExecution(); throw new Error('Old provider failure'); }
      return [{ b64: Buffer.from('png').toString('base64') }];
    });
    await processImageJob({ imageStore: store, libraryStore, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch() }, 'userA', 'img1');
    expect(await store.get('userA', 'img1')).toMatchObject({ status: 'generating', executionToken: 'replacement', dispatchAttempt: 2, error: null });
  });

  it('completes image generation even when realtime notifications fail', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store);
    const sendToUser = vi.fn(async () => { throw new Error('Realtime unavailable'); });
    const signalr = { sendToUser } as unknown as SignalRSender;
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => [{ b64: Buffer.from('png').toString('base64') }]);
    await expect(processImageJob({ imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), signalr, generateImage, fetchImpl: okFetch() }, 'userA', 'img1')).resolves.toBeUndefined();
    expect((await store.get('userA', 'img1'))?.status).toBe('ready');
    expect(generateImage).toHaveBeenCalledOnce();
  });

  it.each(['credentials', 'source-download'] as const)('does not start provider work after deletion during %s', async stage => {
    const store = new InMemoryImageStore();
    await seedQueued(store, stage === 'source-download' ? { sourceImageId: 'source', useReference: true } : {});
    await seedQueued(store, { id: 'source', status: 'ready', blobPath: 'userA/images/source.png' });
    const credentials = { getDecrypted: async (userId: string) => {
      if (stage === 'credentials') await store.delete(userId, 'img1');
      return creds('gpt-image-1').getDecrypted();
    } };
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => [{ b64: Buffer.from('png').toString('base64') }]);
    const editImage = vi.fn(async (): Promise<ImageResult[]> => [{ b64: Buffer.from('png').toString('base64') }]);
    const fetchImpl = vi.fn(async () => {
      if (stage === 'source-download') await store.delete('userA', 'source');
      return new Response(new Uint8Array([1, 2, 3]), { status: 200 });
    });
    await processImageJob({ imageStore: store, credentials, minter, clock: makeClock(), generateImage, editImage, fetchImpl }, 'userA', 'img1');
    expect(generateImage).not.toHaveBeenCalled();
    expect(editImage).not.toHaveBeenCalled();
    if (stage === 'source-download') expect((await store.get('userA', 'img1'))?.error?.code).toBe('source_missing');
  });

  it.each(['generation', 'upload', 'library-read', 'authority-change'] as const)('does not publish stale image output after %s', async stage => {
    const store = new InMemoryImageStore();
    await seedQueued(store, { releaseId: 'release', executionToken: 'original', dispatchAttempt: 1 });
    const { signalr, sends } = fakeSignalR();
    const putLibrary = vi.fn(async (record: LibraryItemRecord) => record);
    const libraryStore = { get: async () => {
      if (stage === 'library-read') await store.delete('userA', 'img1');
      return null;
    }, put: putLibrary, createIfAbsent: putLibrary } as unknown as LibraryStore;
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => {
      if (stage === 'generation') await store.delete('userA', 'img1');
      if (stage === 'authority-change') {
        const current = (await store.get('userA', 'img1'))!;
        await store.put({ ...current, executionToken: 'replacement' });
      }
      return [{ b64: Buffer.from('png').toString('base64') }];
    });
    const upload = vi.fn(async () => {
      if (stage === 'upload') await store.delete('userA', 'img1');
      return new Response(null, { status: 201 });
    });
    await processImageJob({ imageStore: store, libraryStore, credentials: creds('gpt-image-1'), minter, clock: makeClock(), signalr, generateImage, fetchImpl: upload as typeof fetch }, 'userA', 'img1');
    expect(upload).toHaveBeenCalledTimes(stage === 'upload' ? 1 : 0);
    expect(putLibrary).not.toHaveBeenCalled();
    expect(sends.map(send => (send.payload as { image: ImageGenRecord }).image.status)).toEqual(['generating']);
    expect((await store.get('userA', 'img1'))?.status).not.toBe('ready');
  });

  it('rejects stale release or execution-token queue authority', async () => {
    const store = new InMemoryImageStore();
    await seedQueued(store, { releaseId: 'release-new', executionToken: 'token-new', dispatchAttempt: 2 });
    const generateImage = vi.fn(async (): Promise<ImageResult[]> => [{ b64: Buffer.from('x').toString('base64') }]);
    const workerDeps: ImageWorkerDeps = {
      imageStore: store, credentials: creds('gpt-image-1'), minter, clock: makeClock(), generateImage, fetchImpl: okFetch(),
    };
    await processImageJob(workerDeps, 'userA', 'img1', {
      releaseId: 'release-old', executionToken: 'token-old', attempt: 1,
    });
    expect(generateImage).not.toHaveBeenCalled();
    expect((await store.get('userA', 'img1'))?.status).toBe('queued');
  });

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
      createIfAbsent: async (item: LibraryItemRecord) => {
        if (library.has(item.id)) return null;
        library.set(item.id, item);
        return item;
      },
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
