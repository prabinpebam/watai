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

  it('accepts an optional client-supplied id', () => {
    expect(parseCreateThread({ id: 'thr_abc', title: 'Trip' })).toEqual({
      id: 'thr_abc',
      title: 'Trip',
      temporary: false,
    });
  });

  it('rejects an empty or oversized id', () => {
    expect(code(() => parseCreateThread({ id: '', title: 'ok' }))).toBe('validation');
    expect(code(() => parseCreateThread({ id: 'x'.repeat(65), title: 'ok' }))).toBe('validation');
  });

  it('rejects empty and oversized titles', () => {
    expect(code(() => parseCreateThread({ title: '' }))).toBe('validation');
    expect(code(() => parseCreateThread({ title: 'x'.repeat(201) }))).toBe('validation');
  });

  it('accepts an optional vectorStoreId (thread-scoped file search)', () => {
    expect(parseCreateThread({ title: 'T', vectorStoreId: 'vs_abc' })).toMatchObject({
      vectorStoreId: 'vs_abc',
    });
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseCreateThread({ title: 'ok', bogus: 1 }))).toBe('validation');
  });
});

describe('parseUpdateThread', () => {
  it('accepts a partial patch', () => {
    expect(parseUpdateThread({ pinned: true })).toEqual({ pinned: true });
  });

  it('accepts a vectorStoreId patch (thread file search)', () => {
    expect(parseUpdateThread({ vectorStoreId: 'vs_abc' })).toEqual({ vectorStoreId: 'vs_abc' });
  });

  it('requires at least one field', () => {
    expect(code(() => parseUpdateThread({}))).toBe('validation');
  });

  it('rejects wrong types and unknown fields', () => {
    expect(code(() => parseUpdateThread({ archived: 'yes' }))).toBe('validation');
    expect(code(() => parseUpdateThread({ nope: true }))).toBe('validation');
  });
});
