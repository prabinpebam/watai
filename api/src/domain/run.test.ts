import { describe, it, expect } from 'vitest';
import { isTerminal, isActive, canTransition, parseRunInput, mergeAgentUsage, observeAgentUsage, type AgentUsageSnapshot } from './run';
import { AppError } from './errors';

describe('bounded agent usage evidence', () => {
  const tokens = { inputTokens: 10, outputTokens: 4, totalTokens: 14 };

  it('deduplicates identical response IDs and makes conflicting reports sticky unknown', () => {
    const observed = observeAgentUsage('response', 'model', tokens);
    const initial = mergeAgentUsage(undefined, observed);
    expect(mergeAgentUsage(initial, observed)).toEqual(initial);
    const conflict = mergeAgentUsage(initial, observeAgentUsage('response', 'model', { inputTokens: 11, outputTokens: 4, totalTokens: 15 }));
    expect(conflict.observations).toEqual([{ responseId: 'response', model: 'model', status: 'unknown', tokens: null }]);
    expect(mergeAgentUsage(conflict, observed)).toEqual(conflict);
  });

  it('keeps missing IDs or counts unknown rather than manufacturing a receipt', () => {
    expect(observeAgentUsage(undefined, 'model', tokens)).toEqual({ responseId: null, model: 'model', status: 'unknown', tokens: null });
    expect(observeAgentUsage('response', 'model', undefined)).toMatchObject({ status: 'unknown', tokens: null });
  });

  it('bounds evidence and marks truncation instead of silently reporting completeness', () => {
    let snapshot: AgentUsageSnapshot | undefined;
    for (let index = 0; index < 33; index += 1) snapshot = mergeAgentUsage(snapshot, observeAgentUsage(`response-${index}`, 'model', tokens));
    expect(snapshot).toMatchObject({ scope: 'agent-responses-only', truncated: true });
    expect(snapshot!.observations).toHaveLength(32);
  });

  it('excludes non-identifier metadata and extra provider fields', () => {
    const observation = observeAgentUsage('https://private/token', 'private user content', { ...tokens, prompt: 'private prompt' });
    expect(observation).toEqual({ responseId: null, model: null, status: 'unknown', tokens: null });
  });
});

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
    expect(isActive('cancel_requested')).toBe(true);
    expect(isActive('complete')).toBe(false);
    expect(isTerminal('complete')).toBe(true);
    expect(isTerminal('error')).toBe(true);
    expect(isTerminal('canceled')).toBe(true);
    expect(isTerminal('queued')).toBe(false);
  });

  it('allows only valid transitions', () => {
    expect(canTransition('queued', 'running')).toBe(true);
    expect(canTransition('running', 'complete')).toBe(true);
    expect(canTransition('running', 'cancel_requested')).toBe(true);
    expect(canTransition('cancel_requested', 'canceled')).toBe(true);
    expect(canTransition('queued', 'complete')).toBe(false); // must go through running
    expect(canTransition('complete', 'running')).toBe(false); // terminal
    expect(canTransition('canceled', 'running')).toBe(false);
    expect(canTransition('error', 'complete')).toBe(false);
  });
});

describe('parseRunInput', () => {
  it('accepts one canonical immutable chronological pair', () => {
    const messageOrder = { user: '2026-09-11T12:00:00.000Z', assistant: '2026-09-11T12:00:00.001Z' };
    expect(parseRunInput({ text: 'x', messageOrder })).toMatchObject({ messageOrder });
  });

  it.each([
    { user: 'not-a-time', assistant: '2026-09-11T12:00:00.001Z' },
    { user: '2026-09-11T12:00:00.000Z', assistant: '2026-09-11T12:00:00.000Z' },
    { user: '2026-09-11T12:00:00.002Z', assistant: '2026-09-11T12:00:00.001Z' },
    { user: '2026-09-11T12:00:00Z', assistant: '2026-09-11T12:00:00.001Z' },
    { user: '2026-09-11T12:00:00.000+00:00', assistant: '2026-09-11T12:00:00.001Z' },
  ])('rejects ambiguous or inverted logical order: %j', messageOrder => {
    expect(() => parseRunInput({ text: 'x', messageOrder })).toThrow();
  });

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
