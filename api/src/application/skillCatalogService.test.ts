import { describe, it, expect, beforeEach } from 'vitest';
import { zipSync, strToU8 } from 'fflate';
import { SkillCatalogService } from './skillCatalogService';
import { zipSkill } from './skillPackager';
import { AppError } from '../domain/errors';
import type { SkillPackage } from '../domain/skill';
import type { SkillBlobStore } from '../ports/skillBlobStore';
import type { SkillRecord, SkillStore } from '../ports/skillStore';

function fakeStore(): SkillStore {
  const map = new Map<string, SkillRecord>();
  const k = (u: string, id: string) => `${u}::${id}`;
  return {
    async list(userId) {
      return [...map.values()].filter((r) => r.userId === userId);
    },
    async get(userId, id) {
      return map.get(k(userId, id)) ?? null;
    },
    async put(r) {
      map.set(k(r.userId, r.id), r);
    },
    async remove(userId, id) {
      map.delete(k(userId, id));
    },
  };
}

function fakeBlobs(): SkillBlobStore {
  const map = new Map<string, Uint8Array>();
  return {
    async put(p, b) {
      map.set(p, b);
    },
    async get(p) {
      const b = map.get(p);
      if (!b) throw new Error(`no blob ${p}`);
      return b;
    },
    async remove(p) {
      map.delete(p);
    },
    async readUrl(p) {
      return `mem://${p}`;
    },
  };
}

function makeClock() {
  let n = 0;
  return { now: () => '2025-01-01T00:00:00.000Z', newId: () => `id${++n}` };
}

const sample: SkillPackage = {
  name: 'greeter',
  description: 'Says hello to people.',
  version: 1,
  files: [
    { path: 'SKILL.md', text: '---\nname: greeter\ndescription: Says hello to people.\n---\nGreet the user warmly.' },
    { path: 'scripts/hi.py', text: 'print("hi")' },
  ],
};
const SAMPLE_ZIP = zipSkill(sample);

const pdfOverride: SkillPackage = {
  name: 'pdf',
  description: 'My own PDF tools.',
  version: 1,
  files: [{ path: 'SKILL.md', text: '---\nname: pdf\ndescription: My own PDF tools.\n---\nDo PDFs my way.' }],
};
const PDF_OVERRIDE_ZIP = zipSkill(pdfOverride);

const BAD_ZIP = zipSync({ 'readme.txt': strToU8('no skill here') });

const USER = 'user-1';

