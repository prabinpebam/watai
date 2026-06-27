import { AppError } from '../domain/errors';
import {
  parseSkillFrontmatter,
  type SkillFile,
  type SkillIssue,
  type SkillPackage,
  type SkillStatus,
} from '../domain/skill';
import { DEFAULT_SKILLS } from '../skills';
import { zipSkill, unzipToPackage } from './skillPackager';
import type { ServiceClock } from './threadService';
import type { SkillBlobStore } from '../ports/skillBlobStore';
import {
  isDefaultToggle,
  isUserSkill,
  type SkillStore,
  type UserSkillRecord,
} from '../ports/skillStore';

export type SkillSource = 'default' | 'user';

/** Catalog row (matches the client `SkillSummary`). */
export interface SkillSummary {
  id: string;
  name: string;
  description: string;
  source: SkillSource;
  version: number;
  enabled: boolean;
  status: SkillStatus;
  error?: string;
  bytes?: number;
  fileCount?: number;
}

export interface SkillFileEntry {
  path: string;
  bytes: number;
}

/** Full detail (matches the client `SkillDetail`). */
export interface SkillDetail extends SkillSummary {
  license?: string;
  files: SkillFileEntry[];
  body: string;
}

const DEFAULT_PREFIX = 'default:';
const MAX_USER_SKILLS = 10;
const MAX_ZIP_BYTES = 50 * 1024 * 1024;

function fileSize(f: SkillFile): number {
  if (typeof f.text === 'string') return Buffer.byteLength(f.text, 'utf8');
  if (typeof f.base64 === 'string') return Buffer.from(f.base64, 'base64').length;
  return 0;
}

/** A 400 with the full issue list in `details` (the UI renders the field-referenced errors). */
function validationError(issues: SkillIssue[]): AppError {
  return new AppError('validation', issues[0]?.message ?? 'Invalid skill package.', issues);
}

function notFound(): AppError {
  return new AppError('not_found', 'Skill not found.');
}

/**
 * The per-user skill catalog: default (service-provided, toggle-off) skills plus user-uploaded
 * skills, with full CRUD. Resolves the effective skill set a run sees (defaults−disabled ⊎
 * enabled+ready user skills, user wins on name collision). Validation is server-authoritative
 * (`unzipToPackage`); user zips live in Blob, records in Cosmos.
 */
export class SkillCatalogService {
  private readonly defaults: SkillPackage[];

  constructor(
    private readonly store: SkillStore,
    private readonly blobs: SkillBlobStore,
    private readonly clock: ServiceClock,
    defaults: SkillPackage[] = DEFAULT_SKILLS,
  ) {
    this.defaults = defaults;
  }

  // --- queries ------------------------------------------------------------

  /** The catalog list: every default (with the user's effective enabled state) + user skills. */
  async list(userId: string): Promise<SkillSummary[]> {
    const records = await this.store.list(userId);
    const disabled = new Set(records.filter(isDefaultToggle).map((t) => t.skillId));
    const defaults = this.defaults.map((pkg) => this.defaultSummary(pkg, disabled.has(pkg.name)));
    const users = records.filter(isUserSkill).map((r) => this.userSummary(r));
    return [...defaults, ...users];
  }

  /** Full detail for the preview dialog (file tree + SKILL.md body). */
  async getDetail(userId: string, id: string): Promise<SkillDetail> {
    if (id.startsWith(DEFAULT_PREFIX)) {
      const pkg = this.findDefault(id.slice(DEFAULT_PREFIX.length));
      if (!pkg) throw notFound();
      const disabled = await this.isDefaultDisabled(userId, pkg.name);
      return this.detailFromPackage(this.defaultSummary(pkg, disabled), pkg);
    }
    const record = await this.requireUserSkill(userId, id);
    const summary = this.userSummary(record);
    const pkg = await this.loadUserPackage(record).catch(() => null);
    if (!pkg) return { ...summary, files: [], body: '' };
    return this.detailFromPackage(summary, pkg);
  }

