import { describe, it, expect } from 'vitest';
import { selectSkills, codeInterpreterSection } from './skillService';
import { SKILLS } from '../skills';
import type { Skill } from '../domain/skill';

describe('selectSkills', () => {
  it('picks the word-docx skill for an editable document request', () => {
    const out = selectSkills('write me an editable word document memo');
    expect(out[0].id).toBe('word-docx');
  });

  it('picks excel-xlsx for a spreadsheet with formulas', () => {
    const out = selectSkills('build an excel budget spreadsheet with formulas');
    expect(out[0].id).toBe('excel-xlsx');
  });

  it('returns nothing when no keyword matches', () => {
    expect(selectSkills('what is the capital of France?')).toEqual([]);
  });

  it('caps the number of selected skills', () => {
    const out = selectSkills('pdf word excel powerpoint chart csv extract', { max: 2 });
    expect(out).toHaveLength(2);
  });

  it('weights multi-word keywords higher', () => {
    const skills: Skill[] = [
      { id: 'a', name: 'A', summary: '', keywords: ['chart'], outputs: ['image'], body: 'A', version: 1 },
      { id: 'b', name: 'B', summary: '', keywords: ['bar chart'], outputs: ['image'], body: 'B', version: 1 },
    ];
    const out = selectSkills('make a bar chart', { skills });
    expect(out[0].id).toBe('b'); // 'bar chart' (2) beats 'chart' (1)
  });

  it('every bundled skill has the required shape', () => {
    for (const s of SKILLS) {
      expect(s.id && s.name && s.body.length > 40 && s.keywords.length && s.outputs.length).toBeTruthy();
    }
  });
});

describe('codeInterpreterSection', () => {
  it('always states the file-delivery capability, even with no matched skills', () => {
    const s = codeInterpreterSection([]);
    expect(s).toContain('python tool');
    expect(s).toContain('downloadable');
    expect(s).toContain('/mnt/data/');
    expect(s.toLowerCase()).toContain('never say you cannot');
    expect(s.toLowerCase()).toContain('do not put a download link');
  });

  it('embeds each selected skill body alongside the directive', () => {
    const section = codeInterpreterSection(selectSkills('build an excel budget spreadsheet with formulas'));
    expect(section).toContain('Excel spreadsheets');
    expect(section).toContain('openpyxl');
    expect(section).toContain('/mnt/data/');
  });

  it('emits a level-1 discovery block for mounted canonical skills', () => {
    const section = codeInterpreterSection(
      [],
      [{ name: 'pdf', description: 'Create, fill, and extract PDFs.', path: '/mnt/data/skills/pdf/' }],
    );
    expect(section).toContain('python /mnt/data/watai-skills-setup.py');
    expect(section).toContain('pdf — Create, fill, and extract PDFs.');
    expect(section).toContain('/mnt/data/skills/pdf/');
    expect(section).toContain('SKILL.md');
  });
});
