import { describe, it, expect } from 'vitest';
import { AppError, httpStatusFor, toErrorEnvelope } from './errors';

describe('AppError + httpStatusFor', () => {
  it.each([
    ['unauthorized', 401],
    ['forbidden', 403],
    ['not_found', 404],
    ['validation', 400],
    ['conflict', 409],
    ['rate_limited', 429],
    ['internal', 500],
  ] as const)('maps %s to HTTP %i', (code, status) => {
    expect(httpStatusFor(code)).toBe(status);
  });
});

describe('toErrorEnvelope', () => {
  it('wraps an AppError into { status, body.error }', () => {
    const env = toErrorEnvelope(new AppError('forbidden', 'not yours', { threadId: 't1' }));
    expect(env.status).toBe(403);
    expect(env.body.error.code).toBe('forbidden');
    expect(env.body.error.message).toBe('not yours');
    expect(env.body.error.details).toEqual({ threadId: 't1' });
  });

  it('maps unknown errors to a generic 500 without leaking internals', () => {
    const env = toErrorEnvelope(new Error('connection string: secret://leak'));
    expect(env.status).toBe(500);
    expect(env.body.error.code).toBe('internal');
    expect(env.body.error.message).not.toContain('secret');
    expect(env.body.error.details).toBeUndefined();
  });
});
