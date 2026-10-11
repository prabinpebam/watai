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

const realtimeLogger: signalR.ILogger = {
  log(level) {
    if (level === signalR.LogLevel.Warning || level === signalR.LogLevel.Error || level === signalR.LogLevel.Critical) {
      console.warn('[realtime] Transport interrupted; background sync remains available.');
    }
  },
};

function defaultFactory(negotiate: () => Promise<NegotiateInfo>): ConnectionFactory {
  return (info) =>
    new signalR.HubConnectionBuilder()
      .withUrl(info.url, { accessTokenFactory: async () => (await negotiate()).accessToken })
      .withAutomaticReconnect()
      .configureLogging(realtimeLogger)
      .build();
}

export class RealtimeClient {
  private conn: RealtimeConnection | null = null;
  private starting: Promise<void> | null = null;
  private generation = 0;
  private resumeCleanup: (() => void) | null = null;
  private readonly factory?: ConnectionFactory;
  private readonly handlers = new Map<string, Set<RealtimeHandler>>();
  private readonly liveAt = new Map<string, number>();

  constructor(
    private readonly negotiate: () => Promise<NegotiateInfo>,
    factory?: ConnectionFactory,
  ) {
    this.factory = factory;
  }

  /** Lazily connect (idempotent, de-duped). Resolves true when connected, false when realtime is
   *  unavailable (not configured, negotiation/connection failed). Never throws. */
  async ensure(): Promise<boolean> {
    this.listenForResume();
    if (this.isConnected()) return true;
    if (!this.starting && this.conn && this.conn.state !== signalR.HubConnectionState.Disconnected) return false;
    const generation = this.generation;
    if (!this.starting) {
      this.starting = this.connect(generation).finally(() => {
        if (generation === this.generation) this.starting = null;
      });
    }
    try {
      await this.starting;
    } catch {
      /* stay disconnected — the sync poll is the fallback */
    }
    return generation === this.generation && this.isConnected();
  }

  private isConnected(): boolean {
    return this.conn?.state === signalR.HubConnectionState.Connected;
  }

  private listenForResume(): void {
    if (this.resumeCleanup || typeof window === 'undefined' || typeof document === 'undefined') return;
    const browserWindow = window;
    const browserDocument = document;
    const generation = this.generation;
    const resume = () => {
      if (generation !== this.generation || (this.conn && this.conn.state !== signalR.HubConnectionState.Disconnected)) return;
      void this.ensure();
    };
    const onVisibility = () => {
      if (browserDocument.visibilityState === 'visible') resume();
    };
    browserWindow.addEventListener('online', resume);
    browserWindow.addEventListener('pageshow', resume);
    browserDocument.addEventListener('visibilitychange', onVisibility);
    this.resumeCleanup = () => {
      browserWindow.removeEventListener('online', resume);
      browserWindow.removeEventListener('pageshow', resume);
      browserDocument.removeEventListener('visibilitychange', onVisibility);
    };
  }

  private async connect(generation: number): Promise<void> {
    const info = await this.negotiate();
    if (generation !== this.generation || !info.url) return;
    const conn: RealtimeConnection = (this.factory ?? defaultFactory(async () => {
      if (generation !== this.generation || this.conn !== conn) throw new Error('Realtime connection is no longer active.');
      const refreshed = await this.negotiate();
      if (generation !== this.generation || this.conn !== conn) throw new Error('Realtime connection is no longer active.');
      return refreshed;
    }))(info);
    this.conn = conn;
    for (const target of ['message', 'thread', 'image', 'memory']) {
      conn.on(target, (payload: unknown) => {
        if (generation === this.generation && this.conn === conn) this.dispatch(target, payload);
      });
    }
    try {
      await conn.start();
      if (generation !== this.generation || this.conn !== conn) await conn.stop().catch(() => undefined);
    } catch (error) {
      if (this.conn === conn) this.conn = null;
      await conn.stop().catch(() => undefined);
      throw error;
    }
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
    this.generation += 1;
    this.resumeCleanup?.();
    this.resumeCleanup = null;
    const c = this.conn;
    this.conn = null;
    this.starting = null;
    this.liveAt.clear();
    if (c) await c.stop().catch(() => {});
  }
}
