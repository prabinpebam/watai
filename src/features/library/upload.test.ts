import { afterEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  reserve: vi.fn(),
  complete: vi.fn(),
}));
vi.mock('../../data', () => ({ cloudApi: { reserveLibraryUpload: mocks.reserve, completeLibraryUpload: mocks.complete } }));

import { uploadToLibrary } from './upload';

afterEach(() => vi.unstubAllGlobals());

describe('Library direct upload', () => {
  it.each(['before-start', 'reservation', 'retry', 'completion'])('stops cancelled upload continuations at %s', async stage => {
    const controller = new AbortController();
    const reservation = { item: { id: 'pending' }, upload: { url: 'https://blob.test/write', headers: {} } };
    mocks.reserve.mockImplementation(async () => {
      if (stage === 'reservation') controller.abort();
      return reservation;
    });
    const fetch = vi.fn(async () => {
      if (stage === 'retry') controller.abort();
      return new Response(null, { status: stage === 'retry' ? 500 : 201 });
    });
    vi.stubGlobal('fetch', fetch);
    mocks.complete.mockImplementation(async () => { controller.abort(); return { id: 'pending', state: 'active' }; });
    const file = new File(['PDF'], 'brief.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('PDF').buffer });
    const progress = vi.fn();
    if (stage === 'before-start') controller.abort();
    await expect(uploadToLibrary(file, progress, { reserveLibraryUpload: mocks.reserve, completeLibraryUpload: mocks.complete }, controller.signal)).rejects.toMatchObject({ name: 'AbortError' });
    expect(mocks.reserve).toHaveBeenCalledTimes(stage === 'before-start' ? 0 : 1);
    expect(fetch).toHaveBeenCalledTimes(stage === 'retry' || stage === 'completion' ? 1 : 0);
    expect(mocks.complete).toHaveBeenCalledTimes(stage === 'completion' ? 1 : 0);
    expect(progress).not.toHaveBeenCalledWith(100);
  });

  beforeEach(() => {
    mocks.reserve.mockReset().mockResolvedValue({ item: { id: 'pending-1' }, upload: { url: 'https://blob.test/write', expiresAt: 'later', headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'application/pdf' } } });
    mocks.complete.mockReset().mockResolvedValue({ id: 'pending-1', state: 'active' });
    vi.stubGlobal('crypto', { subtle: { digest: vi.fn(async () => new Uint8Array(32).fill(1).buffer) } });
  });

  it('reserves, PUTs, and finalizes one item with visible progress', async () => {
    const fetchMock = vi.fn(async () => new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['PDF'], 'brief.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('PDF').buffer });
    const progress: number[] = [];
    const result = await uploadToLibrary(file, (value) => progress.push(value));
    expect(mocks.reserve).toHaveBeenCalledWith(expect.objectContaining({ name: 'brief.pdf', mime: 'application/pdf', bytes: 3, contentHash: expect.stringMatching(/^sha256:/) }));
    expect(fetchMock).toHaveBeenCalledWith('https://blob.test/write', expect.objectContaining({ method: 'PUT', body: file }));
    expect(mocks.complete).toHaveBeenCalledWith('pending-1', expect.objectContaining({ bytes: 3 }));
    expect(progress).toEqual([15, 85, 100]);
    expect(result).toMatchObject({ state: 'active' });
  });

  it('retries the same reservation once instead of creating a duplicate item', async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 500 }))
      .mockResolvedValueOnce(new Response(null, { status: 201 }));
    vi.stubGlobal('fetch', fetchMock);
    const file = new File(['PDF'], 'brief.pdf', { type: 'application/pdf' });
    Object.defineProperty(file, 'arrayBuffer', { value: async () => new TextEncoder().encode('PDF').buffer });
    await uploadToLibrary(file);
    expect(mocks.reserve).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(mocks.complete).toHaveBeenCalledTimes(1);
  });
});
