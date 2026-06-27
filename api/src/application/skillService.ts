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

/** Render the selected skills as a system-prompt section (empty string when none selected). */
export function skillsPromptSection(skills: Skill[]): string {
  if (!skills.length) return '';
  const blocks = skills.map((s) => `### ${s.name}\n${s.body}`).join('\n\n');
  return (
    'You can run Python with the code interpreter (the "python tool") to create files. ' +
    'Apply these skills when relevant:\n\n' +
    blocks +
    '\n\nSave every generated file under /mnt/data/ with a clear filename, and mention it in your reply.'
  );
}
