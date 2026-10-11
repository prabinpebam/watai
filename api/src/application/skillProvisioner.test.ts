import { describe, it, expect, vi, afterEach } from 'vitest';
import { createSkillProvisioner } from './skillProvisioner';
import { PDF_SKILL } from '../skills/pdf';
import type { AoaiFiles, UploadedFileInfo } from '../ai/files';

function fakeFiles(initial: Array<{ filename: string; id: string }> = []) {
  const store = [...initial];
  let nextId = 1;
  const uploads: string[] = [];
  let lists = 0;
  const api: AoaiFiles = {
    async uploadFile(_c, f) {
      const id = `up${nextId++}`;
      store.push({ filename: f.filename, id });
      uploads.push(f.filename);
      return { id, bytes: f.bytes.byteLength };
    },
    async listFiles(): Promise<UploadedFileInfo[]> {
      lists++;
      return store.map((s) => ({ id: s.id, filename: s.filename, bytes: 0 }));
    },
    createVectorStore: async () => 'vs',
    addFile: async () => 'ready',
    fileStatus: async () => 'ready',
    removeFile: async () => {},
    deleteFile: async () => {},
    deleteVectorStore: async () => {},
  };
  return { api, uploads, listCount: () => lists };
}

const CREDS = { baseUrl: 'https://r.services.ai.azure.com/openai/v1', key: 'k' };
afterEach(() => vi.useRealTimers());

describe('SkillProvisioner', () => {
  it('uploads the setup script + skill zip once and reuses only its own receipts', async () => {
    const { api, uploads, listCount } = fakeFiles();
    const prov = createSkillProvisioner(api);

    const r1 = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    expect(r1.fileIds).toHaveLength(2); // setup + pdf
    expect(r1.skills).toEqual([
      { name: 'pdf', description: PDF_SKILL.description, path: '/mnt/data/skills/pdf/' },
    ]);
    expect(uploads.sort()).toEqual(['watai-skill.pdf.v2.zip', 'watai-skills-setup.py']);

    const r2 = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    expect(r2.fileIds).toHaveLength(2);
    expect(uploads).toHaveLength(2); // no new uploads
    expect(listCount()).toBe(0);
  });

  it('does not trust same-named packages already listed on a shared endpoint', async () => {
    const { api, uploads } = fakeFiles([
      { filename: 'watai-skill.pdf.v2.zip', id: 'zip' },
      { filename: 'watai-skills-setup.py', id: 'setup' },
    ]);
    const prov = createSkillProvisioner(api);
    const r = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    expect(r.fileIds).not.toContain('setup');
    expect(r.fileIds).not.toContain('zip');
    expect(uploads).toHaveLength(2);
  });

  it('re-uploads when the skill version changed (new filename)', async () => {
    const { api, uploads } = fakeFiles([
      { filename: 'watai-skill.pdf.v1.zip', id: 'old' },
      { filename: 'watai-skills-setup.py', id: 'setup' },
    ]);
    const prov = createSkillProvisioner(api);
    await prov.ensure(CREDS, [{ ...PDF_SKILL, version: 2 }], 'owner-a');
    expect(uploads).toEqual(['watai-skills-setup.py', 'watai-skill.pdf.v2.zip']);
  });

  it('returns nothing when no skills are enabled', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const r = await prov.ensure(CREDS, [], 'owner-a');
    expect(r).toEqual({ fileIds: [], skills: [] });
    expect(uploads).toEqual([]);
  });

  it('separates two owners with identical credentials and skill names', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const first = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    const second = await prov.ensure(CREDS, [PDF_SKILL], 'owner-b');
    expect(second.fileIds.every(id => !first.fileIds.includes(id))).toBe(true);
    expect(uploads).toHaveLength(4);
  });

  it('separates changed skill content even without a version/name change', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const first = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    const second = await prov.ensure(CREDS, [{ ...PDF_SKILL, files: [{ path: 'SKILL.md', text: 'Changed instructions' }] }], 'owner-a');
    expect(second.fileIds[1]).not.toBe(first.fileIds[1]);
    expect(uploads).toHaveLength(3);
  });

  it('does not reuse upload receipts after credential rotation', async () => {
    const { api } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const first = await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    const second = await prov.ensure({ ...CREDS, key: 'rotated' }, [PDF_SKILL], 'owner-a');
    expect(second.fileIds.every(id => !first.fileIds.includes(id))).toBe(true);
  });

  it('single-flights matching concurrent uploads within one owner', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const [first, second] = await Promise.all([prov.ensure(CREDS, [PDF_SKILL], 'owner-a'), prov.ensure(CREDS, [PDF_SKILL], 'owner-a')]);
    expect(first).toEqual(second);
    expect(uploads).toHaveLength(2);
  });

  it('does not advertise mounted skills without their setup script and retries a failed upload', async () => {
    const { api } = fakeFiles();
    vi.spyOn(api, 'uploadFile').mockRejectedValueOnce(new Error('Upload failed'));
    const prov = createSkillProvisioner(api);
    expect(await prov.ensure(CREDS, [PDF_SKILL], 'owner-a')).toEqual({fileIds:[],skills:[]});
    expect((await prov.ensure(CREDS, [PDF_SKILL], 'owner-a')).skills).toHaveLength(1);
  });

  it('reuses content across zip timestamps, then expires receipts after ten minutes', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-11T00:00:00Z'));
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    vi.setSystemTime(new Date('2026-09-11T00:01:00Z'));
    await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    expect(uploads).toHaveLength(2);
    vi.setSystemTime(new Date('2026-09-11T00:10:01Z'));
    await prov.ensure(CREDS, [PDF_SKILL], 'owner-a');
    expect(uploads).toHaveLength(4);
  });

  it('fails closed without an owner', async () => {
    const { api, uploads } = fakeFiles();
    await expect(createSkillProvisioner(api).ensure(CREDS, [PDF_SKILL], '')).rejects.toThrow();
    expect(uploads).toEqual([]);
  });

  it('bounds successful receipts instead of retaining every owner forever', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const tiny = { ...PDF_SKILL, files: [{ path: 'SKILL.md', text: 'small fixture' }] };
    const first = await prov.ensure(CREDS, [tiny], 'first-owner');
    for (let owner = 0; owner < 128; owner += 1) await prov.ensure(CREDS, [tiny], `owner-${owner}`);
    const before = uploads.length;
    const again = await prov.ensure(CREDS, [tiny], 'first-owner');
    expect(again.fileIds.every(id => !first.fileIds.includes(id))).toBe(true);
    expect(uploads.length - before).toBe(2);
  });
});
