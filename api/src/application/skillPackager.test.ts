import { describe, it, expect } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { zipSkill, unzipToPackage } from './skillPackager';
import { PDF_SKILL } from '../skills/pdf';
import type { SkillPackage } from '../domain/skill';

const VALID_MD = '---\nname: my-skill\ndescription: Does a thing. Use when needed.\n---\n# My skill\nBody.';

describe('zipSkill + unzipToPackage round-trip', () => {
  it('round-trips the bundled PDF skill (text files preserved at their paths)', () => {
    const bytes = zipSkill(PDF_SKILL);
    const { package: pkg, issues } = unzipToPackage(bytes);
    expect(issues).toEqual([]);
    expect(pkg?.name).toBe('pdf');
    const paths = pkg!.files.map((f) => f.path).sort();
    expect(paths).toContain('SKILL.md');
    expect(paths).toContain('references/REFERENCE.md');
    expect(paths).toContain('scripts/pdf_fill_form.py');
    const skillMd = pkg!.files.find((f) => f.path === 'SKILL.md');
    expect(skillMd?.text).toContain('# PDF toolkit');
  });

  it('preserves a binary asset as base64', () => {
    const png = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01, 0xff, 0xfe]);
    const pkg: SkillPackage = {
      name: 'asset-skill',
      description: 'Has a binary asset.',
      version: 1,
      files: [
        { path: 'SKILL.md', text: VALID_MD },
        { path: 'assets/logo.png', base64: Buffer.from(png).toString('base64') },
      ],
    };
    const out = unzipToPackage(zipSkill(pkg));
    expect(out.issues).toEqual([]);
    const asset = out.package!.files.find((f) => f.path === 'assets/logo.png');
    expect(asset?.base64).toBe(Buffer.from(png).toString('base64'));
  });
});

describe('unzipToPackage validation', () => {
  it('accepts a SKILL.md under a single wrapper folder', () => {
    const bytes = zipSync({ 'my-skill/SKILL.md': strToU8(VALID_MD), 'my-skill/scripts/x.py': strToU8('print(1)') });
    const out = unzipToPackage(bytes);
    expect(out.issues).toEqual([]);
    expect(out.package?.name).toBe('my-skill');
    expect(out.package!.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'scripts/x.py']);
  });

  it('rejects a zip with no SKILL.md', () => {
    const bytes = zipSync({ 'readme.txt': strToU8('hi') });
    expect(unzipToPackage(bytes).issues[0].rule).toBe('skill-md');
  });

  it('rejects invalid frontmatter (bad name)', () => {
    const bad = '---\nname: Bad Name\ndescription: x\n---\nbody';
    const bytes = zipSync({ 'SKILL.md': strToU8(bad) });
    expect(unzipToPackage(bytes).issues[0].rule).toBe('name');
  });

  it('rejects path traversal', () => {
    const bytes = zipSync({ 'SKILL.md': strToU8(VALID_MD), '../escape.py': strToU8('x') });
    expect(unzipToPackage(bytes).issues[0].rule).toBe('path');
  });

  it('rejects a non-zip blob', () => {
    expect(unzipToPackage(new Uint8Array([1, 2, 3])).issues[0].rule).toBe('skill-md');
  });
});
