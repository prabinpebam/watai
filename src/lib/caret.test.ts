import { describe, it, expect } from 'vitest';
import { insertAtCaret } from './caret';

describe('insertAtCaret', () => {
  it('inserts into an empty field', () => {
    expect(insertAtCaret('', 0, 0, 'hello world')).toEqual({ value: 'hello world', caret: 11 });
  });

  it('appends at the end with a separating space after non-space', () => {
    expect(insertAtCaret('Note:', 5, 5, 'buy milk')).toEqual({ value: 'Note: buy milk', caret: 14 });
  });

  it('inserts mid-text without clobbering either side, caret after the inserted text', () => {
    const r = insertAtCaret('I to the store', 2, 2, 'went');
    expect(r.value).toBe('I went to the store');
    expect(r.value.slice(0, r.caret)).toBe('I went'); // caret sits right after "went"
  });

  it('adds sensible spacing on both sides for a mid-word caret', () => {
    expect(insertAtCaret('abcdef', 3, 3, 'XYZ')).toEqual({ value: 'abc XYZ def', caret: 7 });
  });

  it('replaces the current selection', () => {
    expect(insertAtCaret('hello OLD world', 6, 9, 'new')).toEqual({ value: 'hello new world', caret: 9 });
  });

  it('does not double-space when a space already exists', () => {
    expect(insertAtCaret('hi ', 3, 3, 'there')).toEqual({ value: 'hi there', caret: 8 });
  });

  it('respects spacing already present on the inserted text', () => {
    expect(insertAtCaret('a', 1, 1, ' b')).toEqual({ value: 'a b', caret: 3 });
  });

  it('does not add a trailing space before punctuation', () => {
    expect(insertAtCaret('see .', 4, 4, 'this')).toEqual({ value: 'see this.', caret: 8 });
  });

  it('clamps out-of-range / inverted selection bounds', () => {
    expect(insertAtCaret('ab', 9, 1, 'x').value).toBe('ab x'); // start clamped to len, end ≥ start
  });
});
