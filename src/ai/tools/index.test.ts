import { describe, it, expect } from 'vitest';
import { assembleTools, isDestructiveTool, CLIENT_TOOLS, executeTool, resolveVectorStores } from './index';
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

const ctx = { tavilyConfigured: true, vectorStoreIds: ['vs1'] };

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

  it('gives the code interpreter tool a container (required by the Responses API)', () => {
    const ci = assembleTools(caps({ codeInterpreter: true }), settings(), ctx).find(
      (t) => t.type === 'code_interpreter',
    );
    expect(ci?.container).toEqual({ type: 'auto' });
  });

  it('offers the Tavily web_search tool whenever a key is configured (the key is the switch)', () => {
    // Key present -> offered, regardless of any legacy webSearch flag.
    expect(assembleTools(caps(), settings(), ctx).some((t) => t.name === 'web_search')).toBe(true);
    expect(
      assembleTools(caps(), settings({ webSearch: false }), ctx).some((t) => t.name === 'web_search'),
    ).toBe(true);
    // No key -> not offered.
    expect(
      assembleTools(caps(), settings(), { ...ctx, tavilyConfigured: false }).some((t) => t.name === 'web_search'),
    ).toBe(false);
  });

  it('adds file search when capable AND a vector store is present (toggle-independent)', () => {
    const c = caps({ fileSearch: true });
    // A store is present (e.g. a thread upload) -> offered even if the KB toggle is off.
    expect(assembleTools(c, settings(), ctx).some((t) => t.type === 'file_search')).toBe(true);
    expect(
      assembleTools(c, settings({ fileSearch: false }), ctx).some((t) => t.type === 'file_search'),
    ).toBe(true);
    // No store -> not offered.
    expect(
      assembleTools(c, settings(), { ...ctx, vectorStoreIds: [] }).some((t) => t.type === 'file_search'),
    ).toBe(false);
    // Endpoint not capable -> not offered.
    expect(assembleTools(caps(), settings(), ctx).some((t) => t.type === 'file_search')).toBe(false);
  });

  it('passes the vector store ids through to the file_search tool', () => {
    const c = caps({ fileSearch: true });
    const fs = assembleTools(c, settings(), { ...ctx, vectorStoreIds: ['a', 'b'] }).find(
      (t) => t.type === 'file_search',
    );
    expect(fs?.vector_store_ids).toEqual(['a', 'b']);
  });
});

describe('resolveVectorStores', () => {
  it('includes the KB store only when the File search toggle is on', () => {
    expect(resolveVectorStores({ fileSearchEnabled: true, kbStoreId: 'kb' })).toEqual(['kb']);
    expect(resolveVectorStores({ fileSearchEnabled: false, kbStoreId: 'kb' })).toEqual([]);
  });

  it('always includes a thread store (uploading a file opts the thread in)', () => {
    expect(resolveVectorStores({ fileSearchEnabled: false, threadStoreId: 'thr' })).toEqual(['thr']);
  });

  it('combines KB + thread stores without duplicates', () => {
    expect(
      resolveVectorStores({ fileSearchEnabled: true, kbStoreId: 'kb', threadStoreId: 'thr' }),
    ).toEqual(['kb', 'thr']);
    expect(
      resolveVectorStores({ fileSearchEnabled: true, kbStoreId: 'same', threadStoreId: 'same' }),
    ).toEqual(['same']);
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
      'web_search',
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
