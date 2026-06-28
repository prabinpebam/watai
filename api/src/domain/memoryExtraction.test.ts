import { describe, expect, it } from 'vitest';
import { AppError } from './errors';
import { parseMemoryExtractionOutput, parseMemoryJobMessage } from './memoryExtraction';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('memory extraction domain', () => {
  it('accepts strict add/ignore operations and rejects unknown fields', () => {
    expect(
      parseMemoryExtractionOutput({
        operations: [
          {
            op: 'add',
            kind: 'preference',
            text: 'User prefers concise implementation plans.',
            confidence: 0.9,
            salience: 0.8,
            sourceMessageIds: ['m1'],
            reason: 'The user stated a stable preference.',
          },
          { op: 'ignore', reason: 'No durable memory.' },
        ],
      }).operations,
    ).toHaveLength(2);
    expect(code(() => parseMemoryExtractionOutput({ operations: [{ op: 'ignore', reason: 'x', extra: true }] }))).toBe('validation');
  });

  it('rejects unsafe or unsupported extraction output', () => {
    expect(
      code(() =>
        parseMemoryExtractionOutput({
          operations: [{ op: 'add', kind: 'thread_summary', text: 'x', confidence: 0.9, salience: 0.5, sourceMessageIds: ['m1'], reason: 'x' }],
        }),
      ),
    ).toBe('validation');
    expect(
      code(() =>
        parseMemoryExtractionOutput({
          operations: [{ op: 'add', kind: 'preference', text: 'my token is sk-1234567890abcdef', confidence: 0.9, salience: 0.5, sourceMessageIds: ['m1'], reason: 'x' }],
        }),
      ),
    ).toBe('validation');
  });

  it('validates queue messages by id only', () => {
    expect(parseMemoryJobMessage({ jobId: 'job1', userId: 'user1', threadId: 'thr1', kind: 'turn' })).toEqual({
      jobId: 'job1',
      userId: 'user1',
      threadId: 'thr1',
      kind: 'turn',
    });
    expect(code(() => parseMemoryJobMessage({ jobId: 'job1', userId: 'user1', threadId: 'thr1', kind: 'turn', content: 'nope' }))).toBe('validation');
  });
});