describe('SkillCatalogService', () => {
  let svc: SkillCatalogService;

  beforeEach(() => {
    svc = new SkillCatalogService(fakeStore(), fakeBlobs(), makeClock());
  });

  it('lists the default pdf skill, enabled by default', async () => {
    const list = await svc.list(USER);
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ id: 'default:pdf', name: 'pdf', source: 'default', enabled: true, status: 'ready' });
  });

  it('effective() returns the default pdf package when nothing is customized', async () => {
    const eff = await svc.effective(USER);
    expect(eff.map((p) => p.name)).toEqual(['pdf']);
  });

  it('disabling a default persists a toggle and drops it from the effective set', async () => {
    const s = await svc.setEnabled(USER, 'default:pdf', false);
    expect(s.enabled).toBe(false);
    expect((await svc.list(USER))[0].enabled).toBe(false);
    expect(await svc.effective(USER)).toEqual([]);

    await svc.setEnabled(USER, 'default:pdf', true); // re-enable removes the toggle
    expect((await svc.effective(USER)).map((p) => p.name)).toEqual(['pdf']);
  });

  it('uploads a valid skill, lists it, and includes it in the effective set', async () => {
    const s = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    expect(s).toMatchObject({ name: 'greeter', source: 'user', enabled: true, status: 'ready', version: 1, fileCount: 2 });
    expect(s.bytes).toBeGreaterThan(0);

    const list = await svc.list(USER);
    expect(list.map((x) => x.name).sort()).toEqual(['greeter', 'pdf']);

    const eff = await svc.effective(USER);
    expect(eff.map((p) => p.name).sort()).toEqual(['greeter', 'pdf']);
  });

  it('accepts a valid skill zip over the old 5 MB upload cap', async () => {
    const largeSkill: SkillPackage = {
      name: 'large-skill',
      description: 'Tests larger uploaded skill packages.',
      version: 1,
      files: [
        {
          path: 'SKILL.md',
          text: '---\nname: large-skill\ndescription: Tests larger uploaded skill packages.\n---\nUse the data file.',
        },
        { path: 'data/payload.txt', text: 'x'.repeat(6 * 1024 * 1024) },
      ],
    };

    const s = await svc.upload(USER, 'large-skill.zip', zipSkill(largeSkill));
    expect(s).toMatchObject({ name: 'large-skill', source: 'user', status: 'ready', fileCount: 2 });
  });

  it('rejects an invalid zip with a validation error carrying the issue list', async () => {
    await expect(svc.upload(USER, 'bad.zip', BAD_ZIP)).rejects.toMatchObject({ code: 'validation' });
    try {
      await svc.upload(USER, 'bad.zip', BAD_ZIP);
    } catch (e) {
      expect(e).toBeInstanceOf(AppError);
      expect(Array.isArray((e as AppError).details)).toBe(true);
    }
  });

  it('rejects a non-zip filename before unzipping', async () => {
    await expect(svc.upload(USER, 'greeter.txt', SAMPLE_ZIP)).rejects.toMatchObject({ code: 'validation' });
  });

  it('rejects a duplicate user-skill name with a conflict', async () => {
    await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    await expect(svc.upload(USER, 'greeter.zip', SAMPLE_ZIP)).rejects.toMatchObject({ code: 'conflict' });
  });

  it('lets a user skill shadow a same-named default in the effective set', async () => {
    await svc.upload(USER, 'pdf.zip', PDF_OVERRIDE_ZIP);
    const eff = await svc.effective(USER);
    expect(eff).toHaveLength(1);
    expect(eff[0]).toMatchObject({ name: 'pdf', description: 'My own PDF tools.' });
  });

  it('replace bumps the version and updates metadata', async () => {
    const created = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    const updatedPkg: SkillPackage = {
      ...sample,
      description: 'Greets people, now better.',
      files: [
        { path: 'SKILL.md', text: '---\nname: greeter\ndescription: Greets people, now better.\n---\nGreet warmly.' },
      ],
    };
    const replaced = await svc.replace(USER, created.id, 'greeter.zip', zipSkill(updatedPkg));
    expect(replaced.version).toBe(2);
    expect(replaced.description).toBe('Greets people, now better.');
    expect(replaced.fileCount).toBe(1);
  });

  it('disabling then re-enabling a user skill works; an effective run reflects it', async () => {
    const s = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    await svc.setEnabled(USER, s.id, false);
    expect((await svc.effective(USER)).map((p) => p.name)).toEqual(['pdf']);
    await svc.setEnabled(USER, s.id, true);
    expect((await svc.effective(USER)).map((p) => p.name).sort()).toEqual(['greeter', 'pdf']);
  });

  it('refuses to delete a default, deletes a user skill', async () => {
    await expect(svc.remove(USER, 'default:pdf')).rejects.toMatchObject({ code: 'conflict' });
    const s = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    await svc.remove(USER, s.id);
    expect((await svc.list(USER)).map((x) => x.name)).toEqual(['pdf']);
  });

  it('mints a download url for a user skill but not for a default', async () => {
    const s = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    expect(await svc.download(USER, s.id)).toEqual({ url: `mem://skills/${USER}/${s.id}.zip` });
    await expect(svc.download(USER, 'default:pdf')).rejects.toMatchObject({ code: 'not_found' });
  });

  it('returns detail with a file tree and SKILL.md body (frontmatter stripped)', async () => {
    const def = await svc.getDetail(USER, 'default:pdf');
    expect(def.files.some((f) => f.path === 'SKILL.md')).toBe(true);
    expect(def.body.length).toBeGreaterThan(0);

    const s = await svc.upload(USER, 'greeter.zip', SAMPLE_ZIP);
    const detail = await svc.getDetail(USER, s.id);
    expect(detail.files.map((f) => f.path).sort()).toEqual(['SKILL.md', 'scripts/hi.py']);
    expect(detail.body).toContain('Greet the user');
    expect(detail.body).not.toContain('---');
  });
});
