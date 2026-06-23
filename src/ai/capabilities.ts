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

/** Lightweight probe: a tiny chat call confirms auth + chat model wiring. */
export async function probe(config: ApiConfig): Promise<{ ok: boolean; status?: number; detail?: string }> {
  try {
    const res = await aiFetch({
      path: '/chat/completions',
      body: {
        model: config.models.chat,
        messages: [{ role: 'user', content: 'ping' }],
        max_completion_tokens: 1,
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
