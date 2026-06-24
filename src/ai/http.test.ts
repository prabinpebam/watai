import { describe, it, expect } from 'vitest';
import { parseSse, v1Url, transcriptionUrl } from './http';
import { normalizeBaseUrl } from '../data/secureStore';

function sseResponse(chunks: string[]): Response {
  const enc = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const c of chunks) controller.enqueue(enc.encode(c));
      controller.close();
    },
  });
  return new Response(stream);
}

async function collect(gen: AsyncGenerator<string>): Promise<string[]> {
  const out: string[] = [];
  for await (const v of gen) out.push(v);
  return out;
}

describe('parseSse', () => {
  it('yields data payloads and stops at [DONE]', async () => {
    const res = sseResponse([
      'data: {"a":1}\n',
      'data: {"b":2}\n',
      'data: [DONE]\n',
      'data: {"never":true}\n',
    ]);
    expect(await collect(parseSse(res))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('reassembles payloads split across chunks', async () => {
    const res = sseResponse(['data: {"a":', '1}\n', 'data: {"b":2}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"a":1}', '{"b":2}']);
  });

  it('ignores comments and non-data lines', async () => {
    const res = sseResponse([': keep-alive\n', 'event: message\n', 'data: {"x":1}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"x":1}']);
  });

  it('skips empty data lines', async () => {
    const res = sseResponse(['data: \n', 'data: {"x":1}\n']);
    expect(await collect(parseSse(res))).toEqual(['{"x":1}']);
  });

  it('yields nothing when the signal is already aborted', async () => {
    const ctrl = new AbortController();
    ctrl.abort();
    const res = sseResponse(['data: {"a":1}\n']);
    expect(await collect(parseSse(res, ctrl.signal))).toEqual([]);
  });
});

describe('endpoint URL construction', () => {
  it('v1Url keeps the services.ai host and adds /openai/v1', () => {
    expect(v1Url('https://r.services.ai.azure.com/openai/v1', '/chat/completions')).toBe(
      'https://r.services.ai.azure.com/openai/v1/chat/completions',
    );
  });

  it('v1Url swaps a cognitiveservices host to services.ai', () => {
    expect(v1Url('https://r.cognitiveservices.azure.com', '/images/generations')).toBe(
      'https://r.services.ai.azure.com/openai/v1/images/generations',
    );
  });

  it('v1Url leaves non-Foundry hosts as entered', () => {
    expect(v1Url('https://r.openai.azure.com', '/chat/completions')).toBe(
      'https://r.openai.azure.com/chat/completions',
    );
  });

  it('transcriptionUrl uses the classic cognitiveservices deployment path', () => {
    expect(transcriptionUrl('https://r.services.ai.azure.com/openai/v1', 'gpt-4o-transcribe')).toBe(
      'https://r.cognitiveservices.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview',
    );
  });

  it('transcriptionUrl stays on cognitiveservices when already there', () => {
    expect(transcriptionUrl('https://r.cognitiveservices.azure.com', 'gpt-4o-transcribe')).toBe(
      'https://r.cognitiveservices.azure.com/openai/deployments/gpt-4o-transcribe/audio/transcriptions?api-version=2025-03-01-preview',
    );
  });

  it('normalizeBaseUrl expands a bare resource name to the v1 base', () => {
    expect(normalizeBaseUrl('ai-project-deployments-resource')).toBe(
      'https://ai-project-deployments-resource.services.ai.azure.com/openai/v1',
    );
  });

  it('normalizeBaseUrl adds /openai/v1 to a services.ai URL and leaves cognitiveservices alone', () => {
    expect(normalizeBaseUrl('https://r.services.ai.azure.com')).toBe(
      'https://r.services.ai.azure.com/openai/v1',
    );
    expect(normalizeBaseUrl('https://r.cognitiveservices.azure.com')).toBe(
      'https://r.cognitiveservices.azure.com',
    );
  });
});
