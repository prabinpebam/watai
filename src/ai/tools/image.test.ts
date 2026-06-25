import { describe, it, expect, vi } from 'vitest';
import { generateImageTool, runGenerateImage } from './image';

describe('generate_image tool definition', () => {
  it('is a function tool named generate_image', () => {
    expect(generateImageTool.type).toBe('function');
    expect(generateImageTool.name).toBe('generate_image');
  });

  it('requires a prompt and exposes size + quality enums', () => {
    const params = generateImageTool.parameters as {
      required: string[];
      properties: { size: { enum: string[] }; quality: { enum: string[] } };
    };
    expect(params.required).toContain('prompt');
    expect(params.properties.size.enum).toContain('1024x1536');
    expect(params.properties.quality.enum).toEqual(['low', 'medium', 'high']);
  });
});

describe('runGenerateImage', () => {
  const okConfig = vi.fn(async () => ({ models: { image: 'gpt 2' } }) as never);

  it('returns a friendly message and no image when no prompt is given', async () => {
    const generate = vi.fn();
    const res = await runGenerateImage({}, { generate, getConfig: okConfig });
    expect(generate).not.toHaveBeenCalled();
    expect(res.image).toBeUndefined();
    expect(res.output).toMatch(/no prompt/i);
  });

  it('generates with the configured model, default size/quality, and returns provenance', async () => {
    const generate = vi.fn(async () => [{ b64: 'IMG' }]);
    const res = await runGenerateImage({ prompt: '  a cat  ' }, { generate, getConfig: okConfig });
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ prompt: 'a cat', size: '1024x1024', quality: 'medium' }),
    );
    expect(res.image).toMatchObject({
      b64: 'IMG',
      prompt: 'a cat',
      size: '1024x1024',
      expandedPrompt: 'a cat',
      model: 'gpt 2',
    });
    expect(res.output).toMatch(/generated/i);
  });

  it('honors an explicit size and quality', async () => {
    const generate = vi.fn(async () => [{ b64: 'IMG' }]);
    await runGenerateImage(
      { prompt: 'x', size: '1536x1024', quality: 'high' },
      { generate, getConfig: okConfig },
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1536x1024', quality: 'high' }),
    );
  });

  it('falls back to defaults for invalid size/quality values', async () => {
    const generate = vi.fn(async () => [{ b64: 'IMG' }]);
    await runGenerateImage(
      { prompt: 'x', size: 'huge', quality: 'ultra' },
      { generate, getConfig: okConfig },
    );
    expect(generate).toHaveBeenCalledWith(
      expect.objectContaining({ size: '1024x1024', quality: 'medium' }),
    );
  });

  it('reports when generation returns no image', async () => {
    const res = await runGenerateImage(
      { prompt: 'x' },
      { generate: vi.fn(async () => []), getConfig: okConfig },
    );
    expect(res.image).toBeUndefined();
    expect(res.output).toMatch(/no image/i);
  });
});
