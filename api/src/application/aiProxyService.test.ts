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

  it('proxies a non-streaming chat completion', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue({ ok: true, json: async () => ({ choices: [{ message: { content: 'reply' } }] }) });
    const svc = new AiProxyService(creds({}), { fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.chat('u', { messages: [{ role: 'user', content: 'hi' }] });
    expect(out.text).toBe('reply');
  });
});
