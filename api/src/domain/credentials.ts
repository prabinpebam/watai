import { z } from 'zod';
import { parseOrThrow } from './validate';

const deployment = z.string().min(1).max(100);

const modelsSchema = z
  .object({
    chat: deployment,
    image: deployment.optional(),
    transcribe: deployment.optional(),
    tts: deployment.optional(),
  })
  .strict();

const credentialsInputSchema = z
  .object({
    baseUrl: z.string().min(1).max(300),
    models: modelsSchema,
    key: z.string().min(1).max(400),
    tavilyKey: z.string().max(400).optional(),
  })
  .strict();

export type ModelDeployments = z.infer<typeof modelsSchema>;
export type CredentialsInput = z.infer<typeof credentialsInputSchema>;

/**
 * Accept either a bare Azure AI Foundry resource name (e.g. "my-resource") or a full base
 * URL, and return the canonical `…/openai/v1` inference base. Mirrors the (now-retired)
 * client normalizer so existing configs map identically.
 */
export function normalizeBaseUrl(input: string): string {
  const raw = input.trim().replace(/\/+$/, '');
  if (!raw) return raw;
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

/** Validate + normalize a credentials write. The raw key/tavilyKey are returned for the
 *  service to encrypt immediately; they are never logged here. */
export function parseCredentialsInput(input: unknown): CredentialsInput {
  const parsed = parseOrThrow(credentialsInputSchema, input, 'Invalid credentials.');
  return {
    ...parsed,
    baseUrl: normalizeBaseUrl(parsed.baseUrl),
    key: parsed.key.trim(),
    tavilyKey: parsed.tavilyKey?.trim() || undefined,
  };
}
