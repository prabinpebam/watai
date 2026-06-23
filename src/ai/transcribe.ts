import { aiFetch, loadConfig } from './http';
import { normalizeHttpError } from './errors';

export interface TranscribeParams {
  file: Blob;
  language?: string;
  prompt?: string;
  signal?: AbortSignal;
}

// POST <baseUrl>/audio/transcriptions (multipart: model, file, response_format=json)
export async function transcribe(p: TranscribeParams): Promise<{ text: string }> {
  const { config } = await loadConfig();
  const form = new FormData();
  form.append('model', config.models.transcribe);
  const filename = p.file.type.includes('wav') ? 'audio.wav' : 'audio.webm';
  form.append('file', p.file, filename);
  form.append('response_format', 'json');
  if (p.language) form.append('language', p.language);
  if (p.prompt) form.append('prompt', p.prompt);

  const res = await aiFetch({ path: '/audio/transcriptions', form, signal: p.signal });
  if (!res.ok) throw await normalizeHttpError(res, 'transcribe');
  const json = await res.json();
  return { text: json.text ?? '' };
}
