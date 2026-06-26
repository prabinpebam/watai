import { describe, it, expect, vi } from 'vitest';
import { AzureSignalR } from './signalr';

const CONN = 'Endpoint=https://example.service.signalr.net;AccessKey=secretkey123;Version=1.0;';

function decodeJwt(token: string): { header: unknown; payload: Record<string, unknown> } {
  const [h, p] = token.split('.');
  return {
    header: JSON.parse(Buffer.from(h, 'base64url').toString()),
    payload: JSON.parse(Buffer.from(p, 'base64url').toString()),
  };
}

describe('AzureSignalR.negotiate', () => {
  it('returns the client url and a token carrying aud + nameid', () => {
    const sr = new AzureSignalR(CONN);
    const info = sr.negotiate('user-1');
    expect(info.url).toBe('https://example.service.signalr.net/client/?hub=watai');
    const { header, payload } = decodeJwt(info.accessToken);
    expect(header).toEqual({ alg: 'HS256', typ: 'JWT' });
    expect(payload.aud).toBe(info.url);
    expect(payload.nameid).toBe('user-1');
    expect(typeof payload.exp).toBe('number');
    expect(payload.exp as number).toBeGreaterThan(Math.floor(Date.now() / 1000));
  });

  it('uses a custom hub when provided', () => {
    const sr = new AzureSignalR(CONN, { hub: 'other' });
    expect(sr.negotiate('u').url).toBe('https://example.service.signalr.net/client/?hub=other');
  });
});

describe('AzureSignalR.sendToUser', () => {
  it('POSTs the v1 user-send endpoint with a Bearer token scoped to that url', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const sr = new AzureSignalR(CONN, { fetchImpl: fetchImpl as unknown as typeof fetch });

    await sr.sendToUser('user-1', 'message', { hello: 'world' });

    expect(fetchImpl).toHaveBeenCalledTimes(1);
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://example.service.signalr.net/api/v1/hubs/watai/users/user-1');
    expect(init.method).toBe('POST');
    expect(init.headers.Authorization).toMatch(/^Bearer /);
    expect(JSON.parse(init.body)).toEqual({ target: 'message', arguments: [{ hello: 'world' }] });
    const token = (init.headers.Authorization as string).slice('Bearer '.length);
    expect(decodeJwt(token).payload.aud).toBe(url);
  });

  it('url-encodes the user id', async () => {
    const fetchImpl = vi.fn().mockResolvedValue({ ok: true });
    const sr = new AzureSignalR(CONN, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await sr.sendToUser('a|b c', 'message', {});
    expect(fetchImpl.mock.calls[0][0]).toBe(
      'https://example.service.signalr.net/api/v1/hubs/watai/users/a%7Cb%20c',
    );
  });

  it('never throws when the push fails (best-effort)', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network'));
    const sr = new AzureSignalR(CONN, { fetchImpl: fetchImpl as unknown as typeof fetch });
    await expect(sr.sendToUser('u', 'message', {})).resolves.toBeUndefined();
  });
});
