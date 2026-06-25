// Memory + settings tools (Path C). `add_memory` is benign; `update_setting` is destructive
// and confirmed, and only an allow-listed set of safe setting paths may be changed (no
// arbitrary mutation, no secrets). Backed by `repo` (injected for testability).
import { newId } from '../../lib/ids';
import type { Repository } from '../../data/repository';
import type { ResponsesTool } from '../responses';
import type { ToolResult } from '../orchestrator';
import type { Density, Settings, TextScale, Theme } from '../../lib/types';

export const addMemoryTool: ResponsesTool = {
  type: 'function',
  name: 'add_memory',
  description: 'Save a durable fact about the user to memory so future chats can use it.',
  parameters: {
    type: 'object',
    properties: { text: { type: 'string', description: 'The fact to remember.' } },
    required: ['text'],
  },
};

export async function runAddMemory(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const text = typeof args.text === 'string' ? args.text.trim() : '';
  if (!text) return { output: 'There was nothing to remember.' };
  await repo.addMemory({ id: newId(), text, source: 'agent', createdAt: new Date().toISOString() });
  return { output: `Saved to memory: "${text}".` };
}

// Allow-listed setting paths the agent may change. Each updater validates the value and
// mutates a copy of Settings, returning an error string or null on success.
type Updater = (s: Settings, value: unknown) => string | null;

const THEMES: Theme[] = ['system', 'light', 'dark'];
const DENSITIES: Density[] = ['comfortable', 'compact'];
const SCALES: TextScale[] = [0.9, 1.0, 1.1, 1.25];

const ALLOWED: Record<string, Updater> = {
  'appearance.theme': (s, v) => {
    if (!THEMES.includes(v as Theme)) return 'invalid theme';
    s.appearance.theme = v as Theme;
    return null;
  },
  'appearance.density': (s, v) => {
    if (!DENSITIES.includes(v as Density)) return 'invalid density';
    s.appearance.density = v as Density;
    return null;
  },
  'appearance.textScale': (s, v) => {
    const n = Number(v) as TextScale;
    if (!SCALES.includes(n)) return 'invalid text size';
    s.appearance.textScale = n;
    return null;
  },
  'personalization.memoryEnabled': (s, v) => {
    if (typeof v !== 'boolean') return 'expected true or false';
    s.personalization.memoryEnabled = v;
    return null;
  },
  'data.temporaryDefault': (s, v) => {
    if (typeof v !== 'boolean') return 'expected true or false';
    s.data.temporaryDefault = v;
    return null;
  },
};

export const updateSettingTool: ResponsesTool = {
  type: 'function',
  name: 'update_setting',
  description:
    "Change one of the user's app settings. Allowed paths: appearance.theme (system|light|dark), " +
    'appearance.density (comfortable|compact), appearance.textScale (0.9|1|1.1|1.25), ' +
    'personalization.memoryEnabled (boolean), data.temporaryDefault (boolean). ' +
    'Destructive — the user is asked to confirm.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'The setting path, e.g. appearance.theme.' },
      value: { description: 'The new value (string, number, or boolean).' },
    },
    required: ['path', 'value'],
  },
};

export async function runUpdateSetting(
  args: Record<string, unknown>,
  repo: Repository,
): Promise<ToolResult> {
  const path = typeof args.path === 'string' ? args.path.trim() : '';
  const updater = ALLOWED[path];
  if (!updater) {
    return { output: `I can't update "${path}". Allowed paths: ${Object.keys(ALLOWED).join(', ')}.` };
  }
  const settings = await repo.getSettings();
  const err = updater(settings, args.value);
  if (err) return { output: `That value is invalid (${err}).` };
  await repo.saveSettings(settings);
  return { output: `Updated ${path}.` };
}
