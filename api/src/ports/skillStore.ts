import type { SkillStatus } from '../domain/skill';

/** A user-uploaded skill record. One Cosmos doc, partition key `/userId`. */
export interface UserSkillRecord {
  id: string;
  userId: string;
  kind: 'user';
  /** Frontmatter `name` (unique per user). */
  name: string;
  description: string;
  license?: string;
  /** Bumped on each replace so the per-endpoint provisioning re-uploads. */
  version: number;
  enabled: boolean;
  status: SkillStatus;
  /** First validation problem when `status === 'invalid'`. */
  error?: string;
  /** Where the normalized zip lives in Blob (`skills/{userId}/{id}.zip`). */
  blobPath: string;
  bytes: number;
  fileCount: number;
  createdAt: string;
  updatedAt: string;
}

/** A "default skill disabled" marker. Present ONLY when the user turned a default OFF. */
export interface DefaultToggleRecord {
  /** `default:<skillName>` — also the catalog id the UI uses for the default row. */
  id: string;
  userId: string;
  kind: 'default-off';
  /** The default skill's name (e.g. `pdf`). */
  skillId: string;
  updatedAt: string;
}

export type SkillRecord = UserSkillRecord | DefaultToggleRecord;

export function isUserSkill(r: SkillRecord): r is UserSkillRecord {
  return r.kind === 'user';
}
export function isDefaultToggle(r: SkillRecord): r is DefaultToggleRecord {
  return r.kind === 'default-off';
}

/** Persistence for skill catalog records (user skills + default-off toggles), per user. */
export interface SkillStore {
  list(userId: string): Promise<SkillRecord[]>;
  get(userId: string, id: string): Promise<SkillRecord | null>;
  put(record: SkillRecord): Promise<void>;
  remove(userId: string, id: string): Promise<void>;
}
