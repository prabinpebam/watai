import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';
import type { SkillFile, SkillIssue, SkillPackage } from '../domain/skill';
import { parseSkillFrontmatter, validateFrontmatter } from '../domain/skill';

/** Upload caps (also enforced at the HTTP layer). */
export const MAX_SKILL_FILES = 100;
export const MAX_SKILL_UNPACKED_BYTES = 5 * 1024 * 1024;

const TEXT_EXT = /\.(md|markdown|txt|py|js|mjs|cjs|ts|json|csv|tsv|html|htm|css|ya?ml|xml|sh|cfg|ini|toml)$/i;

function fileBytes(f: SkillFile): Uint8Array {
  if (f.text !== undefined) return strToU8(f.text);
  if (f.base64 !== undefined) return new Uint8Array(Buffer.from(f.base64, 'base64'));
  return new Uint8Array(0);
}

/** Build a deterministic zip of a skill's files (paths are relative to the skill root). */
export function zipSkill(pkg: SkillPackage): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const f of pkg.files) entries[f.path] = fileBytes(f);
  return zipSync(entries, { level: 6 });
}

export interface UnzipResult {
  /** The parsed package when valid. */
  package?: SkillPackage;
  /** Why it was rejected (empty when valid). */
  issues: SkillIssue[];
}

/** Find SKILL.md at the zip root or under a single top-level wrapper folder. */
function findRoot(names: string[]): { prefix: string } | { error: string } {
  if (names.includes('SKILL.md')) return { prefix: '' };
  const tops = new Set<string>();
  for (const n of names) {
    const slash = n.indexOf('/');
    if (slash >= 0) tops.add(n.slice(0, slash + 1));
  }
  if (tops.size === 1) {
    const prefix = [...tops][0];
    if (names.includes(prefix + 'SKILL.md')) return { prefix };
  }
  return { error: 'No SKILL.md found at the zip root or in a single top-level folder.' };
}

function isText(path: string): boolean {
  return TEXT_EXT.test(path);
}

/**
 * Parse + validate an uploaded skill zip into a SkillPackage. Enforces the structure rules
 * (a SKILL.md with valid frontmatter, no path traversal, size/count caps). Returns either the
 * package or a list of fixable issues for the UI — never throws on bad input.
 */
export function unzipToPackage(zipBytes: Uint8Array): UnzipResult {
  let raw: Record<string, Uint8Array>;
  try {
    raw = unzipSync(zipBytes);
  } catch {
    return { issues: [{ rule: 'skill-md', message: 'That file is not a valid .zip archive.' }] };
  }

  const entries = Object.entries(raw).filter(([name]) => !name.endsWith('/'));
  if (entries.length === 0) return { issues: [{ rule: 'skill-md', message: 'The zip is empty.' }] };

  // Security FIRST, on raw names: reject path traversal / absolute / drive-letter paths before any
  // filtering can hide them.
  for (const [name] of entries) {
    if (name.split('/').includes('..') || name.startsWith('/') || /^[A-Za-z]:/.test(name)) {
      return {
        issues: [{ rule: 'path', message: `Unsafe path "${name}" - files must stay inside the skill folder.` }],
      };
    }
  }

  // Drop archive noise (macOS metadata, dotfiles) now that traversal is ruled out.
  const clean = entries.filter(
    ([name]) => !name.startsWith('__MACOSX/') && !name.split('/').some((p) => p.startsWith('.')),
  );
  if (clean.length === 0) return { issues: [{ rule: 'skill-md', message: 'The zip is empty.' }] };
  if (clean.length > MAX_SKILL_FILES) {
    return { issues: [{ rule: 'count', message: `Too many files (${clean.length}/${MAX_SKILL_FILES}).` }] };
  }

  const root = findRoot(clean.map(([n]) => n));
  if ('error' in root) return { issues: [{ rule: 'skill-md', message: root.error }] };
  const prefix = root.prefix;

  let total = 0;
  const files: SkillFile[] = [];
  let skillMd = '';
  for (const [name, bytes] of clean) {
    if (!name.startsWith(prefix)) continue;
    const rel = name.slice(prefix.length);
    if (!rel) continue;
    total += bytes.length;
    if (total > MAX_SKILL_UNPACKED_BYTES) {
      return {
        issues: [
          { rule: 'size', message: `Skill is too large (over ${MAX_SKILL_UNPACKED_BYTES / 1024 / 1024} MB unpacked).` },
        ],
      };
    }
    if (rel === 'SKILL.md') skillMd = strFromU8(bytes);
    files.push(
      isText(rel)
        ? { path: rel, text: strFromU8(bytes) }
        : { path: rel, base64: Buffer.from(bytes).toString('base64') },
    );
  }

  const parsed = parseSkillFrontmatter(skillMd);
  if (!parsed) {
    return {
      issues: [
        {
          rule: 'skill-md',
          message: 'SKILL.md must start with a YAML frontmatter block (--- with name and description ---).',
        },
      ],
    };
  }
  const issues = validateFrontmatter(parsed.frontmatter);
  if (issues.length) return { issues };

  const fm = parsed.frontmatter;
  const pkg: SkillPackage = {
    name: fm.name!,
    description: fm.description!,
    ...(fm.license ? { license: fm.license } : {}),
    ...(fm.compatibility ? { compatibility: fm.compatibility } : {}),
    ...(fm.metadata ? { metadata: fm.metadata } : {}),
    version: 1,
    files,
  };
  return { package: pkg, issues: [] };
}
