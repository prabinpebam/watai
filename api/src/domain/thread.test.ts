import { describe, it, expect } from 'vitest';
import { parseCreateThread, parseUpdateThread } from './thread';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('parseCreateThread', () => {
  it('applies defaults', () => {
    expect(parseCreateThread({})).toEqual({ title: 'New chat', temporary: false });
  });

  it('accepts valid input', () => {
    expect(parseCreateThread({ title: 'Trip', temporary: true })).toEqual({
      title: 'Trip',
      temporary: true,
    });
  });

  it('rejects empty and oversized titles', () => {
    expect(code(() => parseCreateThread({ title: '' }))).toBe('validation');
    expect(code(() => parseCreateThread({ title: 'x'.repeat(201) }))).toBe('validation');
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseCreateThread({ title: 'ok', bogus: 1 }))).toBe('validation');
  });
});

describe('parseUpdateThread', () => {
  it('accepts a partial patch', () => {
    expect(parseUpdateThread({ pinned: true })).toEqual({ pinned: true });
  });

  it('requires at least one field', () => {
    expect(code(() => parseUpdateThread({}))).toBe('validation');
  });

  it('rejects wrong types and unknown fields', () => {
    expect(code(() => parseUpdateThread({ archived: 'yes' }))).toBe('validation');
    expect(code(() => parseUpdateThread({ nope: true }))).toBe('validation');
  });
});
