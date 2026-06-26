import { describe, it, expect } from 'vitest';
import { parseCredentialsInput, normalizeBaseUrl } from './credentials';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('normalizeBaseUrl', () => {
  it('expands a bare resource name to the v1 endpoint', () => {
    expect(normalizeBaseUrl('my-resource')).toBe(
      'https://my-resource.services.ai.azure.com/openai/v1',
    );
  });
  it('appends /openai/v1 to a services.ai host', () => {
    expect(normalizeBaseUrl('https://r.services.ai.azure.com')).toBe(
      'https://r.services.ai.azure.com/openai/v1',
    );
  });
  it('leaves an already-canonical URL untouched', () => {
    const u = 'https://r.services.ai.azure.com/openai/v1';
    expect(normalizeBaseUrl(u)).toBe(u);
  });
});

describe('parseCredentialsInput', () => {
  const ok = { baseUrl: 'my-res', models: { chat: 'gpt-5.4' }, key: '  sk-123  ' };

  it('accepts a valid write, trims the key, normalizes the base URL', () => {
    const out = parseCredentialsInput(ok);
    expect(out.baseUrl).toBe('https://my-res.services.ai.azure.com/openai/v1');
    expect(out.key).toBe('sk-123');
    expect(out.models.chat).toBe('gpt-5.4');
  });

  it('coerces an empty tavilyKey to undefined', () => {
    expect(parseCredentialsInput({ ...ok, tavilyKey: '   ' }).tavilyKey).toBeUndefined();
    expect(parseCredentialsInput({ ...ok, tavilyKey: 'tvly-9' }).tavilyKey).toBe('tvly-9');
  });

  it('requires a key and a chat deployment', () => {
    expect(code(() => parseCredentialsInput({ baseUrl: 'r', models: { chat: 'c' } }))).toBe('validation');
    expect(code(() => parseCredentialsInput({ baseUrl: 'r', models: {}, key: 'k' }))).toBe('validation');
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseCredentialsInput({ ...ok, sneaky: 'x' }))).toBe('validation');
    expect(code(() => parseCredentialsInput({ ...ok, models: { chat: 'c', evil: 'x' } }))).toBe('validation');
  });
});
