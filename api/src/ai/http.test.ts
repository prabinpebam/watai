import { describe, expect, it, vi } from 'vitest';
import { aiFetch, parseSse } from './http';

const endpoint = 'https://safe.services.ai.azure.com/openai/v1';

describe('credentialed destination policy', () => {
  it.each([
    'http://safe.services.ai.azure.com/openai/v1',
    'https://user:password@safe.services.ai.azure.com/openai/v1',
    'https://safe.services.ai.azure.com:8443/openai/v1',
    'https://safe.services.ai.azure.com.attacker.invalid/openai/v1',
    'https://127.0.0.1/openai/v1',
    'https://169.254.169.254/openai/v1',
    'https://[::1]/openai/v1',
    'https://example.invalid/openai/v1',
    'not a URL',
  ])('rejects an unapproved base before fetch: %s', async (baseUrl) => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await expect(aiFetch({ baseUrl, key: 'test-secret', path: '/responses', fetchImpl }))
      .rejects.toMatchObject({ code: 'validation' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'https://other.services.ai.azure.com/openai/v1/files',
    'https://other.cognitiveservices.azure.com/openai/v1/files',
    'https://safe.openai.azure.com/openai/v1/files',
    'https://attacker.invalid/content',
    'http://safe.services.ai.azure.com/openai/v1/files',
    'https://safe.services.ai.azure.com:8443/openai/v1/files',
    'https://user:password@safe.services.ai.azure.com/openai/v1/files',
  ])('rejects a destination outside the saved resource: %s', async (url) => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await expect(aiFetch({ baseUrl: endpoint, key: 'test-secret', url, fetchImpl }))
      .rejects.toMatchObject({ code: 'validation' });
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it.each([
    'https://safe.services.ai.azure.com/openai/v1/files?limit=10',
    'https://safe.cognitiveservices.azure.com/openai/deployments/transcribe/audio/transcriptions?api-version=2025-01-01',
  ])('allows only same-resource aliases and forbids redirects: %s', async (url) => {
    const fetchImpl = vi.fn(async () => new Response('{}'));
    await aiFetch({ baseUrl: endpoint, key: 'test-secret', url, fetchImpl });
    expect(fetchImpl).toHaveBeenCalledExactlyOnceWith(url, expect.objectContaining({
      redirect: 'error', headers: expect.objectContaining({ Authorization: 'Bearer test-secret' }),
    }));
  });
});

describe('streaming HTTP deadlines', () => {
  it.each(['serialization', 'already-aborted'] as const)('does not allocate a lingering deadline or start transport after %s', async state => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async () => new Response('{}'));
    const controller = new AbortController();
    const body: Record<string, unknown> = {};
    if (state === 'serialization') body.circular = body;
    else controller.abort();
    try {
      await expect(aiFetch({ baseUrl: endpoint, key: 'key', path: '/responses', body,
        signal: controller.signal, fetchImpl })).rejects.toBeTruthy();
      expect(fetchImpl).not.toHaveBeenCalled();
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['sse', 'binary'].flatMap(mode => ['eof', 'cancel'].map(end => ({ mode, end }))))('releases the wrapped source reader and deadline on %j', async ({ mode, end }) => {
    vi.useFakeTimers();
    const cancel = vi.fn();
    const source = new ReadableStream<Uint8Array>({ start(controller) {
      controller.enqueue(new TextEncoder().encode('payload'));
      if (end === 'eof') controller.close();
    }, cancel });
    try {
      const response = await aiFetch({ baseUrl: endpoint, key: 'key', path: '/files',
        ...(mode === 'sse' ? { stream: true } : { bodyTimeout: true }),
        fetchImpl: vi.fn(async () => new Response(source)),
      });
      if (end === 'eof') expect(await response.text()).toBe('payload');
      else {
        const reader = response.body!.getReader();
        await reader.read();
        await reader.cancel();
        reader.releaseLock();
        expect(cancel).toHaveBeenCalledOnce();
      }
      expect(source.locked).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally { vi.useRealTimers(); }
  });

  it.each(['timeout', 'abort'] as const)('protects binary body consumption after headers without an SSE Accept header: %s', async cause => {
    vi.useFakeTimers();
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const cancel = vi.fn();
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; }, cancel });
    const abort = new AbortController();
    const fetchImpl = vi.fn(async () => new Response(body));
    try {
      const response = await aiFetch({ baseUrl: endpoint, key: 'key', path: '/files', bodyTimeout: true,
        timeoutMs: 100, signal: abort.signal, fetchImpl });
      let failure: unknown;
      const reading = response.arrayBuffer().catch(error => { failure = error; });
      if (cause === 'abort') abort.abort();
      await vi.advanceTimersByTimeAsync(101);
      const observed = failure;
      if (!observed) controller.error(new Error('Fixture cleanup'));
      await reading;
      expect(observed).toMatchObject({ name: 'AbortError' });
      expect(cancel).toHaveBeenCalledOnce();
      expect(body.locked).toBe(false);
      expect((fetchImpl.mock.calls[0] as unknown as [string, RequestInit])[1].headers).not.toHaveProperty('Accept');
    } finally { vi.useRealTimers(); }
  });

  it('cancels and unlocks the response body when the provider sends DONE', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: [DONE]\n\n')); }, cancel,
    }));
    expect(await parseSse(response).next()).toMatchObject({ done: true });
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('cancels and unlocks the body when the consumer stops early', async () => {
    const cancel = vi.fn();
    const response = new Response(new ReadableStream<Uint8Array>({
      start(controller) { controller.enqueue(new TextEncoder().encode('data: {"delta":"text"}\n\n')); }, cancel,
    }));
    const stream = parseSse(response);
    expect((await stream.next()).done).toBe(false);
    await stream.return(undefined);
    expect(cancel).toHaveBeenCalledOnce();
    expect(response.body?.locked).toBe(false);
  });

  it('aborts a request that never returns headers', async () => {
    vi.useFakeTimers();
    const fetchImpl = vi.fn(async (_url: string, init?: RequestInit) => new Promise<Response>((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => reject(init.signal?.reason), { once: true });
    })) as unknown as typeof fetch;
    const request = aiFetch({
      baseUrl: endpoint, key: 'key', path: '/responses', stream: true,
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
      baseUrl: endpoint, key: 'key', path: '/responses', stream: true,
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
