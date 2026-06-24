import { toErrorEnvelope } from '../domain/errors';
import type { HttpResult } from './types';

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
    return { status: env.status, body: env.body };
  }
}
