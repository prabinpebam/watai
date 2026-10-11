import { toErrorEnvelope } from '../domain/errors';
import type { HttpResult } from './types';

export function reportUnexpectedError(error: unknown): void {
  const diagnostic: {
    event: 'api.unexpected_error';
    category: 'unexpected' | 'missing_composite_index' | 'dependency_auth' | 'throttled';
    dependencyStatus?: number;
  } = { event: 'api.unexpected_error', category: 'unexpected' };
  try {
    if (typeof error === 'object' && error !== null) {
      const value = error as {code?:unknown;statusCode?:unknown;message?:unknown};
      const status = [value.statusCode,value.code].find((candidate): candidate is number =>
        typeof candidate === 'number' && Number.isInteger(candidate) && candidate >= 100 && candidate <= 599);
      if (status !== undefined) diagnostic.dependencyStatus = status;
      if (status === 401 || status === 403) diagnostic.category = 'dependency_auth';
      else if (status === 429) diagnostic.category = 'throttled';
      else if (status === 400 && typeof value.message === 'string' && /composite[ -]+index/i.test(value.message.slice(0,2048))) {
        diagnostic.category = 'missing_composite_index';
      }
    }
  } catch {}
  try { console.error(diagnostic); } catch {}
}

/**
 * Run a handler, returning the given success status with its result, or mapping any
 * thrown value to a safe error envelope. This is the single place errors become HTTP.
 */
export async function respond(successStatus: number, fn: () => Promise<unknown>): Promise<HttpResult> {
  try {
    const body = await fn();
    return { status: successStatus, body };
  } catch (err) {
    const env = toErrorEnvelope(err);
    if (env.status >= 500) reportUnexpectedError(err);
    return { status: env.status, body: env.body };
  }
}
