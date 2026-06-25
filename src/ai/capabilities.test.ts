import { describe, it, expect, beforeEach, vi } from 'vitest';
import { detectCapabilities, endpointKind, resetAgenticCache } from './capabilities';
import type { ApiConfig, ProbeResultLike } from './capabilities';

const base = { chatDefaults: {}, keyEncrypted: false, models: { chat: 'c', transcribe: 't', image: 'i' } };
const aoai = { ...base, baseUrl: 'https://r.openai.azure.com' } as ApiConfig;
const project = {
  ...base,
  baseUrl: 'https://r.services.ai.azure.com',
  projectEndpoint: 'https://r.services.ai.azure.com/api/projects/p1',
} as ApiConfig;

const ok = (): Promise<ProbeResultLike> => Promise.resolve({ ok: true });
const no = (): Promise<ProbeResultLike> => Promise.resolve({ ok: false });

beforeEach(() => resetAgenticCache());

describe('endpointKind', () => {
  it('detects a foundry project endpoint by the /api/projects/ path', () => {
    expect(endpointKind(project)).toBe('foundry-project');
    expect(endpointKind(aoai)).toBe('aoai');
  });
});

describe('detectCapabilities', () => {
  it('marks everything off when /responses is unsupported', async () => {
    const m = await detectCapabilities(aoai, {
      responses: no,
      codeInterpreter: ok,
      webSearch: ok,
      fileSearch: ok,
    });
    expect(m).toMatchObject({
      responses: false,
      functions: false,
      codeInterpreter: false,
      webSearch: false,
      fileSearch: false,
    });
  });

  it('enables functions + code interpreter on a plain key but never the project-only tools', async () => {
    const webSearch = vi.fn(no);
    const fileSearch = vi.fn(no);
    const m = await detectCapabilities(aoai, { responses: ok, codeInterpreter: ok, webSearch, fileSearch });
    expect(m).toMatchObject({
      responses: true,
      functions: true,
      codeInterpreter: true,
      webSearch: false,
      fileSearch: false,
    });
    // Project-only probes are skipped on an aoai endpoint (no wasted 4xx spend).
    expect(webSearch).not.toHaveBeenCalled();
    expect(fileSearch).not.toHaveBeenCalled();
  });

  it('probes and enables web + file search on a foundry project', async () => {
    const m = await detectCapabilities(project, {
      responses: ok,
      codeInterpreter: ok,
      webSearch: ok,
      fileSearch: ok,
    });
    expect(m.webSearch).toBe(true);
    expect(m.fileSearch).toBe(true);
  });

  it('caches the matrix until reset', async () => {
    const responses = vi.fn(ok);
    const probes = { responses, codeInterpreter: ok, webSearch: no, fileSearch: no };
    await detectCapabilities(aoai, probes);
    await detectCapabilities(aoai, probes);
    expect(responses).toHaveBeenCalledTimes(1);
    resetAgenticCache();
    await detectCapabilities(aoai, probes);
    expect(responses).toHaveBeenCalledTimes(2);
  });
});
