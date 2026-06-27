import { describe, it, expect } from 'vitest';
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

describe('SkillProvisioner', () => {
  it('uploads the setup script + skill zip once and reuses them (memoized list)', async () => {
    const { api, uploads, listCount } = fakeFiles();
    const prov = createSkillProvisioner(api);

    const r1 = await prov.ensure(CREDS, [PDF_SKILL]);
    expect(r1.fileIds).toHaveLength(2); // setup + pdf
    expect(r1.skills).toEqual([
      { name: 'pdf', description: PDF_SKILL.description, path: '/mnt/data/skills/pdf/' },
    ]);
    expect(uploads.sort()).toEqual(['watai-skill.pdf.v1.zip', 'watai-skills-setup.py']);

    const r2 = await prov.ensure(CREDS, [PDF_SKILL]);
    expect(r2.fileIds).toHaveLength(2);
    expect(uploads).toHaveLength(2); // no new uploads
    expect(listCount()).toBe(1); // listed once, then memoized
  });

  it('reuses packages already present on the endpoint (no upload)', async () => {
    const { api, uploads } = fakeFiles([
      { filename: 'watai-skill.pdf.v1.zip', id: 'zip' },
      { filename: 'watai-skills-setup.py', id: 'setup' },
    ]);
    const prov = createSkillProvisioner(api);
    const r = await prov.ensure(CREDS, [PDF_SKILL]);
    expect(r.fileIds.sort()).toEqual(['setup', 'zip']);
    expect(uploads).toEqual([]);
  });

  it('re-uploads when the skill version changed (new filename)', async () => {
    const { api, uploads } = fakeFiles([
      { filename: 'watai-skill.pdf.v1.zip', id: 'old' },
      { filename: 'watai-skills-setup.py', id: 'setup' },
    ]);
    const prov = createSkillProvisioner(api);
    await prov.ensure(CREDS, [{ ...PDF_SKILL, version: 2 }]);
    expect(uploads).toEqual(['watai-skill.pdf.v2.zip']);
  });

  it('returns nothing when no skills are enabled', async () => {
    const { api, uploads } = fakeFiles();
    const prov = createSkillProvisioner(api);
    const r = await prov.ensure(CREDS, []);
    expect(r).toEqual({ fileIds: [], skills: [] });
    expect(uploads).toEqual([]);
  });
});
