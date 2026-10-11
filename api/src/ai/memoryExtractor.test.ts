import { describe, expect, it } from 'vitest';
import { parseMemoryExtractionOutput } from '../domain/memoryExtraction';
import { extractMemories, normalizeMemoryExtractionJson, resilientParseExtraction } from './memoryExtractor';

describe('resilientParseExtraction', () => {
  it('keeps an add operation even when its routed target is malformed', () => {
    const out = resilientParseExtraction({
      operations: [
        {
          op: 'add',
          kind: 'fact',
          text: 'User has a daughter named Laija who is 9 years old.',
          confidence: 0.94,
          salience: 0.86,
          sourceMessageIds: ['u1'],
          reason: 'Stable family fact.',
          // Invalid: profilePath is not in the enum and relationship lacks an object/value.
          target: { layer: 'long_term_profile', profilePath: 'family.children', relationship: { predicate: 'HAS_FAMILY_MEMBER' } },
        },
      ],
    });

    expect(out.operations).toHaveLength(1);
    expect(out.operations[0]).toMatchObject({ op: 'add', text: 'User has a daughter named Laija who is 9 years old.' });
    expect((out.operations[0] as { target?: unknown }).target).toBeUndefined();
  });

  it('keeps a valid routed target intact', () => {
    const out = resilientParseExtraction({
      operations: [
        {
          op: 'add',
          kind: 'fact',
          text: 'User has a daughter named Laija who is 9 years old.',
          confidence: 0.94,
          salience: 0.86,
          sourceMessageIds: ['u1'],
          reason: 'Stable family fact.',
          target: { layer: 'long_term_profile', profilePath: 'user.family.children', entity: { type: 'family_member', name: 'Laija' } },
        },
      ],
    });

    expect(out.operations[0]).toMatchObject({ target: { profilePath: 'user.family.children' } });
  });

  it('drops fully invalid operations and falls back to ignore', () => {
    const out = resilientParseExtraction({ operations: [{ op: 'add', kind: 'fact' }, { nonsense: true }] });
    expect(out.operations).toEqual([{ op: 'ignore', reason: 'No valid memory operations were produced.' }]);
  });
});

describe('extractMemories model selection', () => {
  it('uses the server-decided memory model instead of the user chat model', async () => {
    let sentBody: { model?: string } = {};
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"operations":[{"op":"ignore","reason":"x"}]}' } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await extractMemories(
      { baseUrl: 'https://r.services.ai.azure.com/openai/v1', key: 'k', models: { chat: 'gpt-5.4' } },
      { mode: 'turn', now: '2026-01-01T00:00:00Z', threadId: 't1', messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00Z' }], existingMemories: [] },
      { model: 'gpt-5.4-mini', fetchImpl },
    );

    expect(sentBody.model).toBe('gpt-5.4-mini');
  });

  it('falls back to the user chat model when no server memory model is set', async () => {
    let sentBody: { model?: string } = {};
    const fetchImpl = (async (_url: string, init: { body: string }) => {
      sentBody = JSON.parse(init.body);
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: '{"operations":[{"op":"ignore","reason":"x"}]}' } }] }),
      } as unknown as Response;
    }) as unknown as typeof fetch;

    await extractMemories(
      { baseUrl: 'https://r.services.ai.azure.com/openai/v1', key: 'k', models: { chat: 'gpt-5.4' } },
      { mode: 'turn', now: '2026-01-01T00:00:00Z', threadId: 't1', messages: [{ id: 'u1', role: 'user', content: 'hi', createdAt: '2026-01-01T00:00:00Z' }], existingMemories: [] },
      { fetchImpl },
    );

    expect(sentBody.model).toBe('gpt-5.4');
  });
});

