import { aiFetch, loadConfig } from './http';
import { normalizeHttpError } from './errors';

export interface TtsParams {
  input: string;
  voice?: string;
  signal?: AbortSignal;
}

// POST <baseUrl>/audio/speech { model, input, voice } -> audio (mp3)
export async function synthesize(p: TtsParams): Promise<Blob> {
  const { config } = await loadConfig();
  const body = {
    model: config.models.tts ?? 'gpt-4o-mini-tts',
    input: p.input,
    voice: p.voice ?? 'alloy',
    response_format: 'mp3',
  };
  const res = await aiFetch({ path: '/audio/speech', body, signal: p.signal });
  if (!res.ok) throw await normalizeHttpError(res, 'tts');
  return res.blob();
}
