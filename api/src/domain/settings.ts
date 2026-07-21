import { z } from 'zod';
import { parseOrThrow } from './validate';

const themeEnum = z.enum(['system', 'light', 'dark']);
const textScale = z.union([z.literal(0.9), z.literal(1.0), z.literal(1.1), z.literal(1.25)]);
const density = z.enum(['comfortable', 'compact']);
const reduceMotion = z.union([z.boolean(), z.literal('system')]);
const retention = z.enum(['forever', '30d', '90d']);
const engine = z.enum(['tts', 'realtime']);

const memorySettingsSchema = z.object({
  enabled: z.boolean(),
  paused: z.boolean(),
  referenceSaved: z.boolean(),
  referenceHistory: z.boolean(),
  autoExtract: z.boolean(),
});

const personalizationBase = z.object({
  aboutYou: z.string().max(2000).optional(),
  howRespond: z.string().max(2000).optional(),
  memoryEnabled: z.boolean(),
  memory: memorySettingsSchema.strict().optional(),
});
const appearanceBase = z.object({
  theme: themeEnum,
  textScale,
  density,
  reduceMotion,
  language: z.string().min(2).max(10),
});
const voiceBase = z.object({
  engine,
  voiceId: z.string().max(50).optional(),
  inputDeviceId: z.string().max(200).optional(),
  rate: z.number().min(0.5).max(2),
  vad: z.number().min(0).max(1),
  autoStopDictation: z.boolean(),
  autoSend: z.boolean().optional(),
  captions: z.boolean(),
});
const dataBase = z.object({
  sync: z.boolean(),
  temporaryDefault: z.boolean(),
  retention,
});

const settingsSchema = z
  .object({
    personalization: personalizationBase.strict(),
    appearance: appearanceBase.strict(),
    voice: voiceBase.strict(),
    data: dataBase.strict(),
  })
  .strict();

const patchSchema = z
  .object({
    personalization: personalizationBase.partial().strict().optional(),
    appearance: appearanceBase.partial().strict().optional(),
    voice: voiceBase.partial().strict().optional(),
    data: dataBase.partial().strict().optional(),
  })
  .strict();

export type Settings = z.infer<typeof settingsSchema>;
export type SettingsPatch = z.infer<typeof patchSchema>;
export type MemorySettings = z.infer<typeof memorySettingsSchema>;

export const DEFAULT_MEMORY_SETTINGS: MemorySettings = {
  enabled: true,
  paused: false,
  referenceSaved: true,
  referenceHistory: true,
  autoExtract: true,
};

export const DEFAULT_SETTINGS: Settings = {
  personalization: { memoryEnabled: true, memory: DEFAULT_MEMORY_SETTINGS },
  appearance: { theme: 'system', textScale: 1.0, density: 'comfortable', reduceMotion: 'system', language: 'en' },
  voice: { engine: 'tts', rate: 1, vad: 0.5, autoStopDictation: false, captions: true },
  data: { sync: false, temporaryDefault: false, retention: 'forever' },
};

export function parseSettingsPatch(input: unknown): SettingsPatch {
  return parseOrThrow(patchSchema, input, 'Invalid settings.');
}

export function normalizeSettings(settings: Settings): Settings {
  const legacyVoice = settings.voice as Settings['voice'] & { autoSend?: boolean };
  const voice = {
    ...DEFAULT_SETTINGS.voice,
    ...legacyVoice,
    autoStopDictation: legacyVoice.autoStopDictation ?? legacyVoice.autoSend ?? false,
  };
  delete voice.autoSend;
  return { ...DEFAULT_SETTINGS, ...settings, voice };
}

/** Shallow-merge each section of a patch over the current settings. */
export function mergeSettings(current: Settings, patch: SettingsPatch): Settings {
  const voicePatch = patch.voice as SettingsPatch['voice'] & { autoSend?: boolean };
  const autoStopDictation = voicePatch?.autoStopDictation ?? voicePatch?.autoSend ?? current.voice.autoStopDictation;
  return normalizeSettings({
    personalization: { ...current.personalization, ...patch.personalization },
    appearance: { ...current.appearance, ...patch.appearance },
    voice: { ...current.voice, ...patch.voice, autoStopDictation },
    data: { ...current.data, ...patch.data },
  });
}

export function effectiveMemorySettings(settings: Settings): MemorySettings {
  return settings.personalization.memory ?? {
    enabled: settings.personalization.memoryEnabled,
    paused: false,
    referenceSaved: settings.personalization.memoryEnabled,
    referenceHistory: settings.personalization.memoryEnabled,
    autoExtract: settings.personalization.memoryEnabled,
  };
}
