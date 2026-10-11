import { describe, it, expect, vi } from 'vitest';
import { MAX_CONTAINER_FILE_BYTES, listContainerFiles, getContainerFile, mimeForFilename } from './containerFiles';

const creds = { baseUrl: 'https://r.services.ai.azure.com/openai/v1', key: 'k' };

function jsonResponse(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 500,
    json: async () => body,
    text: async () => JSON.stringify(body),
    headers: new Headers(),
  } as unknown as Response;
}

describe('mimeForFilename', () => {
  it('maps extensions to mimes and defaults to octet-stream', () => {
    expect(mimeForFilename('report.pdf')).toBe('application/pdf');
    expect(mimeForFilename('data.csv')).toBe('text/csv');
    expect(mimeForFilename('deck.pptx')).toBe(
      'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    );
    expect(mimeForFilename('chart.PNG')).toBe('image/png');
    expect(mimeForFilename('weird.xyz')).toBe('application/octet-stream');
  });
});

describe('listContainerFiles', () => {
  it('parses the data array, derives filename from path, and keeps source/bytes', async () => {
    const fetchImpl = vi.fn(async () =>
      jsonResponse({
        data: [
          { id: 'cfile_1', path: '/mnt/data/report.pdf', source: 'assistant', bytes: 4528 },
          { id: 'cfile_2', path: '/mnt/data/input.csv', source: 'user' },
          { notAnId: true },
        ],
      }),
    ) as unknown as typeof fetch;

    const files = await listContainerFiles(creds, 'cntr_abc', fetchImpl);

    expect(files).toEqual([
      { id: 'cfile_1', path: '/mnt/data/report.pdf', filename: 'report.pdf', source: 'assistant', bytes: 4528 },
      { id: 'cfile_2', path: '/mnt/data/input.csv', filename: 'input.csv', source: 'user' },
    ]);
    // Hit the containers list endpoint on the v1 host.
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/containers/cntr_abc/files');
  });

  it('throws a normalized error on a non-ok response', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ error: { message: 'nope' } }, false)) as unknown as typeof fetch;
    await expect(listContainerFiles(creds, 'cntr_x', fetchImpl)).rejects.toBeTruthy();
  });
});

describe('getContainerFile', () => {
  it('retains the configured deadline through a stalled artifact body', async () => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    try {
      let failure: unknown;
      const request = getContainerFile(creds, 'container', 'file', vi.fn(async () => new Response(body)))
        .catch(error => { failure = error; });
      await vi.advanceTimersByTimeAsync(120001);
      const observed = failure;
      if (!observed) controller.error(new Error('Fixture cleanup'));
      await request;
      expect(observed).toMatchObject({ name: 'AbortError' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
    } finally { vi.useRealTimers(); }
  });

  it.each([0, -1, 1.5, NaN, Infinity, MAX_CONTAINER_FILE_BYTES + 1])('rejects an invalid byte limit before requesting data: %s', async maxBytes => {
    const fetchImpl = vi.fn();
    await expect(getContainerFile(creds, 'container', 'file', fetchImpl, maxBytes)).rejects.toThrow('Invalid artifact byte limit.');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('cancels overflow and releases the reader even when cancellation rejects', async () => {
    const cancel = vi.fn(async () => { throw new Error('Cancellation transport error'); });
    const body = new ReadableStream<Uint8Array>({ start(controller) { controller.enqueue(new Uint8Array([1, 2, 3, 4, 5])); }, cancel });
    await expect(getContainerFile(creds, 'container', 'file', vi.fn(async () => new Response(body)), 4))
      .rejects.toThrow('Artifact exceeds the byte limit.');
    expect(cancel).toHaveBeenCalledOnce();
    expect(body.locked).toBe(false);
  });

  it('releases the reader after a body failure without masking it', async () => {
    const body = new ReadableStream<Uint8Array>({ pull(controller) { controller.error(new Error('Body read failed')); } });
    await expect(getContainerFile(creds, 'container', 'file', vi.fn(async () => new Response(body)), 4))
      .rejects.toThrow('Body read failed');
    expect(body.locked).toBe(false);
  });

  it('accepts an empty response without a body', async () => {
    const result = await getContainerFile(creds, 'container', 'file', vi.fn(async () => new Response(null)), 4);
    expect(result).toEqual(new Uint8Array());
  });

  it.each(['large-header', 'no-header', 'understated', 'exact', 'empty'] as const)('bounds artifact bytes before full-body allocation: %s', async state => {
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(controller) {
      if (state !== 'empty') {
        controller.enqueue(new Uint8Array([1, 2]));
        controller.enqueue(new Uint8Array(state === 'exact' ? [3, 4] : [3, 4, 5]));
      }
      controller.close();
    }, cancel });
    const response = new Response(body, { headers: state === 'large-header' ? { 'Content-Length': '999999999' } :
      state === 'understated' ? { 'Content-Length': '1' } : {} });
    const fullBuffer = vi.spyOn(response, 'arrayBuffer');
    const fetchImpl = vi.fn(async () => response);
    const result = getContainerFile(creds, 'container', 'file', fetchImpl, 4);
    if (state === 'exact' || state === 'empty') expect((await result).length).toBe(state === 'empty' ? 0 : 4);
    else await expect(result).rejects.toThrow('Artifact exceeds the byte limit.');
    expect(fullBuffer).not.toHaveBeenCalled();
    expect(body.locked).toBe(false);
    if (state === 'large-header') expect(cancel).toHaveBeenCalledOnce();
  });

  it('returns the raw bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const fetchImpl = vi.fn(async () => new Response(bytes)) as unknown as typeof fetch;

    const out = await getContainerFile(creds, 'cntr_abc', 'cfile_1', fetchImpl);
    expect(Array.from(out)).toEqual([0x25, 0x50, 0x44, 0x46]);
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/containers/cntr_abc/files/cfile_1/content');
  });
});
