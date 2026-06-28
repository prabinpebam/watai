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
});