import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { authenticate } from './authenticate';
import { AppError, toErrorEnvelope } from '../domain/errors';
import type { ApiRequest, HttpResult } from './types';
import type { TokenVerifier } from '../ports/tokenVerifier';

export type ControllerHandler = (req: ApiRequest) => Promise<HttpResult>;

async function readBody(request: HttpRequest): Promise<unknown> {
  const text = await request.text();
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
 * Single HTTP boundary for protected routes: authenticate the bearer token, project the
 * Functions request onto the framework-agnostic ApiRequest, run the controller, and map
 * the result (or any thrown error) to a safe response envelope.
 */
export async function runRoute(
  verifier: TokenVerifier,
  handler: ControllerHandler,
  request: HttpRequest,
): Promise<HttpResponseInit> {
  try {
    const claims = await authenticate(request.headers.get('authorization'), verifier);
    const result = await handler({
      claims,
      params: request.params as Record<string, string>,
      query: Object.fromEntries(request.query.entries()),
      body: await readBody(request),
    });
    return toResponse(result);
  } catch (err) {
    const env = toErrorEnvelope(err);
    return { status: env.status, jsonBody: env.body };
  }
}
