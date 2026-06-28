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
});