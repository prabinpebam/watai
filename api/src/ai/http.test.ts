import { describe, expect, it, vi } from 'vitest';
import { aiFetch, parseSse } from './http';

describe('streaming HTTP deadlines', () => {
  it('aborts a request that never returns headers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const request = aiFetch({
      baseUrl: 'https://example.invalid/openai/v1', key: 'key', path: '/responses', stream: true,
      timeoutMs: 75, fetchImpl,
    });
    const rejected = expect(request).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(76);
    await rejected;
    vi.useRealTimers();
  });

  it('keeps the total timeout attached after headers and aborts a stalled body read', async () => {
    vi.useFakeTimers();
    let requestSignal: AbortSignal | undefined;
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => {
      requestSignal = init?.signal ?? undefined;
      const body = new ReadableStream<Uint8Array>({
        start() {
          // Headers are available immediately; the body never yields or closes.
        },
      });
      return new Response(body, { status: 200 });
    }) as unknown as typeof fetch;

    const response = await aiFetch({
      baseUrl: 'https://example.invalid/openai/v1', key: 'key', path: '/responses', stream: true,
      timeoutMs: 100, fetchImpl,
    });
    const reading = parseSse(response).next();
    const rejected = expect(reading).rejects.toBeTruthy();
    await vi.advanceTimersByTimeAsync(101);

    expect(requestSignal?.aborted).toBe(true);
    await rejected;
    vi.useRealTimers();
  });

  it('cancels a body read that exceeds the idle budget', async () => {
    vi.useFakeTimers();
    const response = new Response(new ReadableStream<Uint8Array>({ start() {} }));
    const reading = parseSse(response, undefined, { idleTimeoutMs: 50 }).next();
    const rejected = expect(reading).rejects.toMatchObject({ name: 'TimeoutError' });
    await vi.advanceTimersByTimeAsync(51);
    await rejected;
    vi.useRealTimers();
  });
});
