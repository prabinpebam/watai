import { describe, it, expect } from 'vitest';
import { speakableText } from './speakable';

describe('speakableText', () => {
  it('returns empty for empty/undefined input', () => {
    expect(speakableText('')).toBe('');
    expect(speakableText(undefined as unknown as string)).toBe('');
  });

  it('strips bold and italic emphasis to their text', () => {
    expect(speakableText('This is **bold** and *italic*.')).toBe('This is bold and italic.');
  });

  it('unwraps inline code', () => {
    expect(speakableText('Run `npm test` now.')).toBe('Run npm test now.');
  });

  it('keeps link text and drops the URL', () => {
    expect(speakableText('See [the docs](https://x.com) here.')).toBe('See the docs here.');
  });

  it('drops images (they land in the thread, not the speech)', () => {
    expect(speakableText('![diagram](d.png) The result.')).toBe('The result.');
  });

  it('drops fenced code blocks', () => {
    expect(speakableText('Here:\n```js\nconst x = 1;\n```\nDone.')).toBe('Here: Done.');
  });

  it('strips heading markers', () => {
    expect(speakableText('# Title\nSome body.')).toBe('Title Some body.');
  });

  it('linearizes list markers', () => {
    expect(speakableText('- First\n- Second')).toBe('First Second');
    expect(speakableText('1. One\n2. Two')).toBe('One Two');
  });

  it('drops table rows', () => {
    expect(speakableText('Result:\n| a | b |\n| --- | --- |\nOk.')).toBe('Result: Ok.');
  });

  it('collapses whitespace and trims', () => {
    expect(speakableText('  a   \n\n  b  ')).toBe('a b');
  });
});
