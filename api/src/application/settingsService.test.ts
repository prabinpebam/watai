import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SettingsService } from './settingsService';
import { InMemorySettingsStore } from '../adapters/memory/settingsStore';
import { DEFAULT_SETTINGS, effectiveMemoryPolicy, type SettingsPatch } from '../domain/settings';
import { InMemoryMemoryStore } from '../adapters/memory/memoryStore';
import { MemoryService } from './memoryService';
import { MemoryContextService } from './memoryContextService';

function makeService() {
  const store = new InMemorySettingsStore();
  return { store, svc: new SettingsService(store) };
}

describe('SettingsService', () => {
  let ctx: ReturnType<typeof makeService>;
  beforeEach(() => (ctx = makeService()));

  it.each<SettingsPatch>([
    { appearance: { theme: 'dark' } },
    { voice: { rate: 1.2 } },
    { data: { retention: '30d' } },
    { personalization: { memory: { referenceSaved: true } } },
  ])('does not enable new-account memory through an unrelated first settings patch: %j', async patch => {
    const result = await ctx.svc.update('userA', patch, 0);
    expect(result.revision).toBe(1);
    expect(effectiveMemoryPolicy(result)).toEqual({ readSaved: false, learnChats: 'off' });
    expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('userA'))).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('starts explicit new-account master enablement in Saved-only mode', async () => {
    await ctx.svc.update('userA', { personalization: { memoryEnabled: true } }, 0);
    expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('userA'))).toEqual({ readSaved: true, learnChats: 'off' });
  });

  it('preserves explicitly supplied automatic learning and existing-account choices', async () => {
    await ctx.svc.update('userA', { personalization: { memoryEnabled: true, memory: {
      enabled: true, paused: false, referenceSaved: true, referenceHistory: true, autoExtract: true, learnChats: 'automatic',
    } } }, 0);
    await ctx.svc.update('userA', { appearance: { theme: 'dark' } }, 1);
    expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('userA'))).toEqual({ readSaved: true, learnChats: 'automatic' });
    await expect(ctx.svc.update('userA', { appearance: { theme: 'light' } }, 0)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('requires persisted permission before recall and preserves approved saved-only context', async () => {
    const memories = new InMemoryMemoryStore();
    const now = '2026-01-01T00:00:00Z';
    await new MemoryService(memories, { now: () => now, newId: () => 'saved' })
      .createManual('userA', { text: 'Use concise explanations.', kind: 'preference' });
    const list = vi.spyOn(memories, 'list');
    const recall = new MemoryContextService(memories, { get: userId => ctx.svc.getForMemory(userId) }, { profile: true });
    const input = { userId: 'userA', threadId: 'thread', latestUserText: 'Explain the task.', now };
    expect((await recall.buildForRun(input)).memories).toEqual([]);
    expect(list).not.toHaveBeenCalled();
    await ctx.store.put('userA', { ...DEFAULT_SETTINGS, personalization: {
      memoryEnabled: true, memory: { ...DEFAULT_SETTINGS.personalization.memory!, learnChats: 'off', autoExtract: false },
    } }, null);
    expect((await recall.buildForRun(input)).memories).toMatchObject([{ id: 'saved', text: 'Use concise explanations.' }]);
  });

  it.each(['missing', 'legacy', 'master-off', 'nested-off', 'unknown-enabled'] as const)
    ('does not authorize memory processing from %s settings', async state => {
      if (state !== 'missing') await ctx.store.put('userA', {
        ...DEFAULT_SETTINGS,
        personalization: {
          memoryEnabled: state !== 'master-off',
          ...(state === 'legacy' ? {} : { memory: { ...DEFAULT_SETTINGS.personalization.memory!,
            enabled: state === 'unknown-enabled' ? undefined as unknown as boolean : state !== 'nested-off',
          } }),
        },
      }, null);
      const before = await ctx.store.get('userA');
      expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('userA'))).toEqual({ readSaved: false, learnChats: 'off' });
      expect(await ctx.store.get('userA')).toEqual(before);
      expect(DEFAULT_SETTINGS.personalization.memoryEnabled).toBe(true);
    });

  it.each([
    { referenceSaved: true, paused: false, learnChats: 'automatic' as const, expectedLearning: 'automatic' },
    { referenceSaved: true, paused: true, learnChats: 'automatic' as const, expectedLearning: 'off' },
    { referenceSaved: true, paused: false, learnChats: 'off' as const, expectedLearning: 'off' },
    { referenceSaved: false, paused: false, learnChats: 'review' as const, expectedLearning: 'review' },
  ])('preserves independently persisted memory choices: %j', async ({ expectedLearning, ...choice }) => {
    await ctx.store.put('userA', { ...DEFAULT_SETTINGS, personalization: {
      memoryEnabled: true, memory: { ...DEFAULT_SETTINGS.personalization.memory!, ...choice },
    } }, null);
    expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('userA'))).toEqual({ readSaved: choice.referenceSaved, learnChats: expectedLearning });
    expect(effectiveMemoryPolicy(await ctx.svc.getForMemory('other-owner'))).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('does not substitute defaults after a failed memory permission read', async () => {
    const failure = new Error('Synthetic settings failure');
    vi.spyOn(ctx.store, 'get').mockRejectedValue(failure);
    await expect(ctx.svc.getForMemory('userA')).rejects.toBe(failure);
  });

  it.each([false, true])('preserves legacy enablement when creating nested preferences: %s', async enabled => {
    await ctx.store.put('userA', { ...DEFAULT_SETTINGS, personalization: { memoryEnabled: enabled } }, null);
    const updated = await ctx.svc.update('userA', { personalization: { memory: { paused: true } } }, 1);
    expect(updated.personalization).toMatchObject({ memoryEnabled: enabled, memory: {
      enabled, paused: true, referenceSaved: enabled, referenceHistory: enabled, autoExtract: enabled,
    } });
    expect(effectiveMemoryPolicy(updated)).toEqual({ readSaved: enabled, learnChats: 'off' });
  });

  it('applies a compatibility opt-out without erasing nested preferences', async () => {
    const updated = await ctx.svc.update('userA', { personalization: { memoryEnabled: false } }, 0);
    expect(updated.personalization.memory?.enabled).toBe(true);
    expect(effectiveMemoryPolicy(await ctx.svc.get('userA'))).toEqual({ readSaved: false, learnChats: 'off' });
  });

  it('returns defaults for a new user', async () => {
    expect(await ctx.svc.get('userA')).toEqual(DEFAULT_SETTINGS);
  });

  it('merges a partial patch, preserving untouched fields and sections', async () => {
    const updated = await ctx.svc.update('userA', { appearance: { theme: 'dark' } }, 0);
    expect(updated.revision).toBe(1);
    expect(updated.appearance.theme).toBe('dark');
    // other appearance fields preserved
    expect(updated.appearance.density).toBe(DEFAULT_SETTINGS.appearance.density);
    // other sections preserved
    expect(updated.voice).toEqual(DEFAULT_SETTINGS.voice);
  });

  it('accumulates successive patches and persists per-user', async () => {
    await ctx.svc.update('userA', { appearance: { theme: 'dark' } }, 0);
    await ctx.svc.update('userA', { data: { temporaryDefault: false, retention: '30d' } }, 1);
    const a = await ctx.svc.get('userA');
    expect(a.appearance.theme).toBe('dark');
    expect(a.data.retention).toBe('30d');
    // a different user is unaffected
    expect(await ctx.svc.get('userB')).toEqual(DEFAULT_SETTINGS);
  });

  it('rejects a stale revision without weakening the stored privacy choice', async () => {
    await ctx.svc.update('userA', { personalization: { memoryEnabled: false } }, 0);
    await expect(ctx.svc.update('userA', { personalization: { memoryEnabled: true } }, 0))
      .rejects.toMatchObject({ code: 'conflict' });
    expect((await ctx.svc.get('userA')).personalization.memoryEnabled).toBe(false);
  });
});
