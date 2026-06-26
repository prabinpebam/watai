import { describe, it, expect, vi } from 'vitest';
import { RealtimeClient, type RealtimeConnection } from './realtime';
import type { NegotiateInfo } from './apiClient';

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
  const client = new RealtimeClient(negotiate, () => conn);
  return { client, conn, negotiate };
}

describe('RealtimeClient', () => {
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
});
