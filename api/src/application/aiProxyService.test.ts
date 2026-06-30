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
