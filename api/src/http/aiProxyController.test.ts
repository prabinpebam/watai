import { describe, expect, it, vi } from 'vitest';
import { createAiProxyController } from './aiProxyController';
import type { AiProxyService } from '../application/aiProxyService';

describe('aiProxyController transcription', () => {
  it('extracts multipart audio bytes and MIME', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'hello' });
    const controller = createAiProxyController({ transcribe } as unknown as AiProxyService);
    const form = new FormData();
    form.append('file', new Blob(['mobile-audio'], { type: 'audio/mp4' }), 'audio.m4a');
    form.append('mime', 'audio/mp4');

    const result = await controller.transcribe({ claims: { sub: 'userA' }, body: form });

    expect(result.status).toBe(200);
    expect(transcribe).toHaveBeenCalledOnce();
    const input = transcribe.mock.calls[0][1];
    expect(input.mime).toBe('audio/mp4');
    expect(new TextDecoder().decode(input.audio)).toBe('mobile-audio');
  });

  it('accepts legacy base64 JSON during client rollout', async () => {
    const transcribe = vi.fn().mockResolvedValue({ text: 'hello' });
    const controller = createAiProxyController({ transcribe } as unknown as AiProxyService);

    const result = await controller.transcribe({
      claims: { sub: 'userA' },
      body: { audioBase64: Buffer.from('legacy').toString('base64'), mime: 'audio/webm' },
    });

    expect(result.status).toBe(200);
    expect(new TextDecoder().decode(transcribe.mock.calls[0][1].audio)).toBe('legacy');
  });
});
