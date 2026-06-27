import { describe, it, expect, beforeEach, vi } from 'vitest';
import type { StudioImage } from '../../data/cloud/types';

const mocks = vi.hoisted(() => ({
  createImages: vi.fn(),
  listImages: vi.fn(),
  getImage: vi.fn(),
  deleteImage: vi.fn(),
  getCredentialStatus: vi.fn(),
  on: vi.fn(() => () => {}),
  ensure: vi.fn(async () => true),
}));

vi.mock('../../data', () => ({
  cloudApi: {
    createImages: mocks.createImages,
    listImages: mocks.listImages,
    getImage: mocks.getImage,
    deleteImage: mocks.deleteImage,
    getCredentialStatus: mocks.getCredentialStatus,
  },
  realtime: { on: mocks.on, ensure: mocks.ensure },
}));

import { useImageStudio, hasPendingImages } from './imageStudioStore';

function img(over: Partial<StudioImage> = {}): StudioImage {
  return {
    id: 'i1',
    userId: 'u',
    batchId: 'b',
    status: 'ready',
    prompt: 'p',
    size: '1024x1024',
    outputFormat: 'png',
    model: 'm',
    createdAt: '2026',
    updatedAt: '2026',
    url: 'http://x',
    ...over,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  useImageStudio.setState({
    images: [],
    cursor: undefined,
    generating: false,
    lightboxId: null,
    prompt: '',
    size: '1024x1024',
    count: 1,
    quality: 'medium',
    remix: null,
    useReference: true,
  });
});

describe('applyServerImage', () => {
  it('updates an existing image in place and adopts the new url', () => {
    useImageStudio.setState({ images: [img({ id: 'a', status: 'generating', url: undefined })] });
    useImageStudio.getState().applyServerImage(img({ id: 'a', status: 'ready', url: 'http://new' }));
    const list = useImageStudio.getState().images;
    expect(list).toHaveLength(1);
    expect(list[0].status).toBe('ready');
    expect(list[0].url).toBe('http://new');
  });

  it('keeps a prior url when a later push omits it', () => {
    useImageStudio.setState({ images: [img({ id: 'a', status: 'ready', url: 'http://kept' })] });
    useImageStudio.getState().applyServerImage(img({ id: 'a', status: 'ready', url: undefined }));
    expect(useImageStudio.getState().images[0].url).toBe('http://kept');
  });

  it('prepends an unseen image (cross-device push)', () => {
    useImageStudio.setState({ images: [img({ id: 'a' })] });
    useImageStudio.getState().applyServerImage(img({ id: 'b' }));
    expect(useImageStudio.getState().images.map((i) => i.id)).toEqual(['b', 'a']);
  });
});

describe('generate', () => {
  it('prepends queued placeholders and clears the prompt', async () => {
    mocks.createImages.mockResolvedValue([img({ id: 'q1', status: 'queued', url: undefined })]);
    useImageStudio.setState({ prompt: 'a fox', count: 2 });
    const res = await useImageStudio.getState().generate();
    expect(res.ok).toBe(true);
    expect(mocks.createImages).toHaveBeenCalledWith(expect.objectContaining({ prompt: 'a fox', count: 2 }));
    expect(useImageStudio.getState().images[0].id).toBe('q1');
    expect(useImageStudio.getState().prompt).toBe('');
  });

  it('passes remix lineage and clears remix afterwards', async () => {
    mocks.createImages.mockResolvedValue([img({ id: 'r1', status: 'queued' })]);
    useImageStudio.setState({ prompt: 'remix', remix: { id: 'src', prompt: 'x', size: '1024x1024' }, useReference: true });
    await useImageStudio.getState().generate();
    expect(mocks.createImages).toHaveBeenCalledWith(expect.objectContaining({ sourceImageId: 'src', useReference: true }));
    expect(useImageStudio.getState().remix).toBeNull();
  });

  it('returns the error message on failure', async () => {
    const { CloudError } = await import('../../data/cloud/apiClient');
    mocks.createImages.mockRejectedValue(new CloudError('validation', 'No image model is configured.', 400));
    useImageStudio.setState({ prompt: 'x' });
    const res = await useImageStudio.getState().generate();
    expect(res.ok).toBe(false);
    expect(res.error).toContain('No image model');
  });

  it('is a no-op with an empty prompt', async () => {
    useImageStudio.setState({ prompt: '   ' });
    const res = await useImageStudio.getState().generate();
    expect(res.ok).toBe(false);
    expect(mocks.createImages).not.toHaveBeenCalled();
  });
});

describe('remove', () => {
  it('optimistically removes and calls deleteImage', async () => {
    mocks.deleteImage.mockResolvedValue(undefined);
    useImageStudio.setState({ images: [img({ id: 'a' }), img({ id: 'b' })] });
    await useImageStudio.getState().remove('a');
    expect(mocks.deleteImage).toHaveBeenCalledWith('a');
    expect(useImageStudio.getState().images.map((i) => i.id)).toEqual(['b']);
  });

  it('rolls back if the delete fails', async () => {
    mocks.deleteImage.mockRejectedValue(new Error('boom'));
    useImageStudio.setState({ images: [img({ id: 'a' })] });
    await useImageStudio.getState().remove('a');
    expect(useImageStudio.getState().images.map((i) => i.id)).toEqual(['a']);
  });
});

describe('startRemix', () => {
  it('pre-fills the composer from a source image', () => {
    const src = img({ id: 's', prompt: 'orig prompt', size: '1024x1536' });
    useImageStudio.getState().startRemix(src);
    const st = useImageStudio.getState();
    expect(st.prompt).toBe('orig prompt');
    expect(st.size).toBe('1024x1536');
    expect(st.remix?.id).toBe('s');
    expect(st.useReference).toBe(true);
    expect(st.lightboxId).toBeNull();
  });
});

describe('hasPendingImages', () => {
  it('detects queued/generating images', () => {
    expect(hasPendingImages([img({ status: 'ready' })])).toBe(false);
    expect(hasPendingImages([img({ status: 'queued' })])).toBe(true);
    expect(hasPendingImages([img({ status: 'generating' })])).toBe(true);
  });
});
