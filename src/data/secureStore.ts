// Local AI-credential storage has been retired: keys + endpoint config now live exclusively in
// the server vault (see data/cloud credentials). These shims keep legacy call sites compiling
// while storing nothing, and `clearLegacyCredentials` wipes any credentials an earlier build
// saved on this device so nothing sensitive lingers locally.
import { kvSet } from './db';
import type { ApiConfig } from '../lib/types';

const CONFIG_KEY = 'apiConfig';
const SECRET_KEY = 'apiKey';
const TAVILY_KEY = 'tavilyKey';

export async function getApiConfig(): Promise<ApiConfig | null> {
  return null;
}

export async function saveApiConfig(_config: ApiConfig): Promise<void> {
  /* no local storage — credentials live in the server vault */
}

export async function getApiKey(): Promise<string | null> {
  return null;
}

export async function saveApiKey(_key: string): Promise<void> {
  /* no local storage — the key lives encrypted in the server vault */
}

export async function getTavilyKey(): Promise<string | null> {
  return null;
}

export async function saveTavilyKey(_key: string): Promise<void> {
  /* no local storage — the web-search key lives in the server vault */
}

/** Wipe any AI credentials a pre-cloud build stored locally. Called once on startup. */
export async function clearApiCredentials(): Promise<void> {
  await kvSet(CONFIG_KEY, undefined);
  await kvSet(SECRET_KEY, undefined);
  await kvSet(TAVILY_KEY, undefined);
}

export async function hasValidConfig(): Promise<boolean> {
  return false;
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
