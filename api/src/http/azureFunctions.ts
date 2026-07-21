import type { HttpRequest, HttpResponseInit } from '@azure/functions';
import { authenticate } from './authenticate';
import { AppError, toErrorEnvelope } from '../domain/errors';
import type { ApiRequest, HttpResult } from './types';
import type { Claims } from '../auth/identity';
import type { TokenVerifier } from '../ports/tokenVerifier';

export type ControllerHandler = (req: ApiRequest) => Promise<HttpResult>;

/** Authorization check run after authentication; throws an AppError (e.g. forbidden) to deny. */
export type Authorizer = (claims: Claims) => Promise<void>;

async function readBody(request: HttpRequest): Promise<unknown> {
  if (request.headers.get('content-type')?.toLowerCase().includes('multipart/form-data')) {
    try {
      return await request.formData();
    } catch {
      throw new AppError('validation', 'Request body must be valid multipart form data.');
    }
  }
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
    return { status: env.status, jsonBody: env.body };
  }
}
