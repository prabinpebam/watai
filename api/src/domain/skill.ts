import type { ArtifactKind } from './message';

/** A curated, versioned playbook that tells the agent exactly how to do a class of artifact task
 *  well (which preinstalled Python library to use, layout rules, snippets). Selected by keyword
 *  match and injected into the system prompt when the code interpreter is enabled. */
export interface Skill {
  id: string;
  name: string;
  /** One line for matching + the client provenance chip. */
  summary: string;
  /** Lowercase trigger terms ranked against the user's request. */
  keywords: string[];
  /** Artifact kinds this skill produces (icon/UX hint). */
  outputs: ArtifactKind[];
  /** The playbook injected into the system prompt (markdown). */
  body: string;
  version: number;
}

// ---------------------------------------------------------------------------
// Canonical Agent Skills (agentskills.io): a folder with a SKILL.md (YAML
// frontmatter + instructions) plus optional references/, scripts/, assets/.
// These are packaged as a zip, mounted into the code-interpreter sandbox, and
// loaded by the model on demand. See documentation/skills-system-spec.md.
// ---------------------------------------------------------------------------

/** One file bundled in a canonical skill. Exactly one of `text`/`base64` is set. */
export interface SkillFile {
  /** Path relative to the skill root, e.g. `SKILL.md`, `references/REFERENCE.md`, `scripts/x.py`. */
  path: string;
  /** UTF-8 text content (markdown, scripts, …). */
  text?: string;
  /** Base64 content for binary assets (fonts, images, templates). */
  base64?: string;
}

/** Parsed SKILL.md frontmatter (the standard's metadata block). */
export interface SkillFrontmatter {
  name: string;
  description: string;
  license?: string;
  compatibility?: string;
  metadata?: Record<string, string>;
}

/** A canonical skill: frontmatter + bundled files (always including SKILL.md). */
export interface SkillPackage extends SkillFrontmatter {
  /** Bumped when the bundled files change, so the per-endpoint upload re-provisions. */
  version: number;
  files: SkillFile[];
}

/** A skill mounted into the sandbox for a run — drives the level-1 discovery prompt block. */
export interface MountedSkill {
  name: string;
  description: string;
  /** Where the bootstrap unpacks it, e.g. `/mnt/data/skills/pdf/`. */
  path: string;
}

/** A managed skill's health: `ready` (usable) or `invalid` (failed validation, can't be enabled). */
export type SkillStatus = 'ready' | 'invalid';

/** A single, human-readable reason a skill is invalid (surfaced in the upload UI). */
export interface SkillIssue {
  /** Short rule id: `name` | `description` | `compatibility` | `skill-md` | `path` | `size` | `count`. */
  rule: string;
  message: string;
}

// name: 1–64 chars, lowercase letters/digits/hyphens, no leading/trailing/consecutive hyphens.
const SKILL_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function validateSkillName(name: string): SkillIssue | null {
  if (!name) return { rule: 'name', message: 'A skill needs a name (frontmatter `name`).' };
  if (name.length > 64) return { rule: 'name', message: `Name is too long (${name.length}/64 characters).` };
  if (!SKILL_NAME_RE.test(name)) {
    return {
      rule: 'name',
      message: `Invalid name "${name}" — use 1–64 lowercase letters, numbers, and single hyphens (no leading/trailing or double hyphens).`,
    };
  }
  return null;
}

export function validateSkillDescription(description: string): SkillIssue | null {
  if (!description) {
    return { rule: 'description', message: 'A skill needs a description (frontmatter `description`).' };
  }
  if (description.length > 1024) {
    return {
      rule: 'description',
      message: `Description is too long (${description.length}/1024 characters).`,
    };
  }
  return null;
}

/** Validate a parsed frontmatter against the spec; returns all issues (empty = valid). */
export function validateFrontmatter(fm: Partial<SkillFrontmatter>): SkillIssue[] {
  const issues: SkillIssue[] = [];
  const nameIssue = validateSkillName(fm.name ?? '');
  if (nameIssue) issues.push(nameIssue);
  const descIssue = validateSkillDescription(fm.description ?? '');
  if (descIssue) issues.push(descIssue);
  if (fm.compatibility && fm.compatibility.length > 500) {
    issues.push({ rule: 'compatibility', message: 'Compatibility is too long (max 500 characters).' });
  }
  return issues;
}

function unquote(s: string): string {
  const t = s.trim();
  if (t.length >= 2 && ((t[0] === '"' && t.endsWith('"')) || (t[0] === "'" && t.endsWith("'")))) {
    return t.slice(1, -1);
  }
  return t;
}

/**
 * Parse a SKILL.md string into `{ frontmatter, body }`. Handles the standard's simple frontmatter
 * (top-level `key: value` plus a one-level `metadata:` map). Returns null when there is no
 * `--- … ---` frontmatter block at the top of the file.
 */
export function parseSkillFrontmatter(
  md: string,
): { frontmatter: Partial<SkillFrontmatter>; body: string } | null {
  const m = /^\uFEFF?---\r?\n([\s\S]*?)\r?\n---[ \t]*\r?\n?([\s\S]*)$/.exec(md);
  if (!m) return null;
  const fmText = m[1];
  const body = m[2] ?? '';
  const fm: Partial<SkillFrontmatter> = {};
  const metadata: Record<string, string> = {};
  let inMetadata = false;
  for (const line of fmText.split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    const kv = /^(\s*)([A-Za-z0-9_-]+)\s*:\s*(.*)$/.exec(line);
    if (!kv) {
      inMetadata = false;
      continue;
    }
    const indent = kv[1];
    const key = kv[2];
    const val = unquote(kv[3]);
    if (inMetadata && indent.length > 0) {
      metadata[key] = val;
      continue;
    }
    inMetadata = false;
    if (key === 'name') fm.name = val;
    else if (key === 'description') fm.description = val;
    else if (key === 'license') fm.license = val;
    else if (key === 'compatibility') fm.compatibility = val;
    else if (key === 'metadata') inMetadata = true;
  }
  if (Object.keys(metadata).length) fm.metadata = metadata;
  return { frontmatter: fm, body };
}

