import { describe, expect, it } from 'vitest';
import { parseMemoryExtractionOutput } from '../domain/memoryExtraction';
import { normalizeMemoryExtractionJson } from './memoryExtractor';

describe('normalizeMemoryExtractionJson', () => {
  it('normalizes common LLM output variants into strict extraction operations', () => {
    const normalized = normalizeMemoryExtractionJson({
      memories: [
        {
          operation: 'ADD',
          kind: 'project context',
          text: 'User has a dog named Chopper inspired by One Piece.',
          confidence: 0.88,
          salience: 0.72,
          source_message_ids: 'u1',
        },
      ],
    });

    expect(parseMemoryExtractionOutput(normalized).operations[0]).toMatchObject({
      op: 'add',
      kind: 'project_context',
      sourceMessageIds: ['u1'],
    });
  });

  it('falls back to the latest user source id and default add scores when omitted', () => {
    const normalized = normalizeMemoryExtractionJson(
      {
        operations: [
          {
            operation: 'add',
            kind: 'fact',
            text: 'User has a dog named Chopper inspired by One Piece.',
          },
        ],
      },
      ['u1'],
    );

    expect(parseMemoryExtractionOutput(normalized).operations[0]).toMatchObject({
      op: 'add',
      kind: 'fact',
      confidence: 0.75,
      salience: 0.6,
      sourceMessageIds: ['u1'],
    });
  });
});