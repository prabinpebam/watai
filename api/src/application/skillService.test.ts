import { describe, it, expect } from 'vitest';
import { selectSkills, skillsPromptSection } from './skillService';
import { SKILLS } from '../skills';
import type { Skill } from '../domain/skill';

describe('selectSkills', () => {
  it('picks the professional-pdf skill for a PDF formatting request', () => {
    const out = selectSkills('extract the content and make a professional A4 PDF I can download');
    expect(out[0].id).toBe('professional-pdf');
  });

  it('picks the pdf-extract skill when asked to read an uploaded PDF', () => {
    const out = selectSkills('extract the contents from the uploaded pdf');
    expect(out.map((s) => s.id)).toContain('pdf-extract');
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

describe('skillsPromptSection', () => {
  it('is empty when no skills', () => {
    expect(skillsPromptSection([])).toBe('');
  });

  it('embeds each selected skill body and the /mnt/data instruction', () => {
    const section = skillsPromptSection(selectSkills('make a professional pdf'));
    expect(section).toContain('Professional PDF');
    expect(section).toContain('ReportLab');
    expect(section).toContain('/mnt/data/');
  });
});
