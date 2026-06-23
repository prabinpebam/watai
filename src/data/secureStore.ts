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

/** Normalize a user-entered base URL to the `/openai/v1` root, without a trailing slash. */
export function normalizeBaseUrl(input: string): string {
  let url = input.trim().replace(/\/+$/, '');
  if (!/\/openai\/v1$/.test(url) && /\.services\.ai\.azure\.com$/i.test(url)) {
    url += '/openai/v1';
  }
  return url;
}
