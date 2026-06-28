// Typed client for the Watai persistence API. Auth is injected via a token provider
// (so the sync engine is testable without MSAL), and the base URL comes from env.ts.
// Errors arrive as the server's `{ error: { code, message } }` envelope and are
// re-thrown as CloudError carrying the stable code + HTTP status.
import { apiBaseUrl } from './env';
import type {
  AppendMessageBody,
  CreateImagesBody,
  CreateThreadBody,
  CredentialStatus,
  CredentialsInput,
  InviteRecord,
  ListImagesQuery,
  ListImagesResult,
  MeInfo,
  MessageRecord,
  RunRecord,
  SasRequestBody,
  SasResult,
  StudioImage,
  SubmitRunBody,
  SubmitRunResult,
  ThreadRecord,
  ThreadFileRecord,
  UpdateThreadBody,
} from './types';
import type { Settings, ThreadLock } from '../../lib/types';

export type TokenProvider = () => Promise<string | null>;

/** SignalR connection info: the service client url and a short-lived access token scoped to the
 *  caller. An empty url means realtime push isn't configured (client polls instead). */
export interface NegotiateInfo {
  url: string;
  accessToken: string;
}

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
    /** Structured error payload from the server envelope (e.g. the current lock holder on 409). */
    readonly details?: unknown,
  ) {
    super(message);
    this.name = 'CloudError';
  }
  /** Transient errors are worth retrying later; permanent ones (4xx) should drop.
   *  `unauthorized` (token refresh / re-auth) and `forbidden` (invite-only access that
   *  may be granted later) are transient for a signed-in user, so keep the op rather than
   *  dropping it and losing the user's data. */
  get retryable(): boolean {
    return (
      this.code === 'network' ||
      this.code === 'rate_limited' ||
      this.code === 'unauthorized' ||
      this.code === 'forbidden' ||
      this.status >= 500
    );
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

  // --- run lock ---
  acquireThreadLock(
    threadId: string,
    body: { deviceId: string; deviceLabel: string },
  ): Promise<{ thread: ThreadRecord; lock: ThreadLock }> {
    return this.request('POST', `/threads/${encodeURIComponent(threadId)}/lock`, body);
  }

  async getThreadLock(threadId: string): Promise<ThreadLock | null> {
    const out = await this.request<{ lock?: ThreadLock | null }>('GET', `/threads/${encodeURIComponent(threadId)}/lock`);
    return out.lock ?? null;
  }

  releaseThreadLock(threadId: string, deviceId: string): Promise<void> {
    return this.request(
      'DELETE',
      `/threads/${encodeURIComponent(threadId)}/lock?deviceId=${encodeURIComponent(deviceId)}`,
    );
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

  // --- credential vault (server-side AI keys) ---
  getCredentialStatus(): Promise<CredentialStatus> {
    return this.request('GET', '/credentials');
  }

  /** Write the AI credentials. The key is encrypted server-side; only non-secret status returns. */
  putCredentials(body: CredentialsInput): Promise<CredentialStatus> {
    return this.request('PUT', '/credentials', body);
  }

  deleteCredentials(): Promise<void> {
    return this.request('DELETE', '/credentials');
  }

  // --- runs (server-authoritative generation) ---
  /** Submit a prompt; the server generates + persists the reply even if this client disconnects. */
  submitRun(threadId: string, body: SubmitRunBody): Promise<SubmitRunResult> {
    return this.request('POST', `/threads/${encodeURIComponent(threadId)}/runs`, body);
  }

  getRun(threadId: string, runId: string): Promise<RunRecord> {
    return this.request(
      'GET',
      `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
    );
  }

  async listActiveRuns(threadId: string): Promise<RunRecord[]> {
    const out = await this.request<{ runs: RunRecord[] }>(
      'GET',
      `/threads/${encodeURIComponent(threadId)}/runs`,
    );
    return out.runs;
  }

  cancelRun(threadId: string, runId: string): Promise<RunRecord> {
    return this.request(
      'DELETE',
      `/threads/${encodeURIComponent(threadId)}/runs/${encodeURIComponent(runId)}`,
    );
  }

  // --- realtime (SignalR) ---
  /** Get the realtime connection info for this user. Empty url ⇒ push not configured. */
  negotiate(): Promise<NegotiateInfo> {
    return this.request('POST', '/negotiate');
  }

  // --- thread knowledge base (documents for file search) ---
  async listThreadFiles(threadId: string): Promise<ThreadFileRecord[]> {
    const out = await this.request<{ files: ThreadFileRecord[] }>(
      'GET',
      `/threads/${encodeURIComponent(threadId)}/files`,
    );
    return out.files;
  }

  /** Upload a document (base64) into the thread's vector store; the server indexes it. */
  uploadThreadFile(
    threadId: string,
    body: { name: string; mime: string; dataBase64: string },
  ): Promise<ThreadFileRecord> {
    return this.request('POST', `/threads/${encodeURIComponent(threadId)}/files`, body);
  }

  deleteThreadFile(threadId: string, fileId: string): Promise<void> {
    return this.request(
      'DELETE',
      `/threads/${encodeURIComponent(threadId)}/files/${encodeURIComponent(fileId)}`,
    );
  }

  // --- AI proxies (dictation / voice run through the server vault key) ---
  transcribeAudio(body: {
    audioBase64: string;
    mime?: string;
    language?: string;
    prompt?: string;
  }): Promise<{ text: string }> {
    return this.request('POST', '/ai/transcribe', body);
  }

  synthesizeSpeech(body: { input: string; voice?: string }): Promise<{ audioBase64: string; mime: string }> {
    return this.request('POST', '/ai/speech', body);
  }

  chatComplete(messages: Array<{ role: string; content: string }>): Promise<{ text: string }> {
    return this.request('POST', '/ai/chat', { messages });
  }

  generateImage(body: { prompt: string; size?: string }): Promise<{ images: Array<{ b64: string }> }> {
    return this.request('POST', '/ai/image', body);
  }

  // --- image studio (server-authoritative generation, CRUD + search) ---
  /** Create N images; the server generates + stores them even if this client disconnects. */
  async createImages(body: CreateImagesBody): Promise<StudioImage[]> {
    const out = await this.request<{ images: StudioImage[] }>('POST', '/images', body);
    return out.images;
  }

  listImages(query: ListImagesQuery = {}): Promise<ListImagesResult> {
    const qs = new URLSearchParams();
    if (query.q) qs.set('q', query.q);
    if (query.size) qs.set('size', query.size);
    if (query.sort) qs.set('sort', query.sort);
    if (query.cursor) qs.set('cursor', query.cursor);
    if (query.limit) qs.set('limit', String(query.limit));
    const suffix = qs.toString();
    return this.request('GET', `/images${suffix ? `?${suffix}` : ''}`);
  }

  getImage(id: string): Promise<StudioImage> {
    return this.request('GET', `/images/${encodeURIComponent(id)}`);
  }

  deleteImage(id: string): Promise<void> {
    return this.request('DELETE', `/images/${encodeURIComponent(id)}`);
  }

  // --- access / invites ---
  getMe(): Promise<MeInfo> {
    return this.request('GET', '/me');
  }

  async listInvites(): Promise<InviteRecord[]> {
    const out = await this.request<{ invites: InviteRecord[] }>('GET', '/invites');
    return out.invites;
  }

  createInvite(email: string): Promise<InviteRecord> {
    return this.request('POST', '/invites', { email });
  }

  deleteInvite(email: string): Promise<void> {
    return this.request('DELETE', `/invites/${encodeURIComponent(email)}`);
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
  acquireThreadLock(
    threadId: string,
    body: { deviceId: string; deviceLabel: string },
  ): Promise<{ thread: ThreadRecord; lock: ThreadLock }>;
  getThreadLock(threadId: string): Promise<ThreadLock | null>;
  releaseThreadLock(threadId: string, deviceId: string): Promise<void>;
  getSettings(): Promise<Settings>;
  patchSettings(patch: Partial<Settings>): Promise<Settings>;
  requestSas(body: SasRequestBody): Promise<SasResult>;
  getCredentialStatus(): Promise<CredentialStatus>;
  putCredentials(body: CredentialsInput): Promise<CredentialStatus>;
  deleteCredentials(): Promise<void>;
  submitRun(threadId: string, body: SubmitRunBody): Promise<SubmitRunResult>;
  getRun(threadId: string, runId: string): Promise<RunRecord>;
  listActiveRuns(threadId: string): Promise<RunRecord[]>;
  cancelRun(threadId: string, runId: string): Promise<RunRecord>;
  negotiate(): Promise<NegotiateInfo>;
  listThreadFiles(threadId: string): Promise<ThreadFileRecord[]>;
  uploadThreadFile(
    threadId: string,
    body: { name: string; mime: string; dataBase64: string },
  ): Promise<ThreadFileRecord>;
  deleteThreadFile(threadId: string, fileId: string): Promise<void>;
  transcribeAudio(body: {
    audioBase64: string;
    mime?: string;
    language?: string;
    prompt?: string;
  }): Promise<{ text: string }>;
  synthesizeSpeech(body: { input: string; voice?: string }): Promise<{ audioBase64: string; mime: string }>;
  chatComplete(messages: Array<{ role: string; content: string }>): Promise<{ text: string }>;
  generateImage(body: { prompt: string; size?: string }): Promise<{ images: Array<{ b64: string }> }>;
  createImages(body: CreateImagesBody): Promise<StudioImage[]>;
  listImages(query?: ListImagesQuery): Promise<ListImagesResult>;
  getImage(id: string): Promise<StudioImage>;
  deleteImage(id: string): Promise<void>;
  getMe(): Promise<MeInfo>;
  listInvites(): Promise<InviteRecord[]>;
  createInvite(email: string): Promise<InviteRecord>;
  deleteInvite(email: string): Promise<void>;
}
