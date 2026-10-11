import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { authenticate } from './authenticate';
import { AppError, toErrorEnvelope } from '../domain/errors';
import type { ApiRequest, HttpResult } from './types';
import type { Claims } from '../auth/identity';
import type { TokenVerifier } from '../ports/tokenVerifier';
import { reportUnexpectedError } from './respond';

export type ControllerHandler = (req: ApiRequest) => Promise<HttpResult>;

/** Authorization check run after authentication; throws an AppError (e.g. forbidden) to deny. */
export type Authorizer = (claims: Claims) => Promise<void>;

export const MAX_HTTP_BODY_BYTES = 72 * 1024 * 1024;

export async function readBody(request: HttpRequest, maximumBytes = MAX_HTTP_BODY_BYTES): Promise<unknown> {
  if (!Number.isSafeInteger(maximumBytes) || maximumBytes <= 0 || maximumBytes > MAX_HTTP_BODY_BYTES) {
    throw new Error('Invalid HTTP body limit.');
  }
  const tooLarge = () => new AppError('validation', `Request body exceeds the ${maximumBytes}-byte limit.`);
  const declaredLength = request.headers.get('content-length');
  if (declaredLength !== null) {
    if (!/^\d+$/.test(declaredLength) || !Number.isSafeInteger(Number(declaredLength))) {
      throw new AppError('validation', 'Invalid request content length.');
    }
    if (Number(declaredLength) > maximumBytes) throw tooLarge();
  }
  if (!request.body) return undefined;
  const reader = request.body.getReader();
  let totalBytes = 0;
  const body = new ReadableStream<Uint8Array>({
    async pull(controller) {
      try {
        const { done, value } = await reader.read();
        if (done) {
          reader.releaseLock();
          controller.close();
          return;
        }
        if (!(value instanceof Uint8Array)) throw new AppError('validation', 'Invalid request body stream.');
        totalBytes += value.byteLength;
        if (totalBytes > maximumBytes) throw tooLarge();
        controller.enqueue(value);
      } catch (error) {
        void reader.cancel(error).catch(() => undefined);
        reader.releaseLock();
        controller.error(error);
      }
    },
    async cancel(reason) {
      try { await reader.cancel(reason); } finally { reader.releaseLock(); }
    },
  });
  const contentType = request.headers.get('content-type');
  const response = new Response(body, { headers: contentType ? { 'content-type': contentType } : {} });
  if (contentType?.toLowerCase().includes('multipart/form-data')) {
    try {
      return await response.formData();
    } catch (error) {
      if (error instanceof AppError) throw error;
      throw new AppError('validation', 'Request body must be valid multipart form data.');
    }
  }
  const text = await response.text();
  if (!text) return undefined;
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError('validation', 'Request body must be valid JSON.');
  }
}

function toResponse(result: HttpResult): HttpResponseInit {
  return result.body === undefined
    ? { status: result.status }
    : { status: result.status, jsonBody: result.body };
}

/**
 * Single HTTP boundary for protected routes: authenticate the bearer token, run an
 * optional authorization check (invite/admin gate), project the Functions request onto
 * the framework-agnostic ApiRequest, run the controller, and map the result (or any
 * thrown error) to a safe response envelope.
 */
export async function runRoute(
  verifier: TokenVerifier,
  handler: ControllerHandler,
  request: HttpRequest,
  authorize?: Authorizer,
): Promise<HttpResponseInit> {
  try {
    const claims = await authenticate(request.headers.get('authorization'), verifier);
    if (authorize) await authorize(claims);
    const result = await handler({
      claims,
      params: request.params as Record<string, string>,
      query: Object.fromEntries(request.query.entries()),
      body: await readBody(request),
    });
    return toResponse(result);
  } catch (err) {
    const env = toErrorEnvelope(err);
    if (env.status >= 500) reportUnexpectedError(err);
    return { status: env.status, jsonBody: env.body };
  }
}
