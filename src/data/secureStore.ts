// Secure store: BYO API key + ApiConfig, kept separate from the Repository so the
// raw key never lands in thread/message data, exports, logs, or telemetry.
import { kvGet, kvSet } from './db';
import type { ApiConfig } from '../lib/types';

const CONFIG_KEY = 'apiConfig';
const SECRET_KEY = 'apiKey';

export async function getApiConfig(): Promise<ApiConfig | null> {
  return (await kvGet<ApiConfig>(CONFIG_KEY)) ?? null;
}

export async function saveApiConfig(config: ApiConfig): Promise<void> {
  await kvSet(CONFIG_KEY, config);
}

/** The raw key is stored under its own kv entry and never returned in exports. */
export async function getApiKey(): Promise<string | null> {
  return (await kvGet<string>(SECRET_KEY)) ?? null;
}

export async function saveApiKey(key: string): Promise<void> {
  await kvSet(SECRET_KEY, key);
}

export async function clearApiCredentials(): Promise<void> {
  await kvSet(CONFIG_KEY, undefined);
  await kvSet(SECRET_KEY, undefined);
}

export async function hasValidConfig(): Promise<boolean> {
  const config = await getApiConfig();
  const key = await getApiKey();
  return Boolean(config?.baseUrl && config?.models?.chat && key);
}

/**
 * Accept either a bare Azure AI Foundry resource name (e.g. "ai-project-deployments-resource")
 * or a full base URL, and return the canonical v1 inference base. Per-model hosts are derived
 * from this at call time (chat/image/tts on services.ai.azure.com/openai/v1, transcription on
 * the cognitiveservices host) — see ai/http.ts.
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return raw;
  // Bare resource name (letters, digits, hyphens only) -> expand to the v1 endpoint.
  if (/^[a-z0-9][a-z0-9-]*$/i.test(raw)) {
    return `https://${raw}.services.ai.azure.com/openai/v1`;
  }
  let url = /^https?:\/\//i.test(raw) ? raw : `https://${raw}`;
  try {
    if (/\.services\.ai\.azure\.com$/i.test(new URL(url).host) && !/\/openai\/v1$/.test(url)) {
      url += '/openai/v1';
    }
  } catch {
    /* not a parseable URL — leave as entered */
  }
  return url;
}