  /** A short-lived download URL for a user skill's zip (defaults have none). */
  async download(userId: string, id: string): Promise<{ url: string }> {
    if (id.startsWith(DEFAULT_PREFIX)) throw notFound();
    const record = await this.requireUserSkill(userId, id);
    return { url: await this.blobs.readUrl(record.blobPath) };
  }

  // --- mutations ----------------------------------------------------------

  /** Upload a new user skill zip. Validates, stores the normalized zip + record. */
  async upload(userId: string, filename: string, bytes: Uint8Array): Promise<SkillSummary> {
    const pkg = this.validateUpload(filename, bytes);
    const records = await this.store.list(userId);
    const userSkills = records.filter(isUserSkill);
    if (userSkills.some((r) => r.name === pkg.name)) {
      throw new AppError('conflict', `You already have a skill named "${pkg.name}".`);
    }
    if (userSkills.length >= MAX_USER_SKILLS) {
      throw new AppError('conflict', `You've reached ${MAX_USER_SKILLS} custom skills — delete one to add another.`);
    }
    const id = this.clock.newId();
    const blobPath = `skills/${userId}/${id}.zip`;
    const normalized = zipSkill(pkg);
    await this.blobs.put(blobPath, normalized);
    const now = this.clock.now();
    const record: UserSkillRecord = {
      id,
      userId,
      kind: 'user',
      name: pkg.name,
      description: pkg.description,
      ...(pkg.license ? { license: pkg.license } : {}),
      version: 1,
      enabled: true,
      status: 'ready',
      blobPath,
      bytes: normalized.byteLength,
      fileCount: pkg.files.length,
      createdAt: now,
      updatedAt: now,
    };
    await this.store.put(record);
    return this.userSummary(record);
  }

  /** Replace a user skill's zip: re-validate, bump version, overwrite the blob. */
  async replace(userId: string, id: string, filename: string, bytes: Uint8Array): Promise<SkillSummary> {
    const record = await this.requireUserSkill(userId, id);
    const pkg = this.validateUpload(filename, bytes);
    const records = await this.store.list(userId);
    if (records.filter(isUserSkill).some((r) => r.id !== id && r.name === pkg.name)) {
      throw new AppError('conflict', `You already have a skill named "${pkg.name}".`);
    }
    const normalized = zipSkill(pkg);
    await this.blobs.put(record.blobPath, normalized);
    const updated: UserSkillRecord = {
      ...record,
      name: pkg.name,
      description: pkg.description,
      ...(pkg.license ? { license: pkg.license } : { license: undefined }),
      version: record.version + 1,
      status: 'ready',
      error: undefined,
      bytes: normalized.byteLength,
      fileCount: pkg.files.length,
      updatedAt: this.clock.now(),
    };
    await this.store.put(updated);
    return this.userSummary(updated);
  }

  /** Enable/disable a default (toggle doc) or a user skill (record flag). */
  async setEnabled(userId: string, id: string, enabled: boolean): Promise<SkillSummary> {
    if (id.startsWith(DEFAULT_PREFIX)) {
      const pkg = this.findDefault(id.slice(DEFAULT_PREFIX.length));
      if (!pkg) throw notFound();
      if (enabled) {
        await this.store.remove(userId, id);
      } else {
        await this.store.put({ id, userId, kind: 'default-off', skillId: pkg.name, updatedAt: this.clock.now() });
      }
      return this.defaultSummary(pkg, !enabled);
    }
    const record = await this.requireUserSkill(userId, id);
    if (enabled && record.status !== 'ready') {
      throw new AppError('validation', "This skill is invalid and can't be enabled — replace it with a fixed zip.");
    }
    const updated: UserSkillRecord = { ...record, enabled, updatedAt: this.clock.now() };
    await this.store.put(updated);
    return this.userSummary(updated);
  }

