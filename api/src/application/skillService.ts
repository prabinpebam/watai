import type { MountedSkill, Skill } from '../domain/skill';
import { SKILLS, SKILLS_SETUP_SCRIPT } from '../skills';

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
  'asked for a file — produce the actual file, then briefly describe what you made. ' +
  'IMPORTANT: do NOT put a download link, hyperlink, URL, markdown link, file path, or HTML ' +
  'anchor for the generated file in your reply. There is no URL you can link to — the file ' +
  'already appears as a downloadable attachment card directly beneath your message. Just state ' +
  'that the file is ready and describe it in one or two sentences.';

/** Build the level-1 discovery block for canonical skills mounted into the sandbox: their names +
 *  descriptions, the one-time bootstrap command, and where each unpacks. This is *discovery* only —
 *  the model reads each skill's SKILL.md (and bundled scripts/references) on demand at execution. */
function skillsDiscoveryBlock(mounts: MountedSkill[]): string {
  const list = mounts.map((m) => `- ${m.name} — ${m.description}  [folder: ${m.path}]`).join('\n');
  return (
    'AVAILABLE SKILLS. You have specialized, file-based skills bundled into your sandbox as zip ' +
    'packages. Before using any skill in a session, run this once to unpack them (it is idempotent ' +
    'and prints what is ready):\n\n' +
    `    python /mnt/data/${SKILLS_SETUP_SCRIPT.filename}\n\n` +
    'That extracts each skill into /mnt/data/skills/<name>/. Skills available now:\n\n' +
    `${list}\n\n` +
    "When a task matches one of these skills, FIRST open that folder's SKILL.md and read it, then " +
    'follow its instructions using the helper scripts and reference files bundled inside the same ' +
    'folder. SKILL.md tells you which preinstalled Python libraries and scripts to use. Prefer a ' +
    'matching skill over improvising.'
  );
}

/** Build the code-interpreter system-prompt section: the directive, the canonical-skill discovery
 *  block (for mounted skills), and any keyword-matched inline playbooks. */
export function codeInterpreterSection(playbooks: Skill[], mounts: MountedSkill[] = []): string {
  const parts = [CODE_INTERPRETER_DIRECTIVE];
  if (mounts.length) parts.push(skillsDiscoveryBlock(mounts));
  if (playbooks.length) {
    const blocks = playbooks.map((s) => `### ${s.name}\n${s.body}`).join('\n\n');
    parts.push(`Apply these skills:\n\n${blocks}`);
  }
  return parts.join('\n\n');
}
