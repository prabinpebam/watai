export type AppErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'internal';

/** A domain error with a stable code that maps to an HTTP status + JSON envelope. */
export class AppError extends Error {
  readonly code: AppErrorCode;
  readonly details?: unknown;
  constructor(code: AppErrorCode, message: string, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.details = details;
  }
}

const STATUS: Record<AppErrorCode, number> = {
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  validation: 400,
  conflict: 409,
  rate_limited: 429,
  internal: 500,
};

export function httpStatusFor(code: AppErrorCode): number {
  return STATUS[code];
}

export interface ErrorEnvelope {
  status: number;
  body: { error: { code: AppErrorCode; message: string; details?: unknown } };
}

/**
 * Map any thrown value to a safe HTTP error envelope. Known AppErrors pass through
 * their code/message/details; everything else collapses to a generic 500 so internal
 * detail (stack traces, connection strings) never leaks to the client.
 */
export function toErrorEnvelope(err: unknown): ErrorEnvelope {
  if (err instanceof AppError) {
    return {
      status: httpStatusFor(err.code),
      body: {
        error: {
          code: err.code,
          message: err.message,
          ...(err.details !== undefined ? { details: err.details } : {}),
        },
      },
    };
  }
  return { status: 500, body: { error: { code: 'internal', message: 'Internal server error.' } } };
}
