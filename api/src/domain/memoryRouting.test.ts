import { describe, expect, it } from 'vitest';
import { parseMemoryRouteTarget, parseMemoryWritePlan } from './memoryRouting';

describe('memory routing schema', () => {
  it('accepts a long-term family child route with graph relationship attributes', () => {
    const target = parseMemoryRouteTarget({
      layer: 'long_term_profile',
      profilePath: 'user.family.children',
      entity: { type: 'family_member', name: 'Laija' },
      relationship: {
        predicate: 'HAS_FAMILY_MEMBER',
        object: { type: 'family_member', name: 'Laija' },
        attributes: { relationship: 'daughter', age: 9 },
      },
      temporal: { bucket: 'long_term' },
      evidenceStrategy: 'merge',
    });

    expect(target.profilePath).toBe('user.family.children');
    expect(target.relationship?.attributes).toMatchObject({ relationship: 'daughter', age: 9 });
  });

  it('rejects profile routes without a schema path', () => {
    expect(() => parseMemoryRouteTarget({ layer: 'long_term_profile', entity: { type: 'person', name: 'Laija' } })).toThrow(/Invalid memory route target/);
  });

  it('rejects custom schema paths without a custom path label', () => {
    expect(() => parseMemoryRouteTarget({ layer: 'long_term_profile', profilePath: 'custom', entity: { type: 'concept', name: 'Niche thing' } })).toThrow(/Invalid memory route target/);
  });

  it('accepts a complete async memory write plan', () => {
    const plan = parseMemoryWritePlan({
      op: 'store',
      canonicalText: 'User has a daughter named Laija who is 9 years old.',
      target: {
        layer: 'long_term_profile',
        profilePath: 'user.family.children',
        entity: { type: 'family_member', name: 'Laija' },
        relationship: { predicate: 'HAS_FAMILY_MEMBER', object: { type: 'family_member', name: 'Laija' }, attributes: { relationship: 'daughter', age: 9 } },
        evidenceStrategy: 'merge',
      },
      confidence: 0.92,
      salience: 0.86,
      sourceMessageIds: ['msg_1'],
      reason: 'Stable family profile fact.',
    });

    expect(plan.op).toBe('store');
  });
});