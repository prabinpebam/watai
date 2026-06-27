import { strToU8 } from 'fflate';
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
  ensure(creds: AoaiCreds, skills: SkillPackage[]): Promise<ProvisionResult>;
}

const SETUP_FILENAME = SKILLS_SETUP_SCRIPT.filename;
function skillZipName(s: SkillPackage): string {
  return `watai-skill.${s.name}.v${s.version}.zip`;
}

/**
 * Provisions skills onto a user's own Azure endpoint (Files API) and reuses them across all
 * threads — "global, not thread-scoped". A skill's zip + the bootstrap script are uploaded once
 * per endpoint (matched by filename) and the file_ids are mounted into the code-interpreter
 * container. The per-endpoint file index is memoized for this worker instance to avoid re-listing.
 */
export function createSkillProvisioner(files: AoaiFiles): SkillProvisioner {
  // endpoint baseUrl -> (filename -> fileId)
  const index = new Map<string, Map<string, string>>();
  const inflight = new Map<string, Promise<Map<string, string>>>();

  async function fileIndex(creds: AoaiCreds): Promise<Map<string, string>> {
    const key = creds.baseUrl;
    const cached = index.get(key);
    if (cached) return cached;
    let p = inflight.get(key);
    if (!p) {
      p = (async () => {
        const list = await files.listFiles(creds, { limit: 10000 }).catch(() => []);
        const map = new Map<string, string>();
        for (const f of list) if (f.filename) map.set(f.filename, f.id);
        index.set(key, map);
        return map;
      })();
      inflight.set(key, p);
      void p.finally(() => inflight.delete(key));
    }
    return p;
  }

  async function ensureFile(
    creds: AoaiCreds,
    map: Map<string, string>,
    filename: string,
    bytes: Uint8Array,
    mime: string,
  ): Promise<string | null> {
    const existing = map.get(filename);
    if (existing) return existing;
    try {
      const { id } = await files.uploadFile(creds, { bytes, filename, mime });
      map.set(filename, id);
      return id;
    } catch {
      return null; // a failed upload just drops that skill from this run
    }
  }

  return {
    async ensure(creds, skills) {
      if (!skills.length) return { fileIds: [], skills: [] };
      const map = await fileIndex(creds);
      const fileIds: string[] = [];
      const mounted: MountedSkill[] = [];

      const setupId = await ensureFile(
        creds,
        map,
        SETUP_FILENAME,
        strToU8(SKILLS_SETUP_SCRIPT.content),
        'text/x-python',
      );
      if (setupId) fileIds.push(setupId);

      for (const s of skills) {
        const id = await ensureFile(creds, map, skillZipName(s), zipSkill(s), 'application/zip');
        if (id) {
          fileIds.push(id);
          mounted.push({ name: s.name, description: s.description, path: `/mnt/data/skills/${s.name}/` });
        }
      }
      return { fileIds, skills: mounted };
    },
  };
}
