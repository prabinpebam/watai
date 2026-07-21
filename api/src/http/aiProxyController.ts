import { identityFromClaims } from '../auth/identity';
import { AppError } from '../domain/errors';
import type { AiProxyService } from '../application/aiProxyService';
import type { ChatMessage } from '../ai/chat';
import { respond } from './respond';
import type { ApiRequest, HttpResult } from './types';

function asMessages(body: unknown): ChatMessage[] {
  const raw = (body as { messages?: unknown })?.messages;
  if (!Array.isArray(raw)) throw new AppError('validation', 'messages must be an array.');
  return raw
    .filter((m): m is { role: string; content: string } => !!m && typeof (m as { content?: unknown }).content === 'string')
    .map((m) => ({ role: m.role === 'assistant' ? 'assistant' : m.role === 'system' ? 'system' : 'user', content: m.content }));
}

/**
 * HTTP boundary for the audio + simple-chat proxies. Identity comes from the validated token; the
 * server forwards to Azure OpenAI with the user's vault credentials so the client never holds a key.
 */
export function createAiProxyController(svc: AiProxyService) {
  return {
    transcribe: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        if (req.body instanceof FormData) {
          const file = req.body.get('file');
          if (!(file instanceof Blob)) throw new AppError('validation', 'Audio file is required.');
          return svc.transcribe(userId, {
            audio: new Uint8Array(await file.arrayBuffer()),
            mime: String(req.body.get('mime') || file.type || ''),
            language: String(req.body.get('language') || '') || undefined,
            prompt: String(req.body.get('prompt') || '') || undefined,
          });
        }
        const b = (req.body ?? {}) as { audioBase64?: string; mime?: string; language?: string; prompt?: string };
        if (!b.audioBase64) throw new AppError('validation', 'audioBase64 is required.');
        return svc.transcribe(userId, {
          audio: new Uint8Array(Buffer.from(b.audioBase64.replace(/^data:[^;]*;base64,/, ''), 'base64')),
          mime: b.mime,
          language: b.language,
          prompt: b.prompt,
        });
      }),

    speak: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const b = (req.body ?? {}) as { input?: string; voice?: string; speed?: number };
        if (!b.input) throw new AppError('validation', 'input is required.');
        return svc.speak(userId, { input: b.input, voice: b.voice, speed: b.speed });
      }),

    chat: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        return svc.chat(userId, { messages: asMessages(req.body) });
      }),

    image: (req: ApiRequest): Promise<HttpResult> =>
      respond(200, async () => {
        const { userId } = identityFromClaims(req.claims);
        const b = (req.body ?? {}) as { prompt?: string; size?: string };
        if (!b.prompt) throw new AppError('validation', 'prompt is required.');
        return svc.image(userId, { prompt: b.prompt, size: b.size });
      }),
  };
}
