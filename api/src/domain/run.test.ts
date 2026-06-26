import { describe, it, expect } from 'vitest';
import { isTerminal, isActive, canTransition, parseRunInput } from './run';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('run state machine', () => {
  it('classifies active vs terminal', () => {
    expect(isActive('queued')).toBe(true);
    expect(isActive('running')).toBe(true);
    expect(isActive('complete')).toBe(false);
    expect(isTerminal('complete')).toBe(true);
    expect(isTerminal('error')).toBe(true);
    expect(isTerminal('canceled')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
  });

  it('allows only valid transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'complete')).toBe(true);
    expect(canTransition('running', 'canceled')).toBe(true);
    expect(canTransition('queued', 'canceled')).toBe(true);
    expect(canTransition('queued', 'complete')).toBe(false); // must go through running
    expect(canTransition('complete', 'running')).toBe(false); // terminal
    expect(canTransition('canceled', 'running')).toBe(false);
    expect(canTransition('error', 'complete')).toBe(false);
  });
});

describe('parseRunInput', () => {
  const att = { id: 'a', kind: 'image', blobPath: 'u/t/a.png', mime: 'image/png', bytes: 1 };

  it('accepts a text prompt', () => {
    expect(parseRunInput({ text: 'hello' }).text).toBe('hello');
  });

  it('accepts attachments with no text', () => {
    expect(parseRunInput({ attachments: [att] }).attachments).toHaveLength(1);
  });

  it('accepts tool + destructive allowlists and a client message id', () => {
    const r = parseRunInput({
      text: 'x',
      tools: ['web_search'],
      allowDestructive: ['delete_thread'],
      clientMessageId: 'm1',
    });
    expect(r.tools).toEqual(['web_search']);
    expect(r.allowDestructive).toEqual(['delete_thread']);
    expect(r.clientMessageId).toBe('m1');
  });

  it('rejects an empty prompt (no text, no attachments)', () => {
    expect(code(() => parseRunInput({}))).toBe('validation');
    expect(code(() => parseRunInput({ text: '   ' }))).toBe('validation');
  });

  it('rejects unknown fields (strict)', () => {
    expect(code(() => parseRunInput({ text: 'x', evil: 1 }))).toBe('validation');
  });
});
