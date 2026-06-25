import { describe, it, expect } from 'vitest';
import { parseAppendMessage } from './message';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('parseAppendMessage', () => {
  it('accepts a minimal user message', () => {
    expect(parseAppendMessage({ role: 'user', content: 'hi' })).toEqual({
      role: 'user',
      content: 'hi',
    });
  });

  it('accepts optional id, model, parentId', () => {
    const input = { id: 'msg_1', role: 'assistant', content: 'yo', model: 'gpt-5.4', parentId: 'msg_0' };
    expect(parseAppendMessage(input)).toEqual(input);
  });

  it('rejects empty content and bad roles', () => {
    expect(code(() => parseAppendMessage({ role: 'user', content: '' }))).toBe('validation');
    expect(code(() => parseAppendMessage({ role: 'robot', content: 'x' }))).toBe('validation');
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseAppendMessage({ role: 'user', content: 'x', evil: 1 }))).toBe(
      'validation',
    );
  });

  it('accepts an image-only assistant message (empty text + images)', () => {
    const img = {
      id: 'img_1',
      blobPath: 'user/thread/img_1.png',
      prompt: 'a cat',
      size: '1024x1024',
      outputFormat: 'png' as const,
      createdAt: '2026-01-01T00:00:00Z',
    };
    expect(parseAppendMessage({ role: 'assistant', content: '', images: [img] })).toMatchObject({
      role: 'assistant',
      content: '',
      images: [img],
    });
  });

  it('rejects a fully empty message (no text and no images)', () => {
    expect(code(() => parseAppendMessage({ role: 'assistant', content: '   ' }))).toBe('validation');
    expect(code(() => parseAppendMessage({ role: 'assistant', content: '', images: [] }))).toBe(
      'validation',
    );
  });

  it('rejects malformed image refs (strict, required blobPath)', () => {
    expect(
      code(() =>
        parseAppendMessage({
          role: 'assistant',
          content: 'x',
          images: [{ id: 'i', size: '1024x1024', outputFormat: 'png', createdAt: 'now' }],
        }),
      ),
    ).toBe('validation');
  });

  it('accepts bounded toolCalls and citations', () => {
    const input = {
      role: 'assistant',
      content: 'Here you go',
      toolCalls: [{ id: 'tc1', kind: 'web_search', status: 'done', summary: 'Searched the web' }],
      citations: [{ url: 'https://example.com/', title: 'Example', source: 'web' }],
    };
    expect(parseAppendMessage(input)).toMatchObject({
      toolCalls: [{ id: 'tc1', kind: 'web_search', status: 'done' }],
      citations: [{ url: 'https://example.com/', source: 'web' }],
    });
  });

  it('accepts a file citation without a url', () => {
    const input = {
      role: 'assistant',
      content: 'x',
      citations: [{ title: 'report.pdf', source: 'file', filename: 'report.pdf' }],
    };
    expect(parseAppendMessage(input)).toMatchObject({ citations: [{ source: 'file' }] });
  });

  it('accepts a code-interpreter tool call with awaiting-confirm status and a bounded resultPreview', () => {
    const input = {
      role: 'assistant',
      content: 'Done',
      toolCalls: [
        { id: 'ci1', kind: 'code_interpreter', status: 'done', summary: 'Ran code', resultPreview: 'print(2+2)\n4' },
        { id: 'fn1', kind: 'function', name: 'delete_thread', status: 'awaiting-confirm' },
      ],
    };
    expect(parseAppendMessage(input)).toMatchObject({
      toolCalls: [{ id: 'ci1', resultPreview: 'print(2+2)\n4' }, { id: 'fn1', status: 'awaiting-confirm' }],
    });
  });

  it('rejects an over-long resultPreview', () => {
    expect(
      code(() =>
        parseAppendMessage({
          role: 'assistant',
          content: 'x',
          toolCalls: [{ id: 't', kind: 'code_interpreter', status: 'done', resultPreview: 'a'.repeat(4001) }],
        }),
      ),
    ).toBe('validation');
  });

  it('rejects an invalid tool kind or status', () => {
    expect(
      code(() =>
        parseAppendMessage({ role: 'assistant', content: 'x', toolCalls: [{ id: 't', kind: 'evil', status: 'done' }] }),
      ),
    ).toBe('validation');
    expect(
      code(() =>
        parseAppendMessage({
          role: 'assistant',
          content: 'x',
          toolCalls: [{ id: 't', kind: 'function', status: 'pending' }],
        }),
      ),
    ).toBe('validation');
  });

  it('rejects too many toolCalls', () => {
    const many = Array.from({ length: 40 }, (_, i) => ({ id: `t${i}`, kind: 'function', status: 'done' }));
    expect(code(() => parseAppendMessage({ role: 'assistant', content: 'x', toolCalls: many }))).toBe(
      'validation',
    );
  });

  it('rejects an invalid citation url and unknown keys (strict)', () => {
    expect(
      code(() =>
        parseAppendMessage({ role: 'assistant', content: 'x', citations: [{ url: 'not-a-url', source: 'web' }] }),
      ),
    ).toBe('validation');
    expect(
      code(() =>
        parseAppendMessage({
          role: 'assistant',
          content: 'x',
          toolCalls: [{ id: 't', kind: 'function', status: 'done', evil: 1 }],
        }),
      ),
    ).toBe('validation');
  });
});
