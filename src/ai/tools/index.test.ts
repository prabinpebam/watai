import { describe, it, expect } from 'vitest';
import { assembleTools, isDestructiveTool, CLIENT_TOOLS, executeTool } from './index';
import type { CapabilityMatrix, Settings } from '../../lib/types';

const caps = (over: Partial<CapabilityMatrix> = {}): CapabilityMatrix => ({
  chat: true,
  chatStreaming: true,
  vision: true,
  transcribe: true,
  transcribeStreaming: false,
  image: true,
  imageEdit: true,
  tts: true,
  responses: true,
  functions: true,
  codeInterpreter: false,
  webSearch: false,
  fileSearch: false,
  ...over,
});

const settings = (over: Partial<NonNullable<Settings['tools']>> = {}): Settings['tools'] => ({
  agenticMode: true,
  webSearch: true,
  codeInterpreter: true,
  fileSearch: true,
  imageAgent: true,
  ...over,
});

const ctx = { webSearchConsent: true, vectorStoreIds: ['vs1'] };

describe('assembleTools', () => {
  it('always offers the client function tools', () => {
    const names = assembleTools(caps(), settings(), ctx).map((t) => t.name);
    expect(names).toEqual(
      expect.arrayContaining([
        'generate_image',
        'search_history',
        'get_thread_summary',
        'create_thread',
        'add_memory',
        'delete_thread',
        'update_setting',
      ]),
    );
  });

  it('omits the image tool when imageAgent is off', () => {
    const names = assembleTools(caps(), settings({ imageAgent: false }), ctx).map((t) => t.name);
    expect(names).not.toContain('generate_image');
  });

  it('adds code interpreter only when capable AND enabled', () => {
    expect(assembleTools(caps(), settings(), ctx).some((t) => t.type === 'code_interpreter')).toBe(false);
    expect(
      assembleTools(caps({ codeInterpreter: true }), settings(), ctx).some((t) => t.type === 'code_interpreter'),
    ).toBe(true);
    expect(
      assembleTools(caps({ codeInterpreter: true }), settings({ codeInterpreter: false }), ctx).some(
        (t) => t.type === 'code_interpreter',
      ),
    ).toBe(false);
  });

  it('adds web search only when capable AND enabled AND consented', () => {
    const c = caps({ webSearch: true });
    expect(assembleTools(c, settings(), ctx).some((t) => t.type === 'web_search')).toBe(true);
    expect(
      assembleTools(c, settings(), { ...ctx, webSearchConsent: false }).some((t) => t.type === 'web_search'),
    ).toBe(false);
  });

  it('adds file search only when capable AND enabled AND a vector store exists', () => {
    const c = caps({ fileSearch: true });
    expect(assembleTools(c, settings(), ctx).some((t) => t.type === 'file_search')).toBe(true);
    expect(
      assembleTools(c, settings(), { ...ctx, vectorStoreIds: [] }).some((t) => t.type === 'file_search'),
    ).toBe(false);
  });
});

describe('client tool registry', () => {
  it('registers exactly the planned tools', () => {
    expect(Object.keys(CLIENT_TOOLS).sort()).toEqual([
      'add_memory',
      'create_thread',
      'delete_thread',
      'generate_image',
      'get_thread_summary',
      'search_history',
      'update_setting',
    ]);
  });

  it('marks delete_thread and update_setting destructive, others not', () => {
    expect(isDestructiveTool('delete_thread')).toBe(true);
    expect(isDestructiveTool('update_setting')).toBe(true);
    expect(isDestructiveTool('search_history')).toBe(false);
    expect(isDestructiveTool('generate_image')).toBe(false);
  });

  it('returns a friendly message for an unknown tool name', async () => {
    const res = await executeTool('does_not_exist', {});
    expect(res.output).toMatch(/unknown tool/i);
  });
});