  /** Delete a user skill (blob + record). Defaults can't be deleted (409 — disable instead). */
  async remove(userId: string, id: string): Promise<void> {
    if (id.startsWith(DEFAULT_PREFIX)) {
      throw new AppError('conflict', "Default skills can't be deleted — turn it off instead.");
    }
    const record = await this.requireUserSkill(userId, id);
    await this.blobs.remove(record.blobPath).catch(() => undefined);
    await this.store.remove(userId, id);
  }

  // --- run-time resolution ------------------------------------------------

  /** The effective skill set a run provisions: defaults−disabled ⊎ enabled+ready user skills,
   *  with a user skill shadowing a same-named default. */
  async effective(userId: string): Promise<SkillPackage[]> {
    const records = await this.store.list(userId);
    const disabled = new Set(records.filter(isDefaultToggle).map((t) => t.skillId));
    const byName = new Map<string, SkillPackage>();
    for (const pkg of this.defaults) if (!disabled.has(pkg.name)) byName.set(pkg.name, pkg);
    for (const r of records.filter(isUserSkill)) {
      if (!r.enabled || r.status !== 'ready') continue;
      const pkg = await this.loadUserPackage(r).catch(() => null);
      if (pkg) byName.set(r.name, pkg); // user wins on name collision
    }
    return [...byName.values()];
  }

  // --- internals ----------------------------------------------------------

  private validateUpload(filename: string, bytes: Uint8Array): SkillPackage {
    if (!/\.zip$/i.test(filename)) {
      throw validationError([{ rule: 'envelope', message: 'Upload a .zip archive in the Agent Skills format.' }]);
    }
    if (bytes.byteLength > MAX_ZIP_BYTES) {
      const mb = (bytes.byteLength / 1024 / 1024).toFixed(1);
      throw validationError([{ rule: 'size', message: `Too large (${mb} MB) — the limit is ${MAX_ZIP_BYTES / 1024 / 1024} MB.` }]);
    }
    const { package: pkg, issues } = unzipToPackage(bytes);
    if (!pkg) throw validationError(issues);
    return pkg;
  }

  private async requireUserSkill(userId: string, id: string): Promise<UserSkillRecord> {
    const record = await this.store.get(userId, id);
    if (!record || !isUserSkill(record)) throw notFound();
    return record;
  }

  private async loadUserPackage(record: UserSkillRecord): Promise<SkillPackage> {
    const bytes = await this.blobs.get(record.blobPath);
    const { package: pkg } = unzipToPackage(bytes);
    if (!pkg) throw new Error('stored skill zip is no longer valid');
    return { ...pkg, version: record.version };
  }

  private findDefault(name: string): SkillPackage | undefined {
    return this.defaults.find((p) => p.name === name);
  }

  private async isDefaultDisabled(userId: string, name: string): Promise<boolean> {
    const toggle = await this.store.get(userId, `${DEFAULT_PREFIX}${name}`);
    return !!toggle;
  }

  private defaultSummary(pkg: SkillPackage, disabled: boolean): SkillSummary {
    return {
      id: `${DEFAULT_PREFIX}${pkg.name}`,
      name: pkg.name,
      description: pkg.description,
      source: 'default',
      version: pkg.version,
      enabled: !disabled,
      status: 'ready',
    };
  }

  private userSummary(r: UserSkillRecord): SkillSummary {
    return {
      id: r.id,
      name: r.name,
      description: r.description,
      source: 'user',
      version: r.version,
      enabled: r.enabled,
      status: r.status,
      ...(r.error ? { error: r.error } : {}),
      bytes: r.bytes,
      fileCount: r.fileCount,
    };
  }

  private detailFromPackage(summary: SkillSummary, pkg: SkillPackage): SkillDetail {
    const files: SkillFileEntry[] = pkg.files.map((f) => ({ path: f.path, bytes: fileSize(f) }));
    const skillMd = pkg.files.find((f) => f.path === 'SKILL.md');
    const body = skillMd?.text ? parseSkillFrontmatter(skillMd.text)?.body ?? skillMd.text : '';
    return {
      ...summary,
      ...(pkg.license ? { license: pkg.license } : {}),
      files,
      body,
    };
  }
}
