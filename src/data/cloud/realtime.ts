// Realtime push over Azure SignalR (serverless). The server pushes assistant-message snapshots
// (target 'message') and thread updates (target 'thread') to the signed-in user as a run streams;
// this client connects lazily and fans those out to registered handlers so the chat UI reflects
// the latest state without waiting for the next sync poll. Best-effort: if negotiation or the
// connection fails, callers keep working via sync polling — realtime only accelerates rendering.
import * as signalR from '@microsoft/signalr';
import type { NegotiateInfo } from './apiClient';

export type RealtimeHandler = (payload: unknown) => void;

/** Minimal connection surface used by the client — satisfied by signalR.HubConnection and by test
 *  fakes, so the orchestration is unit-testable without a live socket. */
export interface RealtimeConnection {
  on(target: string, cb: (...args: unknown[]) => void): void;
  start(): Promise<void>;
  stop(): Promise<void>;
  readonly state: string;
}

export type ConnectionFactory = (info: NegotiateInfo) => RealtimeConnection;

function defaultFactory(negotiate: () => Promise<NegotiateInfo>): ConnectionFactory {
  return (info) =>
    new signalR.HubConnectionBuilder()
      .withUrl(info.url, { accessTokenFactory: async () => (await negotiate()).accessToken })
      .withAutomaticReconnect()
      .build();
}

export class RealtimeClient {
  private conn: RealtimeConnection | null = null;
  private starting: Promise<void> | null = null;
  private readonly factory: ConnectionFactory;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly liveAt = new Map<string, number>();

  constructor(
    private readonly negotiate: () => Promise<NegotiateInfo>,
    factory?: ConnectionFactory,
  ) {
    this.factory = factory ?? defaultFactory(negotiate);
  }

  /** Lazily connect (idempotent, de-duped). Resolves true when connected, false when realtime is
   *  unavailable (not configured, negotiation/connection failed). Never throws. */
  async ensure(): Promise<boolean> {
    if (this.isConnected()) return true;
    if (!this.starting) {
      this.starting = this.connect().finally(() => {
        this.starting = null;
      });
    }
    try {
      await this.starting;
    } catch {
      /* stay disconnected — the sync poll is the fallback */
    }
    return this.isConnected();
  }

  private isConnected(): boolean {
    return this.conn?.state === signalR.HubConnectionState.Connected;
  }

  private async connect(): Promise<void> {
    const info = await this.negotiate();
    if (!info.url) return; // realtime not configured server-side
    const conn = this.factory(info);
    conn.on('message', (p: unknown) => this.dispatch('message', p));
    conn.on('thread', (p: unknown) => this.dispatch('thread', p));
    await conn.start();
    this.conn = conn;
  }

  private dispatch(target: string, payload: unknown): void {
    if (target === 'message') {
      const tid = (payload as { threadId?: string } | null)?.threadId;
      if (tid) this.liveAt.set(tid, Date.now());
    }
    const hs = this.handlers.get(target);
    if (hs) for (const h of [...hs]) {
      try {
        h(payload);
      } catch {
        /* a handler error must not break the dispatch loop */
      }
    }
  }

  /** Register a handler for a push target ('message' | 'thread'). Returns an unsubscribe fn. */
  on(target: string, handler: RealtimeHandler): () => void {
    let hs = this.handlers.get(target);
    if (!hs) {
      hs = new Set();
      this.handlers.set(target, hs);
    }
    hs.add(handler);
    return () => {
      this.handlers.get(target)?.delete(handler);
    };
  }

  /** Epoch ms of the last 'message' push for a thread (0 if none) — lets the poller defer to push
   *  while it's live, then take over if push goes quiet. */
  liveSince(threadId: string): number {
    return this.liveAt.get(threadId) ?? 0;
  }

  async stop(): Promise<void> {
    const c = this.conn;
    this.conn = null;
    if (c) await c.stop().catch(() => {});
  }
}
