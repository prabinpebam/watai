import { afterEach, describe, expect, it, vi } from 'vitest';
import { isImageUpload, normalizeImageUpload } from './imageUpload';

describe('normalizeImageUpload', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it('passes PNG and WebP through unchanged', async () => {
    const png = new File([new Uint8Array([1])], 'image.png', { type: 'image/png' });
    const webp = new File([new Uint8Array([2])], 'image.webp', { type: 'image/webp' });
    expect(await normalizeImageUpload(png)).toBe(png);
    expect(await normalizeImageUpload(webp)).toBe(webp);
  });

  it('recognizes raw HEIC and repairs missing MIME types for portable images', async () => {
    const heic = new File([new Uint8Array([1])], 'IMG_0001.HEIC');
    const png = new File([new Uint8Array([2])], 'export.png');
    expect(isImageUpload(heic)).toBe(true);
    const normalizedPng = await normalizeImageUpload(png);
    expect(normalizedPng.type).toBe('image/png');
    expect(normalizedPng.name).toBe('export.png');
  });

  it('decodes and re-encodes an iPhone JPEG as a clean bounded JPEG', async () => {
    const drawImage = vi.fn();
    const fillRect = vi.fn();
    const canvas = {
      width: 0,
      height: 0,
      getContext: () => ({ drawImage, fillRect, fillStyle: '' }),
      toBlob: (callback: BlobCallback, type?: string) =>
        callback(new Blob([new Uint8Array([9, 8, 7])], { type })),
    } as unknown as HTMLCanvasElement;
    const createElement = document.createElement.bind(document);
    vi.spyOn(document, 'createElement').mockImplementation((tagName: string) =>
      tagName === 'canvas' ? canvas : createElement(tagName));
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:test'),
      revokeObjectURL: vi.fn(),
    });
    class MockImage {
      src = '';
      naturalWidth = 5000;
      naturalHeight = 3750;
      decode = vi.fn(async () => undefined);
    }
    vi.stubGlobal('Image', MockImage);

    const source = new File([new Uint8Array([0xff, 0xd8, 0xff])], 'IMG_7876.jpeg', {
      type: 'image/jpeg',
      lastModified: 123,
    });
    const normalized = await normalizeImageUpload(source);

    expect(normalized).not.toBe(source);
    expect(normalized.name).toBe('IMG_7876.jpg');
    expect(normalized.type).toBe('image/jpeg');
    expect(normalized.lastModified).toBe(123);
    expect(canvas.width).toBe(4096);
    expect(canvas.height).toBe(3072);
    expect(fillRect).toHaveBeenCalledWith(0, 0, 4096, 3072);
    expect(drawImage).toHaveBeenCalledWith(expect.any(MockImage), 0, 0, 4096, 3072);
  });
});
