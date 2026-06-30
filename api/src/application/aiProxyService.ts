import { AppError, type AppErrorCode } from '../domain/errors';
import { aiFetch } from '../ai/http';
import { normalizeHttpError, type AiError } from '../ai/errors';
import { completeChat, type ChatMessage } from '../ai/chat';
import { generateImage } from '../ai/image';
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
  /** Playback speed for Azure OpenAI `/audio/speech` (0.25–4.0). Clamped; defaults to 1.0. */
  speed?: number;
}
export interface ChatProxyInput {
  messages: ChatMessage[];
}
export interface ImageProxyInput {
  prompt: string;
  size?: string;
}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data.replace(/^data:[^;]*;base64,/, ''), 'base64'));
}

/** Azure OpenAI `/audio/speech` accepts `speed` 0.25–4.0; clamp into range and default to 1.0. */
function clampSpeed(speed: number | undefined): number {
  if (typeof speed !== 'number' || !Number.isFinite(speed)) return 1;
  return Math.min(4, Math.max(0.25, speed));
}

/**
 * Map an upstream Azure OpenAI failure (a normalized AiError) to a typed AppError so the real cause —
 * unsupported audio format, wrong deployment name, rate limit, expired key — surfaces with a meaningful
 * status + message instead of collapsing to a generic 500 (anything that isn't an AppError does).
 */
function upstreamError(e: AiError): AppError {
  const code: AppErrorCode =
    e.code === 'unauthorized'
      ? 'unauthorized'
      : e.code === 'forbidden' || e.code === 'tool_unauthorized'
        ? 'forbidden'
        : e.code === 'deployment_not_found'
          ? 'not_found'
          : e.code === 'rate_limited'
            ? 'rate_limited'
            : e.code === 'server_error'
              ? 'internal'
              : 'validation';
  return new AppError(code, e.detail ? `${e.message} (${e.detail})` : e.message);
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
    if (!res.ok) throw upstreamError(await normalizeHttpError(res, 'transcribe'));
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
        speed: clampSpeed(input.speed),
        response_format: 'mp3',
      },
      fetchImpl: this.opts.fetchImpl,
      timeoutMs: 120_000,
    });
    if (!res.ok) throw upstreamError(await normalizeHttpError(res, 'tts'));
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

  async image(userId: string, input: ImageProxyInput): Promise<{ images: Array<{ b64: string }> }> {
    const c = await this.credentials.getDecrypted(userId);
    if (!c.models.image) throw new AppError('validation', 'No image model is configured.');
    const prompt = (input.prompt ?? '').trim();
    if (!prompt) throw new AppError('validation', 'A prompt is required.');
    const images = await generateImage({
      baseUrl: c.baseUrl,
      key: c.key,
      model: c.models.image,
      prompt,
      ...(input.size ? { size: input.size } : {}),
      fetchImpl: this.opts.fetchImpl,
    });
    return { images };
  }
}
