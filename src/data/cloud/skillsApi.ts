// Typed client for the Skills API (`/api/skills`). Kept separate from the main
// CloudApi so the skills feature stays decoupled from the sync engine + its test
// fakes. Auth + error handling mirror apiClient: a bearer token per call and the
// server's `{ error: { code, message, details } }` envelope re-thrown as CloudError.
import { apiBaseUrl } from './env';
import { CloudError, type CloudErrorCode, type TokenProvider } from './apiClient';
import type {
  SkillDetail,
  SkillSummary,
  SkillValidationError,
} from '../../lib/types';

/** A zip upload payload (base64 so it rides the JSON request like other uploads). */
export interface SkillUpload {
  filename: string;
  dataBase64: string;
}

function statusToCode(status: number): CloudErrorCode {
  switch (status) {
    case 400:
      return 'validation';
    case 401:
      return 'unauthorized';
    case 403:
      return 'forbidden';
    case 404:
      return 'not_found';
    case 409:
      return 'conflict';
    case 422:
      return 'validation';
    case 429:
      return 'rate_limited';
    default:
      return status >= 500 ? 'internal' : 'network';
  }
}

export interface SkillsApiOptions {
  getToken: TokenProvider;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export class SkillsApiClient {
  private readonly baseUrl: string;
  private readonly getToken: TokenProvider;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: SkillsApiOptions) {
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
      const envelope = (
        json as { error?: { code?: string; message?: string; details?: unknown } } | undefined
      )?.error;
      const code = (envelope?.code as CloudErrorCode | undefined) ?? statusToCode(res.status);
      throw new CloudError(
        code,
        envelope?.message ?? `Request failed (${res.status}).`,
        res.status,
        envelope?.details,
      );
    }

    return json as T;
  }

  /** List the user's effective catalog: default skills + their uploaded skills. */
  async list(): Promise<SkillSummary[]> {
    const out = await this.request<{ skills: SkillSummary[] }>('GET', '/skills');
    return out.skills ?? [];
  }

  /** Full detail for the preview dialog (frontmatter, file tree, SKILL.md body). */
  get(id: string): Promise<SkillDetail> {
    return this.request('GET', `/skills/${encodeURIComponent(id)}`);
  }

  /** Upload a new skill zip. Resolves with the created row, or rejects with a
   *  CloudError('validation') whose `details` is a `SkillValidationError[]`. */
  upload(file: SkillUpload): Promise<SkillSummary> {
    return this.request('POST', '/skills', file);
  }

  /** Replace a user skill's zip (new version). Same validation contract as upload. */
  replace(id: string, file: SkillUpload): Promise<SkillSummary> {
    return this.request('PUT', `/skills/${encodeURIComponent(id)}`, file);
  }

  /** Enable/disable a skill (default toggle or user skill). */
  setEnabled(id: string, enabled: boolean): Promise<SkillSummary> {
    return this.request('PATCH', `/skills/${encodeURIComponent(id)}`, { enabled });
  }

  /** Delete a user skill (defaults reject with 409 — disable instead). */
  remove(id: string): Promise<void> {
    return this.request('DELETE', `/skills/${encodeURIComponent(id)}`);
  }

  /** A short-lived download URL for a user skill's zip. */
  download(id: string): Promise<{ url: string }> {
    return this.request('GET', `/skills/${encodeURIComponent(id)}/download`);
  }
}

/** Pull the `SkillValidationError[]` out of a rejected upload/replace (else null). */
export function skillValidationErrors(err: unknown): SkillValidationError[] | null {
  if (err instanceof CloudError && err.code === 'validation' && Array.isArray(err.details)) {
    return err.details as SkillValidationError[];
  }
  return null;
}
