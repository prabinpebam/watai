import { aiFetch, transcriptionUrl } from './http';
import type { ApiConfig, CapabilityMatrix } from '../lib/types';

export const FULL_CAPABILITY: CapabilityMatrix = {
  chat: true,
  chatStreaming: true,
  vision: true,
  transcribe: true,
  transcribeStreaming: false,
  image: true,
  imageEdit: true,
  tts: true,
};

/**
 * Reasoning ("thinking") models spend completion-token budget on hidden reasoning
 * before producing any visible output, so a tiny cap makes the chat probe fail with
 * "max_tokens or model output limit was reached". The cap is only an upper bound —
 * a one-word reply costs little regardless — so we give generous headroom.
 */
const PROBE_MAX_COMPLETION_TOKENS = 2000;

export type ModelKey = 'chat' | 'transcribe' | 'image' | 'tts';

export const MODEL_LABELS: Record<ModelKey, string> = {
  chat: 'Chat',
  transcribe: 'Transcription',
  image: 'Image generation',
  tts: 'Text-to-speech',
};

export interface ProbeResult {
  ok: boolean;
  status?: number;
  detail?: string;
}

async function detailFrom(res: Response): Promise<string> {
  try {
    return (await res.text()).slice(0, 400);
  } catch {
    return `HTTP ${res.status}`;
  }
}

function failed(e: unknown): ProbeResult {
  return { ok: false, detail: e instanceof Error ? e.message : 'Network error.' };
}

/** Chat: a one-word completion. Generous token cap so reasoning models don't truncate. */
export async function probeChat(config: ApiConfig): Promise<ProbeResult> {
  try {
    const res = await aiFetch({
      path: '/chat/completions',
      body: {
        model: config.models.chat,
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: PROBE_MAX_COMPLETION_TOKENS,
      },
      timeoutMs: 30000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

/** Transcription: classic deployment path + a tiny tone clip; an empty transcript still returns 200. */
export async function probeTranscribe(config: ApiConfig): Promise<ProbeResult> {
  try {
    const form = new FormData();
    form.append('model', config.models.transcribe);
    form.append('file', probeWav(), 'probe.wav');
    form.append('response_format', 'json');
    const res = await aiFetch({
      path: '/audio/transcriptions',
      url: transcriptionUrl(config.baseUrl, config.models.transcribe),
      form,
      timeoutMs: 30000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

/** Image: generate the smallest allowed image once to confirm the deployment. */
export async function probeImage(config: ApiConfig): Promise<ProbeResult> {
  try {
    const res = await aiFetch({
      path: '/images/generations',
      body: {
        model: config.models.image,
        prompt: 'a plain solid gray square',
        size: '1024x1024',
        n: 1,
        output_format: 'png',
      },
      timeoutMs: 180000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

/** Text-to-speech: synthesize a one-word clip. */
export async function probeTts(config: ApiConfig): Promise<ProbeResult> {
  try {
    const res = await aiFetch({
      path: '/audio/speech',
      body: {
        model: config.models.tts ?? 'gpt-4o-mini-tts',
        input: 'hi',
        voice: 'alloy',
        response_format: 'mp3',
      },
      timeoutMs: 30000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

export function probeModel(key: ModelKey, config: ApiConfig): Promise<ProbeResult> {
  switch (key) {
    case 'chat':
      return probeChat(config);
    case 'transcribe':
      return probeTranscribe(config);
    case 'image':
      return probeImage(config);
    case 'tts':
      return probeTts(config);
  }
}

/**
 * A small mono 16-bit PCM WAV containing a short tone for the transcription probe.
 * It carries real (non-silent) signal so transcription models that reject empty or
 * zero-energy audio still accept it — the transcript text is irrelevant, we only need a 200.
 */
function probeWav(durationSec = 1, sampleRate = 16000): Blob {
  const numSamples = Math.floor(durationSec * sampleRate);
  const dataSize = numSamples * 2;
  const buffer = new ArrayBuffer(44 + dataSize);
  const view = new DataView(buffer);
  const writeStr = (off: number, s: string) => {
    for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i));
  };
  writeStr(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeStr(8, 'WAVE');
  writeStr(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true); // PCM
  view.setUint16(22, 1, true); // mono
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // byteRate
  view.setUint16(32, 2, true); // blockAlign
  view.setUint16(34, 16, true); // bitsPerSample
  writeStr(36, 'data');
  view.setUint32(40, dataSize, true);
  const amplitude = 0.25 * 0x7fff;
  for (let i = 0; i < numSamples; i++) {
    const sample = Math.round(amplitude * Math.sin((2 * Math.PI * 440 * i) / sampleRate));
    view.setInt16(44 + i * 2, sample, true);
  }
  return new Blob([buffer], { type: 'audio/wav' });
}
