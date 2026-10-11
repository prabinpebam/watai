import { describe, it, expect, vi } from 'vitest';
import { zipSync, unzipSync, strToU8, type UnzipFileInfo } from 'fflate';
import { zipSkill, unzipToPackage, MAX_SKILL_FILES, MAX_SKILL_UNPACKED_BYTES } from './skillPackager';
import { PDF_SKILL } from '../skills/pdf';
import type { SkillPackage } from '../domain/skill';

const VALID_MD = '---\nname: my-skill\ndescription: Does a thing. Use when needed.\n---\n# My skill\nBody.';

vi.mock('fflate', async importOriginal => {
  const original = await importOriginal<typeof import('fflate')>();
  return { ...original, unzipSync: vi.fn(original.unzipSync) };
});

function metadataArchive(entries: UnzipFileInfo[]) {
  let accepted = 0;
  vi.mocked(unzipSync).mockImplementationOnce((_bytes, options) => {
    for (const entry of entries) if (!options?.filter || options.filter(entry)) accepted += 1;
    return { 'SKILL.md': strToU8(VALID_MD) };
  });
  const result = unzipToPackage(new Uint8Array([1]));
  return { result, accepted };
}

describe('pre-extraction archive admission', () => {
  it('rejects an oversized entry before accepting it for decompression', () => {
    const { result, accepted } = metadataArchive([{name:'huge.txt',size:50,originalSize:MAX_SKILL_UNPACKED_BYTES+1,compression:8}]);
    expect(result.issues[0]?.rule).toBe('size');
    expect(result.package).toBeUndefined();
    expect(accepted).toBe(0);
  });

  it('counts duplicate and hidden entries against the aggregate allocation limit', () => {
    const {result,accepted} = metadataArchive([
      {name:'.hidden',size:50,originalSize:MAX_SKILL_UNPACKED_BYTES/2,compression:8},
      {name:'.hidden',size:50,originalSize:MAX_SKILL_UNPACKED_BYTES/2+1,compression:8},
    ]);
    expect(result.issues[0]?.rule).toBe('size');
    expect(accepted).toBe(1);
  });

  it('accepts exact-cap metadata without allocating its alleged bytes in the test', () => {
    const {result,accepted} = metadataArchive([{name:'SKILL.md',size:50,originalSize:MAX_SKILL_UNPACKED_BYTES,compression:8}]);
    expect(result.issues).toEqual([]);
    expect(accepted).toBe(1);
  });

  it('rejects excess entry count before accepting the overflowing entry', () => {
    const entries = Array.from({length:MAX_SKILL_FILES+1},(_,index)=>({name:`file-${index}`,size:0,originalSize:0,compression:0}));
    const {result,accepted} = metadataArchive(entries);
    expect(result.issues[0]?.rule).toBe('count');
    expect(accepted).toBe(MAX_SKILL_FILES);
  });

  it.each(['../escape.py','/absolute.py','C:/drive.py'])('rejects unsafe entry paths before extraction: %s', name => {
    const {result,accepted} = metadataArchive([{name,size:1,originalSize:1,compression:0}]);
    expect(result.issues[0]?.rule).toBe('path');
    expect(accepted).toBe(0);
  });

  it('rejects stored-entry size mismatches before allocation', () => {
    const {result,accepted} = metadataArchive([{name:'stored.txt',size:MAX_SKILL_UNPACKED_BYTES+1,originalSize:1,compression:0}]);
    expect(result.issues[0]?.rule).toBe('size');
    expect(accepted).toBe(0);
  });
});

describe('zipSkill + unzipToPackage round-trip', () => {
  it('round-trips the bundled PDF skill (text files preserved at their paths)', () => {
    const bytes = zipSkill(PDF_SKILL);
    const { package: pkg, issues } = unzipToPackage(bytes);
    expect(issues).toEqual([]);
    expect(pkg?.name).toBe('pdf');
    const paths = pkg!.files.map((f) => f.path).sort();
    expect(paths).toEqual(
      [
        'SKILL.md',
        'forms.md',
        'reference.md',
        'scripts/check_bounding_boxes.py',
        'scripts/check_fillable_fields.py',
        'scripts/convert_pdf_to_images.py',
        'scripts/create_validation_image.py',
        'scripts/extract_form_field_info.py',
        'scripts/extract_form_structure.py',
        'scripts/fill_fillable_fields.py',
        'scripts/fill_pdf_form_with_annotations.py',
      ].sort(),
    );
    const skillMd = pkg!.files.find((f) => f.path === 'SKILL.md');
    expect(skillMd?.text).toContain('# PDF Processing Guide');
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
