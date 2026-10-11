import { strToU8 } from 'fflate';
import { createHash, createHmac, randomBytes } from 'node:crypto';
import { zipSkill } from './skillPackager';
import { SKILLS_SETUP_SCRIPT } from '../skills';
import type { AoaiCreds, AoaiFiles } from '../ai/files';
import type { MountedSkill, SkillPackage } from '../domain/skill';

export interface ProvisionResult {
  /** file_ids to attach to the code-interpreter container (skill zips + the setup script). */
  fileIds: string[];
  /** The skills actually mounted (for the level-1 discovery block). */
  skills: MountedSkill[];
}

export interface SkillProvisioner {
  ensure(creds: AoaiCreds, skills: SkillPackage[], userId: string): Promise<ProvisionResult>;
}

const SETUP_FILENAME = SKILLS_SETUP_SCRIPT.filename;
function skillZipName(s: SkillPackage): string {
  return `watai-skill.${s.name}.v${s.version}.zip`;
}

/**
 * Reuses only successful uploads from the same owner, credentials and package content.
 * Endpoint-wide filenames are not evidence of ownership or content identity.
 */
export function createSkillProvisioner(files: AoaiFiles): SkillProvisioner {
  const salt = randomBytes(32);
  const cache = new Map<string, { id: string; expiresAt: number }>();
  const inflight = new Map<string, Promise<string | null>>();
  const maxEntries = 256;
  const ttlMs = 10 * 60_000;

  async function ensureFile(
    creds: AoaiCreds,
    scope: string,
    filename: string,
    content: string,
    bytes: () => Uint8Array,
    mime: string,
  ): Promise<string | null> {
    const key = createHash('sha256').update(JSON.stringify([scope, filename, content])).digest('hex');
    const existing = cache.get(key);
    if (existing && existing.expiresAt > Date.now()) return existing.id;
    cache.delete(key);
    let pending = inflight.get(key);
    if (!pending) {
      if (inflight.size >= maxEntries) return null;
      pending = (async () => {
        try {
          const { id } = await files.uploadFile(creds, { bytes: bytes(), filename, mime });
          if (!id) return null;
          while (cache.size >= maxEntries) cache.delete(cache.keys().next().value!);
          cache.set(key, { id, expiresAt: Date.now() + ttlMs });
          return id;
        } catch {
          return null;
        }
      })();
      inflight.set(key, pending);
    }
    try {
      return await pending;
    } finally {
      if (inflight.get(key) === pending) inflight.delete(key);
    }
  }

  return {
    async ensure(creds, skills, userId) {
      if (typeof userId !== 'string' || !userId.trim()) throw new Error('Skill provisioning requires an owner.');
      if (!skills.length) return { fileIds: [], skills: [] };
      const scope = createHmac('sha256', salt).update(JSON.stringify([userId, creds.baseUrl, creds.key])).digest('hex');
      const fileIds: string[] = [];
      const mounted: MountedSkill[] = [];

      const setupId = await ensureFile(
        creds,
        scope,
        SETUP_FILENAME,
        SKILLS_SETUP_SCRIPT.content,
        () => strToU8(SKILLS_SETUP_SCRIPT.content),
        'text/x-python',
      );
      if (!setupId) return { fileIds: [], skills: [] };
      fileIds.push(setupId);

      for (const skill of skills) {
        const id = await ensureFile(creds, scope, skillZipName(skill), JSON.stringify(skill), () => zipSkill(skill), 'application/zip');
        if (id) {
          fileIds.push(id);
          mounted.push({ name: skill.name, description: skill.description, path: `/mnt/data/skills/${skill.name}/` });
        }
      }
      return { fileIds, skills: mounted };
    },
  };
}
