import { describe, it, expect, vi } from 'vitest';
import type { Repository } from '../../data/repository';
import { addMemoryTool, runAddMemory, updateSettingTool, runUpdateSetting } from './memory';
import { DEFAULT_SETTINGS } from '../../lib/types';

describe('add_memory tool', () => {
  it('is a function tool named add_memory', () => {
    expect(addMemoryTool.type).toBe('function');
    expect(addMemoryTool.name).toBe('add_memory');
  });

  it('saves a memory item tagged as agent-sourced', async () => {
    const addMemory = vi.fn(async () => {});
    const res = await runAddMemory({ text: 'Prefers concise answers' }, { addMemory } as unknown as Repository);
    expect(addMemory).toHaveBeenCalledWith(
      expect.objectContaining({ text: 'Prefers concise answers', source: 'agent' }),
    );
    expect(res.output).toMatch(/saved|remember/i);
  });

  it('requires text', async () => {
    const addMemory = vi.fn();
    const res = await runAddMemory({}, { addMemory } as unknown as Repository);
    expect(addMemory).not.toHaveBeenCalled();
    expect(res.output).toMatch(/nothing|no text/i);
  });
});

describe('update_setting tool', () => {
  it('is a function tool named update_setting', () => {
    expect(updateSettingTool.type).toBe('function');
    expect(updateSettingTool.name).toBe('update_setting');
  });

  it('updates an allow-listed setting path', async () => {
    const getSettings = vi.fn(async () => structuredClone(DEFAULT_SETTINGS));
    const saveSettings = vi.fn(async () => {});
    const res = await runUpdateSetting(
      { path: 'appearance.theme', value: 'dark' },
      { getSettings, saveSettings } as unknown as Repository,
    );
    expect(saveSettings).toHaveBeenCalledWith(
      expect.objectContaining({ appearance: expect.objectContaining({ theme: 'dark' }) }),
    );
    expect(res.output).toMatch(/updated|set/i);
  });

  it('rejects an unknown / non-allow-listed setting path', async () => {
    const getSettings = vi.fn(async () => structuredClone(DEFAULT_SETTINGS));
    const saveSettings = vi.fn(async () => {});
    const res = await runUpdateSetting(
      { path: 'secrets.apiKey', value: 'x' },
      { getSettings, saveSettings } as unknown as Repository,
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(res.output).toMatch(/can.?t|cannot|not allowed|unknown/i);
  });

  it('rejects an invalid value for a known path', async () => {
    const getSettings = vi.fn(async () => structuredClone(DEFAULT_SETTINGS));
    const saveSettings = vi.fn(async () => {});
    const res = await runUpdateSetting(
      { path: 'appearance.theme', value: 'rainbow' },
      { getSettings, saveSettings } as unknown as Repository,
    );
    expect(saveSettings).not.toHaveBeenCalled();
    expect(res.output).toMatch(/invalid|not a valid/i);
  });
});
