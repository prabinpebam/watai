import type { Skill } from '../domain/skill';
import { SKILLS } from '../skills';

/**
 * Rank the bundled skills by keyword overlap with the user's request and return the top matches
 * (each with at least one hit). Multi-word keywords are weighted higher (more specific). Cheap and
 * deterministic — no model round-trip; the selected skill bodies are injected into the system
 * prompt for runs where the code interpreter is enabled.
 */
export function selectSkills(prompt: string, opts: { max?: number; skills?: Skill[] } = {}): Skill[] {
  const max = opts.max ?? 3;
  const skills = opts.skills ?? SKILLS;
  const haystack = ` ${prompt.toLowerCase()} `;
  return skills
    .map((s) => {
      let score = 0;
      for (const kw of s.keywords) {
        if (haystack.includes(kw.toLowerCase())) score += kw.includes(' ') ? 2 : 1;
      }
      return { s, score };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.s.id.localeCompare(b.s.id))
    .slice(0, max)
    .map((x) => x.s);
}

/** The forceful code-interpreter directive. The model otherwise assumes files it writes stay in
 *  its sandbox and refuses to "deliver" them; this tells it the truth — our worker captures
 *  /mnt/data/ outputs and surfaces them as downloadable attachments in the chat. */
const CODE_INTERPRETER_DIRECTIVE =
  'You have a code interpreter (the "python tool") and you CAN create real, downloadable files. ' +
  'When the user asks for a document, PDF, Word doc, spreadsheet, slide deck, chart, CSV, image, ' +
  'or any file, you MUST use the python tool to generate it and save it under /mnt/data/. Files ' +
  'saved under /mnt/data/ are automatically delivered to the user as downloadable attachments in ' +
  'this chat — the user can download them directly. Never say you cannot create, attach, host, ' +
  'email, or deliver files; you can. Do not paste a long document as plain text when the user ' +
  'asked for a file — produce the actual file, then briefly describe what you made.';

/** Build the code-interpreter system-prompt section: the directive plus any matched skill bodies. */
export function codeInterpreterSection(skills: Skill[]): string {
  if (!skills.length) return CODE_INTERPRETER_DIRECTIVE;
  const blocks = skills.map((s) => `### ${s.name}\n${s.body}`).join('\n\n');
  return `${CODE_INTERPRETER_DIRECTIVE}\n\nApply these skills:\n\n${blocks}`;
}
