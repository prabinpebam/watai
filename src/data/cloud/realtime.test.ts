import { afterEach, describe, it, expect, vi } from 'vitest';
import { RealtimeClient, type RealtimeConnection } from './realtime';
import type { NegotiateInfo } from './apiClient';
import { HubConnectionBuilder, LogLevel, type HubConnection, type ILogger } from '@microsoft/signalr';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

const clients: RealtimeClient[] = [];
function trackedClient(...args: ConstructorParameters<typeof RealtimeClient>): RealtimeClient {
  const client = new RealtimeClient(...args);
  clients.push(client);
  return client;
}

afterEach(async () => {
  await Promise.all(clients.splice(0).map(client => client.stop()));
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

class FakeConn implements RealtimeConnection {
  state = 'Disconnected';
  startErr?: Error;
  readonly handlers = new Map<string, (...args: unknown[]) => void>();
  on(target: string, cb: (...args: unknown[]) => void): void {
    this.handlers.set(target, cb);
  }
  async start(): Promise<void> {
    if (this.startErr) throw this.startErr;
    this.state = 'Connected';
  }
  async stop(): Promise<void> {
    this.state = 'Disconnected';
  }
  emit(target: string, payload: unknown): void {
    this.handlers.get(target)?.(payload);
  }
}

function make(info: NegotiateInfo, conn = new FakeConn()) {
  const negotiate = vi.fn(async () => info);
  const client = trackedClient(negotiate, () => conn);
  return { client, conn, negotiate };
}

describe('RealtimeClient', () => {
  it('renews credentials for the current connection', async () => {
    const conn = new FakeConn();
    vi.spyOn(HubConnectionBuilder.prototype, 'build').mockReturnValue(conn as unknown as HubConnection);
    const withUrl = vi.spyOn(HubConnectionBuilder.prototype, 'withUrl');
    const negotiate = vi.fn()
      .mockResolvedValueOnce({ url: 'https://test.invalid/client/', accessToken: 'synthetic-initial' })
      .mockResolvedValueOnce({ url: 'https://test.invalid/client/', accessToken: 'synthetic-renewal' });
    const client = trackedClient(negotiate);
    expect(await client.ensure()).toBe(true);
    const options = withUrl.mock.calls[0][1] as { accessTokenFactory: () => Promise<string> };
    expect(await options.accessTokenFactory()).toBe('synthetic-renewal');
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it.each(['before-refresh', 'during-refresh'])('does not release refreshed credentials after stop: %s', async stage => {
    const pending = deferred<NegotiateInfo>();
    const conn = new FakeConn();
    vi.spyOn(HubConnectionBuilder.prototype, 'build').mockReturnValue(conn as unknown as HubConnection);
    const withUrl = vi.spyOn(HubConnectionBuilder.prototype, 'withUrl');
    const negotiate = vi.fn().mockResolvedValueOnce({ url: 'https://test.invalid/client/', accessToken: 'synthetic-initial' }).mockReturnValue(pending.promise);
    const client = trackedClient(negotiate);
    await client.ensure();
    const options = withUrl.mock.calls[0][1] as { accessTokenFactory: () => Promise<string> };
    if (stage === 'before-refresh') await client.stop();
    const refreshed = options.accessTokenFactory();
    const rejected = expect(refreshed).rejects.toThrow('Realtime connection is no longer active.');
    if (stage === 'during-refresh') await client.stop();
    pending.resolve({ url: 'https://test.invalid/client/', accessToken: 'synthetic-late' });
    await rejected;
    expect(negotiate).toHaveBeenCalledTimes(stage === 'before-refresh' ? 1 : 2);
  });

  it('recovers an initially unavailable connection when the browser returns online', async () => {
    const conn = new FakeConn();
    conn.startErr = new Error('Offline');
    const { client, negotiate } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' }, conn);
    expect(await client.ensure()).toBe(false);
    conn.startErr = undefined;
    window.dispatchEvent(new Event('online'));
    await vi.waitFor(() => expect(conn.state).toBe('Connected'));
    expect(negotiate).toHaveBeenCalledTimes(2);
  });

  it('connects through an injected transport without browser globals', async () => {
    const { client } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    vi.stubGlobal('window', undefined);
    vi.stubGlobal('document', undefined);
    try {
      expect(await client.ensure()).toBe(true);
      await client.stop();
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(['online', 'pageshow', 'visibilitychange'])('resumes an exhausted connection on %s without requiring another caller', async event => {
    const { client, conn, negotiate } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    await client.ensure();
    conn.state = 'Disconnected';
    if (event === 'visibilitychange') {
      vi.spyOn(document, 'visibilityState', 'get').mockReturnValue('visible');
      document.dispatchEvent(new Event(event));
    } else window.dispatchEvent(new Event(event));
    await vi.waitFor(() => expect(negotiate).toHaveBeenCalledTimes(2));
    expect(conn.state).toBe('Connected');
  });

  it('does not activate on resume before first ensure or after stopping', async () => {
    const { client, negotiate } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    window.dispatchEvent(new Event('online'));
    expect(negotiate).not.toHaveBeenCalled();
    const add = vi.spyOn(window, 'addEventListener');
    await client.ensure();
    const oldResume = add.mock.calls.find(([event]) => event === 'online')?.[1] as EventListener | undefined;
    expect(oldResume).toBeTypeOf('function');
    await client.stop();
    window.dispatchEvent(new Event('pageshow'));
    window.dispatchEvent(new Event('online'));
    oldResume?.(new Event('online'));
    expect(negotiate).toHaveBeenCalledOnce();
  });

  it('leaves a reconnecting connection alone on resume', async () => {
    const { client, conn, negotiate } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    await client.ensure();
    conn.state = 'Reconnecting';
    window.dispatchEvent(new Event('online'));
    window.dispatchEvent(new Event('pageshow'));
    await Promise.resolve();
    expect(negotiate).toHaveBeenCalledOnce();
  });

  it.each(['Reconnecting', 'Connecting', 'Disconnecting'])('does not create a second connection while the current one is %s', async state => {
    const { client, conn, negotiate } = make({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    await client.ensure();
    conn.state = state;
    expect(await client.ensure()).toBe(false);
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('does not resume a negotiation that completed after stop', async () => {
    const pending = deferred<NegotiateInfo>();
    const conn = new FakeConn();
    const factory = vi.fn(() => conn);
    const client = trackedClient(() => pending.promise, factory);
    const starting = client.ensure();
    await client.stop();
    pending.resolve({ url: 'https://test.invalid/client/', accessToken: 'synthetic' });
    expect(await starting).toBe(false);
    expect(factory).not.toHaveBeenCalled();
  });

  it('discards late connection completion and events after stop, then allows a fresh connection', async () => {
    const pending = deferred<void>();
    const old = new FakeConn();
    const fresh = new FakeConn();
    vi.spyOn(old, 'start').mockImplementation(async () => { await pending.promise; old.state = 'Connected'; });
    const factory = vi.fn().mockReturnValueOnce(old).mockReturnValueOnce(fresh);
    const client = trackedClient(async () => ({ url: 'https://test.invalid/client/', accessToken: 'synthetic' }), factory);
    const seen = vi.fn();
    client.on('message', seen);
    const starting = client.ensure();
    await Promise.resolve();
    await client.stop();
    expect(await client.ensure()).toBe(true);
    pending.resolve();
    await starting;
    old.emit('message', { threadId: 'old-thread' });
    expect(seen).not.toHaveBeenCalled();
    expect(client.liveSince('old-thread')).toBe(0);
    expect(old.state).toBe('Disconnected');
    fresh.emit('message', { threadId: 'fresh-thread' });
    expect(seen).toHaveBeenCalledOnce();
    await client.stop();
    expect(client.liveSince('fresh-thread')).toBe(0);
  });

  it('uses fixed diagnostics instead of logging token URLs or provider error text', async () => {
    const conn = new FakeConn();
    const build = vi.spyOn(HubConnectionBuilder.prototype, 'build').mockReturnValue(conn as unknown as HubConnection);
    const configure = vi.spyOn(HubConnectionBuilder.prototype, 'configureLogging');
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const client = trackedClient(async () => ({ url: 'https://test.invalid/client/', accessToken: 'synthetic' }));
      expect(await client.ensure()).toBe(true);
      expect(configure).toHaveBeenCalledOnce();
      const logger = configure.mock.calls[0][0] as ILogger;
      logger.log(LogLevel.Information, 'Connected: wss://test.invalid/?access_token=synthetic-secret');
      expect(warn).not.toHaveBeenCalled();
      logger.log(LogLevel.Warning, 'Private transport detail: synthetic-secret');
      logger.log(LogLevel.Error, 'Disconnected wss://test.invalid/?access_token=synthetic-secret');
      expect(warn.mock.calls).toEqual([
        ['[realtime] Transport interrupted; background sync remains available.'],
        ['[realtime] Transport interrupted; background sync remains available.'],
      ]);
    } finally {
      warn.mockRestore();
      configure.mockRestore();
      build.mockRestore();
    }
  });

  it('connects when negotiate returns a url, and is idempotent', async () => {
    const { client, conn, negotiate } = make({ url: 'https://x/client/?hub=watai', accessToken: 't' });
    expect(await client.ensure()).toBe(true);
    expect(conn.state).toBe('Connected');
    expect(await client.ensure()).toBe(true); // already connected — no re-negotiate
    expect(negotiate).toHaveBeenCalledTimes(1);
  });

  it('stays disconnected when realtime is not configured (empty url)', async () => {
    const { client } = make({ url: '', accessToken: '' });
    expect(await client.ensure()).toBe(false);
  });

  it('never throws when the connection fails to start (poll is the fallback)', async () => {
    const conn = new FakeConn();
    conn.startErr = new Error('handshake failed');
    const { client } = make({ url: 'https://x/client/?hub=watai', accessToken: 't' }, conn);
    expect(await client.ensure()).toBe(false);
  });

  it('dispatches message pushes to handlers and records liveSince per thread', async () => {
    const { client, conn } = make({ url: 'https://x/client/?hub=watai', accessToken: 't' });
    await client.ensure();
    const seen: unknown[] = [];
    client.on('message', (p) => seen.push(p));

    const before = Date.now();
    conn.emit('message', { threadId: 't1', message: { id: 'm1', content: 'Hi' } });

    expect(seen).toEqual([{ threadId: 't1', message: { id: 'm1', content: 'Hi' } }]);
    expect(client.liveSince('t1')).toBeGreaterThanOrEqual(before);
    expect(client.liveSince('t2')).toBe(0);
  });

  it('dispatches thread pushes and supports unsubscribe', async () => {
    const { client, conn } = make({ url: 'https://x/client/?hub=watai', accessToken: 't' });
    await client.ensure();
    const seen: unknown[] = [];
    const off = client.on('thread', (p) => seen.push(p));

    conn.emit('thread', { thread: { id: 't1', title: 'Hello' } });
    off();
    conn.emit('thread', { thread: { id: 't1', title: 'Again' } });

    expect(seen).toEqual([{ thread: { id: 't1', title: 'Hello' } }]);
  });

  it('dispatches memory pushes', async () => {
    const { client, conn } = make({ url: 'https://x/client/?hub=watai', accessToken: 't' });
    await client.ensure();
    const seen: unknown[] = [];
    client.on('memory', (p) => seen.push(p));

    conn.emit('memory', { acceptedCount: 1, threadId: 't1' });

    expect(seen).toEqual([{ acceptedCount: 1, threadId: 't1' }]);
  });
});
