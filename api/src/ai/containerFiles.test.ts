import { describe, it, expect, vi } from 'vitest';
import { listContainerFiles, getContainerFile, mimeForFilename } from './containerFiles';

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
  it('returns the raw bytes', async () => {
    const bytes = new Uint8Array([0x25, 0x50, 0x44, 0x46]); // %PDF
    const fetchImpl = vi.fn(async () => ({
      ok: true,
      status: 200,
      arrayBuffer: async () => bytes.buffer,
      headers: new Headers(),
    })) as unknown as typeof fetch;

    const out = await getContainerFile(creds, 'cntr_abc', 'cfile_1', fetchImpl);
    expect(Array.from(out)).toEqual([0x25, 0x50, 0x44, 0x46]);
    const calledUrl = (fetchImpl as unknown as { mock: { calls: unknown[][] } }).mock.calls[0][0] as string;
    expect(calledUrl).toContain('/containers/cntr_abc/files/cfile_1/content');
  });
});
