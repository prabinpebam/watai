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
});
