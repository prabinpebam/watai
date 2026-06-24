import { describe, it, expect, vi, afterEach } from 'vitest';
import { aiError, normalizeHttpError, errorFromException, isAiError } from './errors';

function res(status: number, body = '', headers: Record<string, string> = {}): Response {
  return new Response(body, { status, headers });
}

describe('normalizeHttpError', () => {
  it.each([
    [401, 'unauthorized'],
    [403, 'forbidden'],
    [404, 'deployment_not_found'],
    [408, 'timeout'],
    [429, 'rate_limited'],
    [400, 'bad_request'],
    [500, 'server_error'],
    [503, 'server_error'],
  ])('maps HTTP %i to %s', async (status, code) => {
    const e = await normalizeHttpError(res(status));
    expect(e.code).toBe(code);
  });

  it('detects content-filter inside a 400 body', async () => {
    const body = JSON.stringify({ error: { message: 'The content filter was triggered' } });
    const e = await normalizeHttpError(res(400, body));
    expect(e.code).toBe('content_filtered');
  });

  it('extracts the provider error message as detail', async () => {
    const body = JSON.stringify({ error: { message: 'deployment xyz does not exist' } });
    const e = await normalizeHttpError(res(404, body));
    expect(e.detail).toBe('deployment xyz does not exist');
  });

  it('parses Retry-After seconds into milliseconds', async () => {
    const e = await normalizeHttpError(res(429, '', { 'retry-after': '2' }));
    expect(e.retryAfterMs).toBe(2000);
  });

  it('carries the capability through', async () => {
    const e = await normalizeHttpError(res(500), 'image');
    expect(e.capability).toBe('image');
  });
});

describe('errorFromException', () => {
  afterEach(() => vi.restoreAllMocks());

  it('maps AbortError to aborted', () => {
    const e = errorFromException(new DOMException('stop', 'AbortError'));
    expect(e.code).toBe('aborted');
  });

  it('maps offline navigator to offline', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
    const e = errorFromException(new Error('whatever'));
    expect(e.code).toBe('offline');
  });

  it('falls back to server_error with the message', () => {
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
    const e = errorFromException(new Error('boom'));
    expect(e.code).toBe('server_error');
    expect(e.message).toBe('boom');
  });
});

describe('isAiError', () => {
  it('recognizes AiError shapes', () => {
    expect(isAiError(aiError('timeout', 'x'))).toBe(true);
  });
  it('rejects non-errors', () => {
    expect(isAiError(null)).toBe(false);
    expect(isAiError('nope')).toBe(false);
    expect(isAiError({ code: 'x' })).toBe(false);
  });
});
