// Azure SignalR Service (serverless) data-plane helper. Signs short-lived HS256 JWTs with the
// connection-string AccessKey to (a) mint a client negotiate token and (b) push messages to a
// specific user via the v1 REST API. Clients are listen-only in serverless mode; only the server
// (this worker) sends. Best-effort: callers treat push failures as non-fatal (the sync/poll is the
// fallback). See documentation/06-server-runs-and-migration.md §5.
import { createHmac } from 'node:crypto';

const DEFAULT_HUB = 'watai';

function b64url(s: string): string {
  return Buffer.from(s).toString('base64url');
}

/** Sign an HS256 JWT with the SignalR AccessKey. */
function signJwt(claims: Record<string, unknown>, key: string): string {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const payload = b64url(JSON.stringify(claims));
  const sig = createHmac('sha256', key).update(`${header}.${payload}`).digest('base64url');
  return `${header}.${payload}.${sig}`;
}

export interface SignalRConnectionInfo {
  url: string;
  accessToken: string;
}

export interface SignalRSender {
  /** Mint the negotiate response a client uses to connect, tagged with its user id (`nameid`). */
  negotiate(userId: string): SignalRConnectionInfo;
  /** Push a message to all of a user's connections. Best-effort (never throws). */
  sendToUser(userId: string, target: string, payload: unknown): Promise<void>;
}

/** Parse the `Endpoint=...;AccessKey=...;Version=...;` connection string. */
function parseConnectionString(conn: string): { endpoint: string; accessKey: string } {
  const map = new Map<string, string>();
  for (const part of conn.split(';')) {
    const i = part.indexOf('=');
    if (i > 0) map.set(part.slice(0, i).trim(), part.slice(i + 1).trim());
  }
  return {
    endpoint: (map.get('Endpoint') ?? '').replace(/\/+$/, ''),
    accessKey: map.get('AccessKey') ?? '',
  };
}

export class AzureSignalR implements SignalRSender {
  private readonly endpoint: string;
  private readonly accessKey: string;
  private readonly hub: string;
  private readonly fetchImpl: typeof fetch;

  constructor(connectionString: string, opts?: { hub?: string; fetchImpl?: typeof fetch }) {
    const { endpoint, accessKey } = parseConnectionString(connectionString);
    this.endpoint = endpoint;
    this.accessKey = accessKey;
    this.hub = opts?.hub ?? DEFAULT_HUB;
    this.fetchImpl = opts?.fetchImpl ?? fetch;
  }

  negotiate(userId: string): SignalRConnectionInfo {
    const url = `${this.endpoint}/client/?hub=${this.hub}`;
    const exp = Math.floor(Date.now() / 1000) + 60 * 60;
    // aud must equal the client url; nameid identifies the connection's user for user-scoped sends.
    const accessToken = signJwt({ aud: url, exp, nameid: userId }, this.accessKey);
    return { url, accessToken };
  }

  async sendToUser(userId: string, target: string, payload: unknown): Promise<void> {
    // v1 data-plane: aud = the request URL (no query/trailing slash).
    const url = `${this.endpoint}/api/v1/hubs/${this.hub}/users/${encodeURIComponent(userId)}`;
    const exp = Math.floor(Date.now() / 1000) + 60;
    const token = signJwt({ aud: url, exp }, this.accessKey);
    try {
      await this.fetchImpl(url, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ target, arguments: [payload] }),
      });
    } catch {
      /* best-effort — the sync/poll is the fallback */
    }
  }
}
