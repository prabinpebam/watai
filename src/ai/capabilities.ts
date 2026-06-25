import { aiFetch, isFoundryHost, transcriptionUrl } from './http';
import type { ApiConfig, CapabilityMatrix, EndpointKind } from '../lib/types';

export type { ApiConfig } from '../lib/types';
export type ProbeResultLike = { ok: boolean };

export const FULL_CAPABILITY: CapabilityMatrix = {
  chat: true,
  chatStreaming: true,
  vision: true,
  transcribe: true,
  transcribeStreaming: false,
  image: true,
  imageEdit: true,
  tts: true,
  // Agentic defaults: function calling + code interpreter come with /responses; the
  // project-only tools stay off until detected (P2).
  responses: true,
  functions: true,
  codeInterpreter: true,
  webSearch: false,
  fileSearch: false,
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

/** Detect whether the endpoint serves the Responses API (gates agentic chat + tools). */
export async function probeResponses(config: ApiConfig): Promise<ProbeResult> {
  try {
    const res = await aiFetch({
      path: '/responses',
      body: { model: config.models.chat, input: 'ping', max_output_tokens: 1000 },
      timeoutMs: 30000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

/** Probe one service-side tool by asking /responses to accept it (cheap; body cancelled). */
async function probeTool(
  config: ApiConfig,
  tools: unknown[],
  extra: Record<string, unknown> = {},
): Promise<ProbeResult> {
  try {
    const res = await aiFetch({
      path: '/responses',
      body: { model: config.models.chat, input: 'ping', max_output_tokens: 16, tools, ...extra },
      timeoutMs: 30000,
    });
    if (!res.ok) return { ok: false, status: res.status, detail: await detailFrom(res) };
    await res.body?.cancel();
    return { ok: true, status: res.status };
  } catch (e) {
    return failed(e);
  }
}

export const probeCodeInterpreter = (c: ApiConfig): Promise<ProbeResult> =>
  probeTool(c, [{ type: 'code_interpreter' }]);
export const probeWebSearch = (c: ApiConfig): Promise<ProbeResult> =>
  probeTool(c, [{ type: 'web_search' }], { tool_choice: 'auto' });
export const probeFileSearch = (c: ApiConfig): Promise<ProbeResult> =>
  probeTool(c, [{ type: 'file_search', vector_store_ids: [] }]);

/** Derive the endpoint tier from the URL shape (a project endpoint serves the full suite). */
export function endpointKind(config: ApiConfig): EndpointKind {
  return /\/api\/projects\//i.test(config.projectEndpoint ?? config.baseUrl)
    ? 'foundry-project'
    : 'aoai';
}

/** Injectable probes so the matrix logic is unit-testable without the network. */
export interface CapabilityProbes {
  responses: (c: ApiConfig) => Promise<ProbeResultLike>;
  codeInterpreter: (c: ApiConfig) => Promise<ProbeResultLike>;
  webSearch: (c: ApiConfig) => Promise<ProbeResultLike>;
  fileSearch: (c: ApiConfig) => Promise<ProbeResultLike>;
}

let matrixCache: CapabilityMatrix | null = null;

/** Clear the cached capability matrix (call when the endpoint config changes). */
export function resetAgenticCache(): void {
  matrixCache = null;
}

/**
 * Detect and cache the full agentic capability matrix for the configured endpoint. Function
 * calling + code interpreter come with /responses; web/file search are probed only on a
 * Foundry project endpoint (no wasted 4xx spend on a plain key).
 */
export async function detectCapabilities(
  config: ApiConfig,
  probes: Partial<CapabilityProbes> = {},
): Promise<CapabilityMatrix> {
  if (matrixCache) return matrixCache;
  const p: CapabilityProbes = {
    responses: probeResponses,
    codeInterpreter: probeCodeInterpreter,
    webSearch: probeWebSearch,
    fileSearch: probeFileSearch,
    ...probes,
  };
  const responses = (await p.responses(config)).ok;
  const off: ProbeResultLike = { ok: false };
  // Web/file search are served by Azure AI Foundry hosts (with a project + connections). A
  // Foundry host is NOT always identified by an `/api/projects/` URL segment — an account-level
  // `…services.ai.azure.com` endpoint serves them too. Web search needs a Bing connection, so we
  // probe it. File search uses on-demand vector stores (nothing to probe before a store exists),
  // so it is available on any Foundry host that serves the Responses API.
  const foundryCapable = isFoundryHost(config.baseUrl) || endpointKind(config) === 'foundry-project';
  const [code, web] = responses
    ? await Promise.all([
        p.codeInterpreter(config),
        foundryCapable ? p.webSearch(config) : Promise.resolve(off),
      ])
    : [off, off];
  matrixCache = {
    ...FULL_CAPABILITY,
    responses,
    functions: responses,
    codeInterpreter: code.ok,
    webSearch: web.ok,
    fileSearch: responses && foundryCapable,
  };
  return matrixCache;
}

/**
 * Cached per session: does the configured endpoint support the Responses API (and thus
 * agentic chat + tools)? Probed once on first use; classic chat is the fallback.
 */
export async function agenticAvailable(config: ApiConfig): Promise<boolean> {
  return (await detectCapabilities(config)).responses;
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
