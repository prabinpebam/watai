import { describe, it, expect } from 'vitest';
import type { HttpRequest } from '@azure/functions';
import { runRoute } from './azureFunctions';
import { AppError } from '../domain/errors';
import type { TokenVerifier } from '../ports/tokenVerifier';
import type { ApiRequest, HttpResult } from './types';

function fakeRequest(opts: {
  auth?: string;
  body?: string;
  contentType?: string;
  form?: FormData;
  params?: Record<string, string>;
  query?: Record<string, string>;
}): HttpRequest {
  return {
    headers: { get: (k: string) => k.toLowerCase() === 'authorization' ? opts.auth ?? null : k.toLowerCase() === 'content-type' ? opts.contentType ?? null : null },
    params: opts.params ?? {},
    query: new URLSearchParams(opts.query ?? {}),
    text: async () => opts.body ?? '',
    formData: async () => opts.form ?? new FormData(),
  } as unknown as HttpRequest;
}

const okVerifier: TokenVerifier = { async verify() { return { sub: 'userA' }; } };
const denyVerifier: TokenVerifier = {
  async verify() {
    throw new AppError('unauthorized', 'denied');
  },
};

describe('runRoute', () => {
  it('returns 401 when authentication fails (fail closed)', async () => {
    const res = await runRoute(denyVerifier, async () => ({ status: 200, body: { ok: true } }), fakeRequest({}));
    expect(res.status).toBe(401);
  });

  it('projects claims/body/params/query onto ApiRequest and maps the result', async () => {
    let captured: ApiRequest | undefined;
    const handler = async (req: ApiRequest): Promise<HttpResult> => {
      captured = req;
      return { status: 201, body: { echoed: true } };
    };
    const res = await runRoute(
      okVerifier,
      handler,
      fakeRequest({ auth: 'Bearer good', body: '{"a":1}', params: { id: 'x' }, query: { since: 't0' } }),
    );
    expect(res.status).toBe(201);
    expect((res as { jsonBody?: unknown }).jsonBody).toEqual({ echoed: true });
    expect(captured?.claims).toEqual({ sub: 'userA' });
    expect(captured?.body).toEqual({ a: 1 });
    expect(captured?.params).toEqual({ id: 'x' });
    expect(captured?.query).toEqual({ since: 't0' });
  });

  it('returns 400 when the body is not valid JSON', async () => {
    const res = await runRoute(
      okVerifier,
      async () => ({ status: 200, body: {} }),
      fakeRequest({ auth: 'Bearer good', body: 'not json' }),
    );
    expect(res.status).toBe(400);
    expect((res as { jsonBody: { error: { code: string } } }).jsonBody.error.code).toBe('validation');
  });

  it('projects multipart form data without attempting JSON parsing', async () => {
    const form = new FormData();
    form.append('file', new Blob(['audio'], { type: 'audio/mp4' }), 'audio.m4a');
    let captured: ApiRequest | undefined;

    const res = await runRoute(
      okVerifier,
      async (req) => {
        captured = req;
        return { status: 200, body: {} };
      },
      fakeRequest({ auth: 'Bearer good', contentType: 'multipart/form-data; boundary=test', form }),
    );

    expect(res.status).toBe(200);
    expect(captured?.body).toBe(form);
  });

  it('omits jsonBody for empty (204) results', async () => {
    const res = await runRoute(
      okVerifier,
      async () => ({ status: 204, body: undefined }),
      fakeRequest({ auth: 'Bearer good' }),
    );
    expect(res.status).toBe(204);
    expect((res as { jsonBody?: unknown }).jsonBody).toBeUndefined();
  });
});