describe('normalizeMemoryExtractionJson', () => {
  it.each([undefined, 'unknown', 'sensitive', 'normal'])('does not invent or relax the sensitivity classification: %s', sensitivity => {
    const result = resilientParseExtraction(normalizeMemoryExtractionJson({ operations: [{
      op: 'add', kind: 'fact', text: 'Explicit source statement.', confidence: 0.9,
      salience: 0.8, sourceMessageIds: ['u1'], ...(sensitivity === undefined ? {} : { sensitivity }),
    }] }));
    expect(result.operations[0]).toMatchObject({ op: 'add' });
    if (sensitivity === undefined) expect(result.operations[0]).not.toHaveProperty('sensitivity');
    else expect(result.operations[0]).toHaveProperty('sensitivity', sensitivity);
  });

  it.each(['confidence', 'salience'])('does not invent missing %s to make an add acceptable', missing => {
    const incomplete: Record<string, unknown> = { op: 'add', kind: 'fact', text: 'Incomplete proposal', confidence: 0.95, salience: 0.9, sourceMessageIds: ['u1'] };
    delete incomplete[missing];
    const normalized = normalizeMemoryExtractionJson({ operations: [
      incomplete,
      { op: 'add', kind: 'preference', text: 'Explicitly scored proposal', confidence: 0.9, salience: 0.8, sourceMessageIds: ['u1'] },
    ] });
    const result = resilientParseExtraction(normalized);
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ text: 'Explicitly scored proposal', confidence: 0.9, salience: 0.8 });
  });

  it('normalizes common LLM output variants into strict extraction operations', () => {
    const normalized = normalizeMemoryExtractionJson({
      memories: [
        {
          operation: 'ADD',
          kind: 'communication style',
          text: 'User has a dog named Chopper inspired by One Piece.',
          confidence: 0.88,
          salience: 0.72,
          source_message_ids: 'u1',
        },
      ],
    });

    expect(parseMemoryExtractionOutput(normalized).operations[0]).toMatchObject({
      op: 'add',
      kind: 'work_style',
      sourceMessageIds: ['u1'],
    });
  });

  it('does not invent a source ID when the model omitted its evidence', () => {
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

    expect(() => parseMemoryExtractionOutput(normalized)).toThrow();
    expect(resilientParseExtraction(normalized).operations[0].op).toBe('ignore');
  });

  it('drops an unreferenced operation without losing its explicitly sourced sibling', () => {
    const result = resilientParseExtraction(normalizeMemoryExtractionJson({ operations: [
      { op: 'add', kind: 'fact', text: 'Unreferenced statement', confidence: 0.9, salience: 0.9 },
      { op: 'add', kind: 'preference', text: 'Explicit user preference', confidence: 0.9, salience: 0.9, sourceMessageIds: ['u1'] },
    ] }, ['u1']));
    expect(result.operations).toHaveLength(1);
    expect(result.operations[0]).toMatchObject({ text: 'Explicit user preference', sourceMessageIds: ['u1'] });
  });

  it('normalizes common operation and kind aliases from top-level arrays', () => {
    const normalized = normalizeMemoryExtractionJson([
      {
        operation: 'update',
        memory_id: 'mem_1',
        kind: 'personal fact',
        text: 'User has a dog named Chopper inspired by One Piece.',
        source_message_ids: ['u1'],
        reason: 'Useful user profile fact.',
      },
    ]);

    expect(parseMemoryExtractionOutput(normalized).operations[0]).toMatchObject({
      op: 'merge',
      memoryId: 'mem_1',
      sourceMessageIds: ['u1'],
    });
  });

  it('lifts fields nested under a memory wrapper (type/source aliases) into a flat add', () => {
    const normalized = normalizeMemoryExtractionJson({
      operations: [
        { op: 'add', memory: { type: 'fact', text: "User's favorite color is teal.", source: 'm1', confidence: 0.75, salience: 0.6 } },
      ],
    });

    expect(parseMemoryExtractionOutput(normalized).operations[0]).toMatchObject({
      op: 'add',
      kind: 'fact',
      text: "User's favorite color is teal.",
      sourceMessageIds: ['m1'],
      confidence: 0.75,
      salience: 0.6,
    });
  });
});