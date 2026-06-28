import { describe, it, expect } from 'vitest';
import { parseSettingsPatch, DEFAULT_SETTINGS, effectiveMemorySettings } from './settings';
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
});
