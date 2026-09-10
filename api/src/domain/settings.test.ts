import { describe, it, expect } from 'vitest';
import { parseSettingsPatch, DEFAULT_SETTINGS, effectiveMemoryPolicy, effectiveMemorySettings } from './settings';
import { AppError } from './errors';

function code(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (e) {
    return (e as AppError).code;
  }
  return undefined;
}

describe('parseSettingsPatch', () => {
  it('accepts a partial patch', () => {
    expect(parseSettingsPatch({ appearance: { theme: 'dark' } })).toEqual({
      appearance: { theme: 'dark' },
    });
  });

  it('accepts memory settings patch', () => {
    expect(parseSettingsPatch({ personalization: { memory: { enabled: true, paused: false, referenceSaved: true, referenceHistory: true, autoExtract: true } } })).toEqual({
      personalization: { memory: { enabled: true, paused: false, referenceSaved: true, referenceHistory: true, autoExtract: true } },
    });
  });

  it('accepts account voice choices but rejects the device-only microphone id', () => {
    expect(parseSettingsPatch({ voice: { voiceId: 'nova' } })).toEqual({ voice: { voiceId: 'nova' } });
    expect(code(() => parseSettingsPatch({ voice: { inputDeviceId: 'mic-abc-123' } }))).toBe('validation');
  });

  it('rejects invalid enum values', () => {
    expect(code(() => parseSettingsPatch({ appearance: { theme: 'neon' } }))).toBe('validation');
    expect(code(() => parseSettingsPatch({ appearance: { textScale: 2 } }))).toBe('validation');
    expect(code(() => parseSettingsPatch({ data: { retention: 'never' } }))).toBe('validation');
  });

  it('rejects unknown top-level and section fields (strict)', () => {
    expect(code(() => parseSettingsPatch({ nope: {} }))).toBe('validation');
    expect(code(() => parseSettingsPatch({ appearance: { bogus: 1 } }))).toBe('validation');
  });
});

describe('DEFAULT_SETTINGS', () => {
  it('is a complete, valid settings object', () => {
    expect(DEFAULT_SETTINGS.appearance.theme).toBe('system');
    expect(DEFAULT_SETTINGS.personalization.memoryEnabled).toBe(true);
    expect(DEFAULT_SETTINGS.personalization.memory?.autoExtract).toBe(true);
    expect(DEFAULT_SETTINGS.voice.engine).toBe('tts');
    expect(DEFAULT_SETTINGS.data.retention).toBe('forever');
  });

  it('derives effective memory settings from the compatibility toggle', () => {
    expect(effectiveMemorySettings({ ...DEFAULT_SETTINGS, personalization: { memoryEnabled: false } })).toMatchObject({
      enabled: false,
      autoExtract: false,
      referenceHistory: false,
    });
  });

  it('derives independent saved-read and learning modes', () => {
    const withMemory = (memory: NonNullable<typeof DEFAULT_SETTINGS.personalization.memory>) => ({
      ...DEFAULT_SETTINGS,
      personalization: { ...DEFAULT_SETTINGS.personalization, memoryEnabled: memory.enabled, memory },
    });
    const base = DEFAULT_SETTINGS.personalization.memory!;
    expect(effectiveMemoryPolicy(withMemory({ ...base, enabled: false, learnChats: 'automatic' })))
      .toEqual({ readSaved: false, learnChats: 'off' });
    expect(effectiveMemoryPolicy(withMemory({ ...base, learnChats: 'off', autoExtract: false })))
      .toEqual({ readSaved: true, learnChats: 'off' });
    expect(effectiveMemoryPolicy(withMemory({ ...base, learnChats: 'review' })))
      .toEqual({ readSaved: true, learnChats: 'review' });
    expect(effectiveMemoryPolicy(withMemory({ ...base, learnChats: 'automatic' })))
      .toEqual({ readSaved: true, learnChats: 'automatic' });
    expect(effectiveMemoryPolicy(withMemory({ ...base, paused: true, learnChats: 'automatic' })))
      .toEqual({ readSaved: true, learnChats: 'off' });
  });
});
