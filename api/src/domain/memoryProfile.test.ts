import { describe, expect, it } from 'vitest';
import { buildMemoryProfile } from './memoryProfile';
import type { MemoryRecord } from './memory';

const base = {
  userId: 'userA',
  status: 'active' as const,
  sourceRefs: [{ type: 'message' as const, threadId: 't1', messageId: 'm1', createdAt: '2026-06-28T00:00:00.000Z' }],
  confidence: 0.9,
  salience: 0.8,
  pinned: false,
  sensitive: false,
  visibility: 'normal' as const,
  createdAt: '2026-06-28T00:00:00.000Z',
  updatedAt: '2026-06-28T00:00:00.000Z',
  useCount: 0,
};

function memory(over: Partial<MemoryRecord> & { id: string; text: string; kind: MemoryRecord['kind'] }): MemoryRecord {
  return { ...base, ...over } as MemoryRecord;
}

describe('buildMemoryProfile', () => {
  it.each(['none', 'ambiguous', 'specific'] as const)('preserves distinct same-name relationship reports during %s age updates', update => {
    const records = [
      memory({ id: 'daughter', kind: 'fact', text: 'User has a daughter named Mira who is 9 years old.' }),
      memory({ id: 'son', kind: 'fact', text: 'User has a son named Mira who is 10 years old.' }),
    ];
    if (update !== 'none') records.unshift(memory({ id: 'update', kind: 'fact',
      text: update === 'ambiguous' ? 'Mira is 11 years old.' : 'User has a son named Mira who is 11 years old.' }));
    const children = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', records).profile.user.family.children;
    expect(children).toHaveLength(2);
    const daughter = children.find(child => child.relationship === 'daughter')!;
    const son = children.find(child => child.relationship === 'son')!;
    expect(daughter).toMatchObject({ name: 'Mira', age: 9, sourceMemoryIds: ['daughter'] });
    expect(son.name).toBe('Mira');
    expect(son.age).toBe(update === 'specific' ? 11 : 10);
    expect(new Set(son.sourceMemoryIds)).toEqual(new Set(update === 'specific' ? ['update', 'son'] : ['son']));
  });

  it('keeps unambiguous generic-child upgrades and same-relationship merging', () => {
    const children = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'generic', kind: 'fact', text: 'User has a child named Mira.' }),
      memory({ id: 'specific', kind: 'fact', text: 'User has a daughter named Mira who is 9 years old.' }),
      memory({ id: 'duplicate', kind: 'fact', text: 'User has a daughter named Mira.' }),
    ]).profile.user.family.children;
    expect(children).toHaveLength(1);
    expect(children[0]).toMatchObject({ name: 'Mira', relationship: 'daughter', age: 9 });
    expect(new Set(children[0].sourceMemoryIds)).toEqual(new Set(['generic', 'specific', 'duplicate']));
  });

  it.each([
    { text: 'User has a daughter named Mira. Ravi is 9 years old.', age: undefined },
    { text: 'User has a daughter named Mira. Mira is 9 years old. Ravi is 10 years old.', age: 9 },
    { text: 'User has a daughter named Mira. User has a son named Ravi. He is 9 years old.', age: undefined },
  ])('binds exact ages to the intended named child: $text', ({ text, age }) => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'source', kind: 'fact', text, origin: 'manual', confirmation: 'approved' }),
    ]);
    expect(profile.profile.user.family.children[0]).toMatchObject({ name: 'Mira' });
    expect(profile.profile.user.family.children[0].age).toBe(age);
  });

  it.each([
    'User has a daughter named Mira who is about 9 years old.',
    'User has a daughter named Mira who is not 9 years old.',
    'User has a daughter named Mira who was 9 years old in 2020.',
    'User has a daughter named Mira who is 9 or 10 years old.',
    'Mira is my daughter and is nearly 9 years old.',
  ])('does not flatten qualified age evidence into an exact age: %s', text => {
    const record = memory({ id: 'qualified', kind: 'fact', text, origin: 'manual', confirmation: 'approved' });
    const child = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [record]).profile.user.family.children[0];
    expect(child.name).toBe('Mira');
    expect(child.age).toBeUndefined();
    expect(record.text).toBe(text);
  });

  it.each(['qualified', 'empty'] as const)('does not manufacture a precise routed age from %s evidence', state => {
    const record = memory({ id: 'routed', kind: 'fact', text: state === 'qualified' ? 'My daughter Mira is around 9 years old.' : 'Daughter Mira.',
      route: { layer: 'long_term_profile', profilePath: 'user.family.children', entity: { type: 'family_member', name: 'Mira' },
        relationship: { predicate: 'HAS_FAMILY_MEMBER', attributes: { relationship: 'daughter', age: state === 'empty' ? '' : 9 } } },
    });
    const child = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [record]).profile.user.family.children[0];
    expect(child.name).toBe('Mira');
    expect(child.age).toBeUndefined();
  });

  it.each(['expired', 'future-valid', 'invalid-date', 'wrong-owner'] as const)('does not present %s evidence as a current profile fact', async state => {
    const record = memory({ id: 'old', kind: 'preference', text: 'Use obsolete concise explanations.',
      ...(state === 'expired' ? { invalidAt: '2026-06-28T12:00:00.000Z' } : {}),
      ...(state === 'future-valid' ? { validAt: '2026-06-29T00:00:00.000Z' } : {}),
      ...(state === 'invalid-date' ? { validAt: 'not-a-date' } : {}),
      ...(state === 'wrong-owner' ? { userId: 'userB' } : {}),
    });
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [record]);
    expect(profile.profile.user.preferences.communication).toEqual([]);
    expect(profile.evidenceCount).toBe(0);
    expect(profile.temporal.today.items).toEqual([]);
    expect(profile.temporal.month.items).toEqual([]);
    expect(record.status).toBe('active');
  });

  it('does not classify a future update as recent or replace an invalid profile clock', () => {
    const record = memory({ id: 'future', kind: 'preference', text: 'Use concise explanations.', updatedAt: '2026-07-01T00:00:00.000Z' });
    const current = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [record]);
    expect(current.temporal.today.items).toEqual([]);
    expect(current.temporal.week.items).toEqual([]);
    expect(current.temporal.month.items).toEqual([]);
    expect(current.profile.user.preferences.communication).toHaveLength(1);
    const invalid = buildMemoryProfile('userA', 'invalid-clock', [record]);
    expect(invalid.profile.user.preferences.communication).toEqual([]);
  });

  it.each(['manual', 'inferred'] as const)('uses the appropriate current evidence for %s records', origin => {
    const record = memory({ id: 'source', kind: 'fact', text: 'User has a daughter named Mira.', origin,
      confirmation: origin === 'manual' ? 'approved' : 'automatic',
      sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'm1', createdAt: base.createdAt,
        quote: 'My daughter Mira is 9 years old.' }] });
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [record]);
    const child = profile.profile.user.family.children[0];
    expect(child.name).toBe('Mira');
    expect(child.age).toBe(origin === 'manual' ? undefined : 9);
    expect(record.sourceRefs[0].quote).toContain('9 years old');
  });

  it('projects a pet fact into User > Family > Pets and related interests', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'mem_pet', kind: 'fact', text: 'User has a dog named Chopper inspired by One Piece.' }),
    ]);

    expect(profile.profile.user.family.pets).toEqual([
      expect.objectContaining({
        name: 'Chopper',
        species: 'dog',
        inspiredBy: ['One Piece'],
        sourceMemoryIds: ['mem_pet'],
      }),
    ]);
    expect(profile.profile.user.interests.media).toEqual([expect.objectContaining({ name: 'One Piece' })]);
    expect(profile.temporal.today.items.map((item) => item.memoryId)).toEqual(['mem_pet']);
  });

  it('projects a daughter fact with age into User > Family > Children', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'mem_child', kind: 'fact', text: 'User has a daughter named Laija who is 9 years old.' }),
    ]);

    expect(profile.profile.user.family.children).toEqual([
      expect.objectContaining({
        name: 'Laija',
        relationship: 'daughter',
        age: 9,
        text: 'Laija · daughter · age 9',
        sourceMemoryIds: ['mem_child'],
      }),
    ]);
  });

  it('merges a child age update into an existing child profile item', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'mem_age', kind: 'fact', text: 'Laija is 9 years old.', updatedAt: '2026-06-28T00:01:00.000Z' }),
      memory({ id: 'mem_child', kind: 'fact', text: 'User has a daughter named Laija.', updatedAt: '2026-06-27T00:00:00.000Z' }),
    ]);

    expect(profile.profile.user.family.children).toEqual([
      expect.objectContaining({
        name: 'Laija',
        relationship: 'daughter',
        age: 9,
        text: 'Laija · daughter · age 9',
        sourceMemoryIds: ['mem_child', 'mem_age'],
      }),
    ]);
  });

  it('uses source quotes to recover child age omitted from memory text', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({
        id: 'mem_child',
        kind: 'fact',
        text: 'User has a daughter named Laija.',
        sourceRefs: [{ type: 'message', threadId: 't1', messageId: 'm1', createdAt: '2026-06-28T00:00:00.000Z', quote: "My daughter's name is Laija and she’s 9 years old." }],
      }),
    ]);

    expect(profile.profile.user.family.children).toEqual([
      expect.objectContaining({
        name: 'Laija',
        relationship: 'daughter',
        age: 9,
        text: 'Laija · daughter · age 9',
        sourceMemoryIds: ['mem_child'],
      }),
    ]);
  });

  it('groups preferences, project context, and avoidances into structured branches', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({ id: 'mem_pref', kind: 'preference', text: 'User prefers concise implementation plans.' }),
      memory({ id: 'mem_project', kind: 'project_context', text: 'Watai deploy target is rg-watai-dev.' }),
      memory({ id: 'mem_avoid', kind: 'avoidance', text: 'Do not launch Electron automatically.' }),
    ]);

    expect(profile.profile.user.preferences.communication.map((item) => item.text)).toContain('User prefers concise implementation plans.');
    expect(profile.profile.work.deployments.map((item) => item.text)).toContain('Watai deploy target is rg-watai-dev.');
    expect(profile.profile.avoidances.map((item) => item.text)).toContain('Do not launch Electron automatically.');
  });

  it('honors an explicit child route from the planner, including structured age', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({
        id: 'mem_routed_child',
        kind: 'fact',
        text: 'Daughter Laija.',
        route: {
          layer: 'long_term_profile',
          profilePath: 'user.family.children',
          entity: { type: 'family_member', name: 'Laija' },
          relationship: { predicate: 'HAS_FAMILY_MEMBER', object: { type: 'family_member', name: 'Laija' }, attributes: { relationship: 'daughter', age: 9 } },
        },
      }),
    ]);

    expect(profile.profile.user.family.children).toEqual([
      expect.objectContaining({ name: 'Laija', relationship: 'daughter', age: 9, text: 'Laija · daughter · age 9', sourceMemoryIds: ['mem_routed_child'] }),
    ]);
  });

  it('routes a preference into the planner-specified branch even when text would classify elsewhere', () => {
    const profile = buildMemoryProfile('userA', '2026-06-28T12:00:00.000Z', [
      memory({
        id: 'mem_routed_pref',
        kind: 'preference',
        text: 'Keep things tidy.',
        route: { layer: 'long_term_profile', profilePath: 'user.preferences.engineering' },
      }),
    ]);

    expect(profile.profile.user.preferences.engineering.map((item) => item.text)).toContain('Keep things tidy.');
    expect(profile.profile.user.preferences.other).toEqual([]);
  });
});