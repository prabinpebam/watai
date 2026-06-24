import { aiFetch } from './http';
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
 * before producing any visible output, so a tiny cap makes the probe fail with
 * "max_tokens or model output limit was reached". The cap is only an upper bound —
 * a one-word "ping" reply costs little regardless — so we give generous headroom.
 */
const PROBE_MAX_COMPLETION_TOKENS = 2000;

/** Lightweight probe: a tiny chat call confirms auth + chat model wiring. */
export async function probe(config: ApiConfig): Promise<{ ok: boolean; status?: number; detail?: string }> {
  try {
    const res = await aiFetch({
      path: '/chat/completions',
      body: {
        model: config.models.chat,
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: PROBE_MAX_COMPLETION_TOKENS,
      },
      timeoutMs: 20000,
    });
    if (res.ok) {
      await res.body?.cancel();
      return { ok: true, status: res.status };
    }
    const text = await res.text();
    return { ok: false, status: res.status, detail: text.slice(0, 300) };
  } catch (e) {
    return { ok: false, detail: e instanceof Error ? e.message : 'network error' };
  }
}
