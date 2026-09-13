import { describe, expect, it, vi } from 'vitest';
import { editImage, generateImage } from './image';

const credentials = {
  baseUrl: 'https://safe.services.ai.azure.com/openai/v1',
  key: 'test-key',
  model: 'gpt-image-2.5-sunburst',
};

function provider() {
  return vi.fn<typeof fetch>(async () => new Response(JSON.stringify({
    data: [{ b64_json: 'aW1hZ2U=', revised_prompt: 'Revised prompt' }],
  })));
}

describe('image request contract', () => {
  it('sends bearer authentication and generation options', async () => {
    const fetchImpl = provider();
    const result = await generateImage({
      ...credentials, prompt: 'A mountain photograph', size: '1024x1024', quality: 'low',
      background: 'auto', outputCompression: 100, outputFormat: 'png', fetchImpl,
    });
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${credentials.baseUrl}/images/generations`);
    expect(init).toMatchObject({
      method: 'POST',
      headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    });
    expect(JSON.parse(init!.body as string)).toEqual({
      model: credentials.model, prompt: 'A mountain photograph', size: '1024x1024', quality: 'low',
      background: 'auto', output_compression: 100, output_format: 'png', n: 1,
    });
    expect(result).toEqual([{ b64: 'aW1hZ2U=', revisedPrompt: 'Revised prompt' }]);
  });

  it('sends source and mask as multipart files without overriding the boundary', async () => {
    const fetchImpl = provider();
    await editImage({
      ...credentials, prompt: 'Make this black and white', image: new Uint8Array([1, 2]),
      imageContentType: 'image/jpeg', mask: new Uint8Array([3, 4]),
      quality: 'low', background: 'transparent', outputCompression: 0, outputFormat: 'webp', fetchImpl,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe(`${credentials.baseUrl}/images/edits`);
    expect(init!.headers).toEqual({ Authorization: 'Bearer test-key' });
    const form = init!.body as FormData;
    expect(form.get('model')).toBe(credentials.model);
    expect(form.get('prompt')).toBe('Make this black and white');
    expect(form.get('output_format')).toBe('webp');
    expect(form.get('output_compression')).toBe('0');
    expect(form.get('background')).toBe('transparent');
    const image = form.get('image') as File;
    const mask = form.get('mask') as File;
    expect(image.type).toBe('image/jpeg');
    expect(mask.type).toBe('image/png');
    expect(new Uint8Array(await image.arrayBuffer())).toEqual(new Uint8Array([1, 2]));
    expect(new Uint8Array(await mask.arrayBuffer())).toEqual(new Uint8Array([3, 4]));
  });

  it('preserves generation defaults and omits unrequested options', async () => {
    const fetchImpl = provider();
    await generateImage({ ...credentials, prompt: 'A mountain photograph', fetchImpl });
    expect(JSON.parse(fetchImpl.mock.calls[0][1]!.body as string)).toEqual({
      model: credentials.model, prompt: 'A mountain photograph', size: '1024x1024', n: 1, output_format: 'png',
    });
  });

  it('preserves multiple references without adding an absent mask', async () => {
    const fetchImpl = provider();
    await editImage({
      ...credentials, prompt: 'Combine references', image: new Uint8Array([1]),
      images: [{ bytes: new Uint8Array([1]) }, { bytes: new Uint8Array([2]), contentType: 'image/webp' }],
      fetchImpl,
    });
    const form = fetchImpl.mock.calls[0][1]!.body as FormData;
    expect(form.getAll('image[]')).toHaveLength(2);
    expect(form.has('image')).toBe(false);
    expect(form.has('mask')).toBe(false);
  });
});