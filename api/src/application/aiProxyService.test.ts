import { describe, it, expect, vi } from 'vitest';
import { AiProxyService } from './aiProxyService';

function creds(models: Record<string, string>) {
  return {
    getDecrypted: async () => ({ baseUrl: 'https://r.services.ai.azure.com/openai/v1', key: 'k', models: { chat: 'gpt', ...models } }),
  };
}

describe('AiProxyService', () => {
  it('transcribes audio via the vault credentials', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'hello world' }) });
    const svc = new AiProxyService(creds({ transcribe: 'whisper' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.transcribe('u', { audioBase64: Buffer.from('AUDIO').toString('base64'), mime: 'audio/webm' });
    expect(out.text).toBe('hello world');
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/audio/transcriptions');
    expect(init.headers.Authorization).toBe('Bearer k');
  });

  it('rejects transcription when no model is configured', async () => {
    const svc = new AiProxyService(creds({}));
    await expect(svc.transcribe('u', { audioBase64: 'AAA' })).rejects.toThrow();
  });

  it('surfaces an upstream transcription failure with its real cause (not a generic 500)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 400,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: 'Audio file could not be decoded.' } }),
    });
    const svc = new AiProxyService(creds({ transcribe: 'whisper' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await svc.transcribe('u', { audioBase64: Buffer.from('A').toString('base64') }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AppError', code: 'validation' });
    expect(String(err.message)).toContain('Audio file could not be decoded.');
  });

  it('maps an upstream 404 (deployment not found) to a not_found error', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({
      ok: false,
      status: 404,
      headers: { get: () => null },
      text: async () => JSON.stringify({ error: { message: 'The API deployment for this resource does not exist.' } }),
    });
    const svc = new AiProxyService(creds({ transcribe: 'whisper' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const err = await svc.transcribe('u', { audioBase64: Buffer.from('A').toString('base64') }).catch((e) => e);
    expect(err).toMatchObject({ name: 'AppError', code: 'not_found' });
  });

  it('routes Azure transcription via the classic deployment path (the v1 surface 404s for transcribe models)', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'hi' }) });
    const svc = new AiProxyService(creds({ transcribe: 'gpt-4o-transcribe' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.transcribe('u', { audioBase64: Buffer.from('A').toString('base64') });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).toContain('.cognitiveservices.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions');
    expect(url).toContain('api-version=');
  });

  it('routes non-Azure (OpenAI) transcription via the v1 path with the model in the body', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, json: async () => ({ text: 'hi' }) });
    const openai = {
      getDecrypted: async () => ({ baseUrl: 'https://api.openai.com/v1', key: 'k', models: { chat: 'g', transcribe: 'whisper-1' } }),
    };
    const svc = new AiProxyService(openai, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.transcribe('u', { audioBase64: Buffer.from('A').toString('base64') });
    const url = String(fetchImpl.mock.calls[0][0]);
    expect(url).not.toContain('/openai/deployments/');
    expect(url).toContain('/audio/transcriptions');
  });

  it('synthesizes speech and returns base64 audio', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer });
    const svc = new AiProxyService(creds({ tts: 'tts-1' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.speak('u', { input: 'hi' });
    expect(out.mime).toBe('audio/mpeg');
    expect(Buffer.from(out.audioBase64, 'base64').toString()).toBe('MP3');
  });

  it('forwards the selected voice and a clamped speed to /audio/speech', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer });
    const svc = new AiProxyService(creds({ tts: 'tts-1' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.speak('u', { input: 'hello', voice: 'nova', speed: 5 }); // 5 is out of range → clamped to 4
    const [url, init] = fetchImpl.mock.calls[0];
    expect(String(url)).toContain('/audio/speech');
    const body = JSON.parse(init.body as string);
    expect(body).toMatchObject({ model: 'tts-1', voice: 'nova', speed: 4, input: 'hello' });
  });

  it('defaults speed to 1 and voice to alloy when unspecified, and floors speed at 0.25', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true, arrayBuffer: async () => new TextEncoder().encode('MP3').buffer });
    const svc = new AiProxyService(creds({ tts: 'tts-1' }), { fetchImpl: fetchImpl as unknown as typeof fetch });
    await svc.speak('u', { input: 'hi' });
    expect(JSON.parse(fetchImpl.mock.calls[0][1].body as string)).toMatchObject({ voice: 'alloy', speed: 1 });
    await svc.speak('u', { input: 'hi', speed: 0 }); // below range → floored to 0.25
    expect(JSON.parse(fetchImpl.mock.calls[1][1].body as string).speed).toBe(0.25);
  });

  it('proxies a non-streaming chat completion', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'reply' } }] }) });
    const svc = new AiProxyService(creds({}), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.chat('u', { messages: [{ role: 'user', content: 'hi' }] });
    expect(out.text).toBe('reply');
  });
});
