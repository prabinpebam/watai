import { describe, it, expect } from 'vitest';
import { createReplySpeaker } from './replySpeaker';

/** Drive a speaker with successive full-text snapshots (as the run overlay would) and collect the
 *  spoken clips it enqueues. */
function run(snapshots: string[], finish = true): string[] {
  const spoken: string[] = [];
  const speaker = createReplySpeaker((t) => spoken.push(t));
  for (const s of snapshots) speaker.push(s);
  if (finish) speaker.flush();
  return spoken;
}

describe('createReplySpeaker', () => {
  it('speaks only completed sentences as the reply streams, holding the partial tail', () => {
    const spoken: string[] = [];
    const speaker = createReplySpeaker((t) => spoken.push(t));
    speaker.push('Hello there.');
    expect(spoken).toEqual(['Hello there.']);
    speaker.push('Hello there. How are'); // partial second sentence — nothing new yet
    expect(spoken).toEqual(['Hello there.']);
    speaker.push('Hello there. How are you?');
    expect(spoken).toEqual(['Hello there.', 'How are you?']);
  });

  it('flushes the trailing unterminated sentence when the reply ends', () => {
    expect(run(['Hi there. Final words without a period'])).toEqual([
      'Hi there.',
      'Final words without a period',
    ]);
  });

  it('does not split inside a streaming decimal or abbreviation', () => {
    // "3." arriving mid-stream must not split (could become "3.14"); "e.g." is an abbreviation.
    const spoken: string[] = [];
    const speaker = createReplySpeaker((t) => spoken.push(t));
    speaker.push('Pi is about 3.');
    expect(spoken).toEqual([]);
    speaker.push('Pi is about 3.14, e.g. the ratio. Done.');
    expect(spoken).toEqual(['Pi is about 3.14, e.g. the ratio.', 'Done.']);
  });

  it('strips markdown from spoken sentences (links, bold, inline code)', () => {
    const out = run(['See **the docs** at [our site](https://x.io) using `npm run build` now.']);
    expect(out).toHaveLength(1);
    expect(out[0]).toBe('See the docs at our site using npm run build now.');
  });

  it('drops fenced code blocks entirely so the synthesizer never reads code', () => {
    const md = 'Here is code:\n\n```js\nconst x = 1;\n```\n\nThat was the example.';
    const out = run([md]);
    const joined = out.join(' ');
    expect(joined).not.toContain('const x');
    expect(joined).toContain('That was the example.');
  });

  it('skips empty/whitespace-only sentences (e.g. a lone code block) without enqueuing blanks', () => {
    const out = run(['```\ncode only\n```']);
    expect(out).toEqual([]);
  });
});
