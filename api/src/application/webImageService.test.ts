import { describe, it, expect, vi } from 'vitest';
import { WebImageService } from './webImageService';
import { AppError } from '../domain/errors';

function makeRes(opts: { status?: number; ct?: string; cl?: string; loc?: string; body?: Uint8Array }): Response {
  const headers = new Map<string, string>();
  if (opts.ct) headers.set('content-type', opts.ct);
  if (opts.cl) headers.set('content-length', opts.cl);
  if (opts.loc) headers.set('location', opts.loc);
  const status = opts.status ?? 200;
  return {
    status,
    ok: status >= 200 && status < 300,
    headers: { get: (k: string) => headers.get(k.toLowerCase()) ?? null },
    arrayBuffer: async () => (opts.body ?? new Uint8Array([1, 2, 3])).buffer,
  } as unknown as Response;
}

async function err(p: Promise<unknown>): Promise<AppError> {
  return p.then(() => { throw new Error('expected rejection'); }, (e) => e as AppError);
}

describe('WebImageService.fetch', () => {
  it('returns base64 bytes + mime for a public image URL', async () => {
    const fetchImpl = vi.fn(async () => makeRes({ ct: 'image/png', body: new Uint8Array([10, 20, 30]) }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.fetch('https://images.unsplash.com/cat.png');
    expect(out.mime).toBe('image/png');
    expect(out.bytes).toBe(3);
    expect(Buffer.from(out.dataBase64, 'base64')).toEqual(Buffer.from([10, 20, 30]));
  });

  it('rejects an internal host without fetching', async () => {
    const fetchImpl = vi.fn();
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const e = await err(svc.fetch('http://169.254.169.254/latest/meta-data'));
    expect(e).toBeInstanceOf(AppError);
    expect(e.code).toBe('validation');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('rejects a non-image content-type', async () => {
    const fetchImpl = vi.fn(async () => makeRes({ ct: 'text/html', body: new Uint8Array([1]) }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await err(svc.fetch('https://a.com/x'))).code).toBe('validation');
  });

  it('rejects an over-cap image via content-length', async () => {
    const fetchImpl = vi.fn(async () => makeRes({ ct: 'image/jpeg', cl: String(99 * 1024 * 1024) }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch, maxBytes: 1024 });
    expect((await err(svc.fetch('https://a.com/big.jpg'))).code).toBe('validation');
  });

  it('rejects an over-cap image via actual byte length', async () => {
    const fetchImpl = vi.fn(async () => makeRes({ ct: 'image/jpeg', body: new Uint8Array(2048) }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch, maxBytes: 1024 });
    expect((await err(svc.fetch('https://a.com/big.jpg'))).code).toBe('validation');
  });

  it('follows a redirect to a public image', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(makeRes({ status: 302, loc: 'https://cdn.example.com/final.webp' }))
      .mockResolvedValueOnce(makeRes({ ct: 'image/webp', body: new Uint8Array([7, 8]) }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    const out = await svc.fetch('https://a.com/redir');
    expect(out.mime).toBe('image/webp');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('blocks a redirect that points at an internal host', async () => {
    const fetchImpl = vi.fn(async () => makeRes({ status: 302, loc: 'http://10.0.0.5/secret.png' }));
    const svc = new WebImageService({ fetchImpl: fetchImpl as unknown as typeof fetch });
    expect((await err(svc.fetch('https://a.com/redir'))).code).toBe('validation');
  });
});
