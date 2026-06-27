import { describe, it, expect } from 'vitest';
import {
  parseSkillFrontmatter,
  validateSkillName,
  validateSkillDescription,
  validateFrontmatter,
} from './skill';

describe('validateSkillName', () => {
  it('accepts valid names', () => {
    for (const n of ['pdf', 'pdf-processing', 'data-analysis', 'a1', 'a-b-c']) {
      expect(validateSkillName(n)).toBeNull();
    }
  });
  it('rejects invalid names', () => {
    expect(validateSkillName('')?.rule).toBe('name');
    expect(validateSkillName('PDF')?.rule).toBe('name'); // uppercase
    expect(validateSkillName('-pdf')?.rule).toBe('name'); // leading hyphen
    expect(validateSkillName('pdf-')?.rule).toBe('name'); // trailing hyphen
    expect(validateSkillName('pdf--x')?.rule).toBe('name'); // double hyphen
    expect(validateSkillName('pdf tools')?.rule).toBe('name'); // space
    expect(validateSkillName('a'.repeat(65))?.rule).toBe('name'); // too long
  });
});

describe('validateSkillDescription', () => {
  it('requires a non-empty description within 1024 chars', () => {
    expect(validateSkillDescription('Extract text from PDFs.')).toBeNull();
    expect(validateSkillDescription('')?.rule).toBe('description');
    expect(validateSkillDescription('x'.repeat(1025))?.rule).toBe('description');
  });
});

describe('validateFrontmatter', () => {
  it('returns no issues for a valid frontmatter', () => {
    expect(validateFrontmatter({ name: 'pdf', description: 'Work with PDFs.' })).toEqual([]);
  });
  it('collects name + description + compatibility issues', () => {
    const issues = validateFrontmatter({ name: 'Bad Name', description: '', compatibility: 'x'.repeat(501) });
    expect(issues.map((i) => i.rule).sort()).toEqual(['compatibility', 'description', 'name']);
  });
});

describe('parseSkillFrontmatter', () => {
  it('parses the required + optional fields and returns the body', () => {
    const md = [
      '---',
      'name: pdf-processing',
      'description: Extract text, fill forms, merge files. Use when handling PDFs.',
      'license: Apache-2.0',
      'metadata:',
      '  author: example-org',
      '  version: "1.0"',
      '---',
      '',
      '# PDF Processing',
      'Body here.',
    ].join('\n');
    const out = parseSkillFrontmatter(md);
    expect(out).not.toBeNull();
    expect(out!.frontmatter.name).toBe('pdf-processing');
    expect(out!.frontmatter.description).toContain('Extract text');
    expect(out!.frontmatter.license).toBe('Apache-2.0');
    expect(out!.frontmatter.metadata).toEqual({ author: 'example-org', version: '1.0' });
    expect(out!.body).toContain('# PDF Processing');
    expect(out!.body).toContain('Body here.');
  });

  it('handles CRLF line endings and a quoted description', () => {
    const md = '---\r\nname: x\r\ndescription: "A, b: c"\r\n---\r\nHello';
    const out = parseSkillFrontmatter(md);
    expect(out!.frontmatter.name).toBe('x');
    expect(out!.frontmatter.description).toBe('A, b: c');
    expect(out!.body).toBe('Hello');
  });

  it('returns null when there is no frontmatter block', () => {
    expect(parseSkillFrontmatter('# Just a heading\nno frontmatter')).toBeNull();
  });

  it('round-trips through validateFrontmatter for a real skill', () => {
    const md = '---\nname: pdf\ndescription: Make and read PDFs.\n---\nbody';
    const out = parseSkillFrontmatter(md)!;
    expect(validateFrontmatter(out.frontmatter)).toEqual([]);
  });
});
