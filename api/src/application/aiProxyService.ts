import { AppError } from '../domain/errors';
import { aiFetch } from '../ai/http';
import { normalizeHttpError } from '../ai/errors';
import { completeChat, type ChatMessage } from '../ai/chat';
import type { CredentialDecryptor } from './threadFilesService';

export interface TranscribeInput {
  audioBase64: string;
  mime?: string;
  language?: string;
  prompt?: string;
}
export interface SpeakInput {
  input: string;
  voice?: string;
}
export interface ChatProxyInput {
  messages: ChatMessage[];
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data.replace(/^data:[^;]*;base64,/, ''), 'base64'));
}

/**
 * Server-side proxies for the audio + simple-chat features (dictation, voice mode) so the client
 * never needs the AI key locally. Each call decrypts the user's vault credentials and forwards to
 * Azure OpenAI; nothing here is persisted.
 */
export class AiProxyService {
  constructor(
    private readonly credentials: CredentialDecryptor,
    private readonly opts: { fetchImpl?: typeof fetch } = {},
  ) {}

  async transcribe(userId: string, input: TranscribeInput): Promise<{ text: string }> {
    const c = await this.credentials.getDecrypted(userId);
    if (!c.models.transcribe) throw new AppError('validation', 'No transcription model is configured.');
    const bytes = decodeBase64(input.audioBase64 ?? '');
    if (!bytes.byteLength) throw new AppError('validation', 'No audio was provided.');
    const mime = input.mime || 'audio/webm';
    const form = new FormData();
    form.append('model', c.models.transcribe);
    form.append('file', new Blob([bytes], { type: mime }), mime.includes('wav') ? 'audio.wav' : 'audio.webm');
    form.append('response_format', 'json');
    if (input.language) form.append('language', input.language);
    if (input.prompt) form.append('prompt', input.prompt);
    const res = await aiFetch({
      baseUrl: c.baseUrl,
      key: c.key,
      path: '/audio/transcriptions',
      body: form,
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: 120_000,
    });
    if (!res.ok) throw await normalizeHttpError(res, 'transcribe');
    const json = (await res.json()) as { text?: string };
    return { text: json.text ?? '' };
  }

  async speak(userId: string, input: SpeakInput): Promise<{ audioBase64: string; mime: string }> {
    const c = await this.credentials.getDecrypted(userId);
    if (!c.models.tts) throw new AppError('validation', 'No text-to-speech model is configured.');
    const res = await aiFetch({
      baseUrl: c.baseUrl,
      key: c.key,
      path: '/audio/speech',
      body: {
        model: c.models.tts,
        input: (input.input ?? '').slice(0, 4000),
        voice: input.voice ?? 'alloy',
        response_format: 'mp3',
      },
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: 120_000,
    });
    if (!res.ok) throw await normalizeHttpError(res, 'tts');
    const buf = new Uint8Array(await res.arrayBuffer());
    return { audioBase64: Buffer.from(buf).toString('base64'), mime: 'audio/mpeg' };
  }

  async chat(userId: string, input: ChatProxyInput): Promise<{ text: string }> {
    const c = await this.credentials.getDecrypted(userId);
    const text = await completeChat({
      baseUrl: c.baseUrl,
      key: c.key,
      model: c.models.chat,
      messages: input.messages ?? [],
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: 60_000,
    });
    return { text };
  }
}
