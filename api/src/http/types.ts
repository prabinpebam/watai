import type { Claims } from '../auth/identity';

/** Framework-agnostic request shape the Functions host maps onto. */
export interface ApiRequest {
  claims: Claims;
  params?: Record<string, string>;
  query?: Record<string, string>;
  body?: unknown;
}

export interface HttpResult {
  status: number;
  body: unknown;
}
