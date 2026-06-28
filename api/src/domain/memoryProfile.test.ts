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