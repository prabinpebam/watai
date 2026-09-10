import { describe, expect, it, vi } from 'vitest';
import type { ImageGenRecord } from '../ports/imageStore';
import { toImageDto } from './imageDto';

function image(blobPath: string): ImageGenRecord {
  return {
    id: 'image-1',
    userId: 'user-1',
    batchId: 'batch-1',
    status: 'ready',
    prompt: 'test',
    size: '1024x1024',
    outputFormat: 'png',
    model: 'image-model',
    blobPath,
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
  };
}

describe('Image DTO asset grants', () => {
  it('mints only for the record owner namespace', async () => {
    const mint = vi.fn(async () => ({ url: 'https://blob/read', expiresAt: '2026' }));
    await expect(toImageDto({ mint }, image('user-1/images/image-1.png'))).resolves.toMatchObject({ url: 'https://blob/read' });
    expect(mint).toHaveBeenCalledTimes(1);

    mint.mockClear();
    await expect(toImageDto({ mint }, image('user-2/images/image-1.png'))).resolves.not.toHaveProperty('url');
    expect(mint).not.toHaveBeenCalled();
  });
});
