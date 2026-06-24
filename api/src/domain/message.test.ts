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
});
