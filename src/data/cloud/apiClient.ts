// Typed client for the Watai persistence API. Auth is injected via a token provider
// (so the sync engine is testable without MSAL), and the base URL comes from env.ts.
// Errors arrive as the server's `{ error: { code, message } }` envelope and are
// re-thrown as CloudError carrying the stable code + HTTP status.
import { apiBaseUrl } from './env';
import type {
  AppendMessageBody,
  CreateThreadBody,
  MessageRecord,
  SasRequestBody,
  SasResult,
  ThreadRecord,
  UpdateThreadBody,
} from './types';
import type { Settings } from '../../lib/types';

export type TokenProvider = () => Promise<string | null>;

export type CloudErrorCode =
  | 'unauthorized'
  | 'forbidden'
  | 'not_found'
  | 'validation'
  | 'conflict'
  | 'rate_limited'
  | 'internal'
  | 'network';

export class CloudError extends Error {
  constructor(
    readonly code: CloudErrorCode,
    message: string,
    readonly status: number,
  ) {
    super(message);
    this.name = 'CloudError';
  }
  /** Transient errors are worth retrying later; permanent ones (4xx) should drop. */
  get retryable(): boolean {
    return this.code === 'network' || this.code === 'rate_limited' || this.status >= 500;
  }
}

export interface ApiClientOptions {
  getToken: TokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class WataiApiClient implements CloudApi {
  private readonly baseUrl: string;
  private readonly getToken: TokenProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: ApiClientOptions) {
    this.baseUrl = (opts.baseUrl ?? apiBaseUrl()).replace(/\/+$/, '');
    this.getToken = opts.getToken;
    this.fetchImpl = opts.fetchImpl ?? globalThis.fetch.bind(globalThis);
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await this.getToken();
    if (!token) throw new CloudError('unauthorized', 'Not signed in.', 401);

    const headers: Record<string, string> = { Authorization: `Bearer ${token}` };
    let payload: string | undefined;
    if (body !== undefined) {
      headers['Content-Type'] = 'application/json';
      payload = JSON.stringify(body);
    }

    let res: Response;
    try {
      res = await this.fetchImpl(this.baseUrl + path, { method, headers, body: payload });
    } catch (err) {
      throw new CloudError('network', err instanceof Error ? err.message : 'Network error.', 0);
    }

    if (res.status === 204) return undefined as T;

    const text = await res.text();
    let json: unknown;
    try {
      json = text ? JSON.parse(text) : undefined;
    } catch {
      json = undefined;
    }

    if (!res.ok) {
      const envelope = (json as { error?: { code?: string; message?: string } } | undefined)?.error;
      const code = (envelope?.code as CloudErrorCode | undefined) ?? statusToCode(res.status);
      throw new CloudError(code, envelope?.message ?? `Request failed (${res.status}).`, res.status);
    }

    return json as T;
  }

  // --- threads ---
  async listThreads(opts?: {
    includeArchived?: boolean;
    includeDeleted?: boolean;
    since?: string;
  }): Promise<ThreadRecord[]> {
    const q = new URLSearchParams();
    if (opts?.includeArchived) q.set('includeArchived', 'true');
    if (opts?.includeDeleted) q.set('includeDeleted', 'true');
    if (opts?.since) q.set('since', opts.since);
    const qs = q.toString();
    const out = await this.request<{ threads: ThreadRecord[] }>('GET', `/threads${qs ? `?${qs}` : ''}`);
    return out.threads;
  }

  getThread(id: string): Promise<ThreadRecord> {
    return this.request('GET', `/threads/${encodeURIComponent(id)}`);
  }

  createThread(body: CreateThreadBody): Promise<ThreadRecord> {
    return this.request('POST', '/threads', body);
  }

  updateThread(id: string, body: UpdateThreadBody): Promise<ThreadRecord> {
    return this.request('PATCH', `/threads/${encodeURIComponent(id)}`, body);
  }

  deleteThread(id: string): Promise<void> {
    return this.request('DELETE', `/threads/${encodeURIComponent(id)}`);
  }

  // --- messages ---
  async listMessages(
    threadId: string,
    opts?: { since?: string; limit?: number },
  ): Promise<MessageRecord[]> {
    const q = new URLSearchParams();
    if (opts?.since) q.set('since', opts.since);
    if (opts?.limit) q.set('limit', String(opts.limit));
    const qs = q.toString();
    const out = await this.request<{ messages: MessageRecord[] }>(
      'GET',
      `/threads/${encodeURIComponent(threadId)}/messages${qs ? `?${qs}` : ''}`,
    );
    return out.messages;
  }

  appendMessage(threadId: string, body: AppendMessageBody): Promise<MessageRecord> {
    return this.request('POST', `/threads/${encodeURIComponent(threadId)}/messages`, body);
  }

  // --- settings ---
  getSettings(): Promise<Settings> {
    return this.request('GET', '/settings');
  }

  patchSettings(patch: Partial<Settings>): Promise<Settings> {
    return this.request('PATCH', '/settings', patch);
  }

  // --- assets ---
  requestSas(body: SasRequestBody): Promise<SasResult> {
    return this.request('POST', '/assets/sas', body);
  }
}

function statusToCode(status: number): CloudErrorCode {
  switch (status) {
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 400:
      return 'validation';
    case 409:
      return 'conflict';
    case 429:
      return 'rate_limited';
    default:
      return 'internal';
  }
}

/** The subset of the API the sync engine depends on (lets tests inject a fake). */
export interface CloudApi {
  listThreads(opts?: {
    includeArchived?: boolean;
    includeDeleted?: boolean;
    since?: string;
  }): Promise<ThreadRecord[]>;
  getThread(id: string): Promise<ThreadRecord>;
  createThread(body: CreateThreadBody): Promise<ThreadRecord>;
  updateThread(id: string, body: UpdateThreadBody): Promise<ThreadRecord>;
  deleteThread(id: string): Promise<void>;
  listMessages(threadId: string, opts?: { since?: string; limit?: number }): Promise<MessageRecord[]>;
  appendMessage(threadId: string, body: AppendMessageBody): Promise<MessageRecord>;
  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;
  requestSas(body: SasRequestBody): Promise<SasResult>;
}
