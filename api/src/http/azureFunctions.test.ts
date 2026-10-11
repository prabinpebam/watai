import { describe, it, expect, vi } from 'vitest';
import type { HttpRequest } from '@azure/functions';
import { MAX_HTTP_BODY_BYTES, readBody, runRoute } from './azureFunctions';
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
  const response = new Response(opts.form ?? opts.body ?? null);
  return {
    headers: { get: (k: string) => k.toLowerCase() === 'authorization' ? opts.auth ?? null : k.toLowerCase() === 'content-type' ? (opts.form ? response.headers.get('content-type') : opts.contentType ?? null) : null },
    params: opts.params ?? {},
    query: new URLSearchParams(opts.query ?? {}),
    body: response.body,
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
    const file = (captured?.body as FormData).get('file') as File;
    expect(file.name).toBe('audio.m4a');
    expect(file.type).toBe('audio/mp4');
    expect(await file.text()).toBe('audio');
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

  it('classifies authorization dependency failure without logging its content', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      const response = await runRoute(okVerifier, async () => ({ status: 200, body: undefined }),
        fakeRequest({ auth: 'Bearer good' }), async () => { throw { statusCode: 403, message: 'private provider details' }; });
      expect(response).toEqual({ status: 500, jsonBody: { error: { code: 'internal', message: 'Internal server error.' } } });
      expect(logger).toHaveBeenCalledExactlyOnceWith({ event: 'api.unexpected_error', category: 'dependency_auth', dependencyStatus: 403 });
    } finally { logger.mockRestore(); }
  });

  it('does not duplicate diagnostics for errors already handled by the controller', async () => {
    const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
    try {
      await runRoute(okVerifier, async () => ({ status: 500, body: { error: { code: 'internal', message: 'Internal server error.' } } }), fakeRequest({ auth: 'Bearer good' }));
      expect(logger).not.toHaveBeenCalled();
    } finally { logger.mockRestore(); }
  });
});

describe('bounded request body consumption', () => {
  function streamRequest(chunks: string[], length?: string) {
    const cancel = vi.fn();
    let index = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        if (index === chunks.length) controller.close();
        else controller.enqueue(new TextEncoder().encode(chunks[index++]));
      }, cancel,
    }, { highWaterMark: 0 });
    const getReader = vi.spyOn(stream, 'getReader');
    const request = { body: stream, headers: new Headers(length === undefined ? {} : { 'content-length': length }) } as unknown as HttpRequest;
    return { request, cancel, getReader };
  }

  it('rejects declared oversize before acquiring the stream reader', async () => {
    const { request, getReader } = streamRequest(['{}'], '17');
    await expect(readBody(request, 16)).rejects.toMatchObject({ code: 'validation' });
    expect(getReader).not.toHaveBeenCalled();
  });

  it('accepts exactly bounded JSON without a content type', async () => {
    const { request } = streamRequest(['{"value":', '123456}']);
    expect(await readBody(request, 16)).toEqual({ value: 123456 });
  });

  it.each([undefined, '1'])('counts actual chunks and cancels overflow despite content length %s', async length => {
    const { request, cancel } = streamRequest(['{"value":', '123456789}'], length);
    await expect(readBody(request, 16)).rejects.toMatchObject({ code: 'validation' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('counts UTF-8 bytes rather than decoded characters', async () => {
    const { request, cancel } = streamRequest(['"\u00e9\u00e9"']);
    await expect(readBody(request, 5)).rejects.toMatchObject({ code: 'validation' });
    expect(cancel).toHaveBeenCalledOnce();
  });

  it('rejects overflow in multipart before parsing the complete form', async () => {
    const form = new FormData();
    form.append('file', new Blob(['audio']), 'recording.webm');
    await expect(readBody(fakeRequest({ form }), 16)).rejects.toMatchObject({ code: 'validation' });
  });

  it('never allows a helper limit greater than the production cap', async () => {
    const { request, getReader } = streamRequest(['{}']);
    await expect(readBody(request, MAX_HTTP_BODY_BYTES + 1)).rejects.toThrow('Invalid HTTP body limit');
    expect(getReader).not.toHaveBeenCalled();
  });

  it('does not consume a body before authentication', async () => {
    const request = fakeRequest({ body: '{}' });
    const getReader = vi.spyOn(request.body!, 'getReader');
    expect((await runRoute(denyVerifier, async () => ({ status: 200, body: undefined }), request)).status).toBe(401);
    expect(getReader).not.toHaveBeenCalled();
  });
});
