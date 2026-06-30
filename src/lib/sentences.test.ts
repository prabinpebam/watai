import { describe, it, expect } from 'vitest';
import { createSentenceStream } from './sentences';

describe('createSentenceStream', () => {
  it('emits a sentence once it is terminated', () => {
    const s = createSentenceStream();
    expect(s.push('Hello world.')).toEqual(['Hello world.']);
  });

  it('streams: buffers partials and emits each sentence exactly once (no dupes)', () => {
    const s = createSentenceStream();
    expect(s.push('Hello')).toEqual([]);
    expect(s.push('Hello world.')).toEqual(['Hello world.']);
    expect(s.push('Hello world. How are')).toEqual([]);
    expect(s.push('Hello world. How are you?')).toEqual(['How are you?']);
  });

  it('emits multiple completed sentences in one push, trimmed', () => {
    const s = createSentenceStream();
    expect(s.push('  One. Two!  Three? ')).toEqual(['One.', 'Two!', 'Three?']);
  });

  it('does not split on common abbreviations', () => {
    const s = createSentenceStream();
    expect(s.push('Use e.g. this approach, Dr. Smith said. Done.')).toEqual([
      'Use e.g. this approach, Dr. Smith said.',
      'Done.',
    ]);
  });

  it('does not split inside decimals', () => {
    const s = createSentenceStream();
    expect(s.push('Pi is 3.14 exactly. Yes.')).toEqual(['Pi is 3.14 exactly.', 'Yes.']);
  });

  it('keeps an unterminated trailing buffer until flush', () => {
    const s = createSentenceStream();
    expect(s.push('Done. And more text')).toEqual(['Done.']);
    expect(s.push('Done. And more text without an end')).toEqual([]);
    expect(s.flush()).toEqual(['And more text without an end']);
    expect(s.flush()).toEqual([]); // nothing left
  });

  it('does not split a numbered list marker', () => {
    const s = createSentenceStream();
    expect(s.push('1. First item ready. ')).toEqual(['1. First item ready.']);
  });
});
