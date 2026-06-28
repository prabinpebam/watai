import { parseMemoryModelConfig, parseSetMemoryModels, type MemoryModelConfigView, type MemoryModelSlot } from '../domain/appConfig';
import type { MemoryJobKind } from '../domain/memoryExtraction';
import type { AppConfigStore } from '../ports/appConfigStore';
import type { ServiceClock } from './threadService';

/**
 * Resolves and manages the server-decided models used for background memory work.
 * Users never select these; an admin can override them at runtime through the admin UI.
 *
 * Two tiers:
 *   - routine (base): command + turn extraction. A lighter/faster model (e.g. gpt-5.4-mini).
 *   - deep:           rebuild/import and heavy reconciliation. A stronger model (e.g. gpt-5.4).
 *
 * Precedence for routine: admin override → MEMORY_MODEL env → user's own chat model.
 * Precedence for deep:    admin override → MEMORY_DEEP_MODEL env → routine model → chat model.
 */
export class MemoryModelService {
  constructor(
    private readonly store: AppConfigStore,
    private readonly baseEnvModel: () => string | undefined,
    private readonly deepEnvModel: () => string | undefined,
    private readonly clock: ServiceClock,
  ) {}

  private baseEnv(): string | undefined {
    return this.baseEnvModel()?.trim() || undefined;
  }

  private deepEnv(): string | undefined {
    return this.deepEnvModel()?.trim() || undefined;
  }

  /** The model passed to the extractor for a given lane, or undefined to use the user's chat model.
   *  `rebuild` jobs use the deep tier; `command`/`turn` jobs use the routine tier. */
  async effectiveModel(mode: MemoryJobKind): Promise<string | undefined> {
    const stored = await this.store.getMemoryConfig().catch(() => null);
    const base = stored?.memoryModel?.trim() || this.baseEnv();
    if (mode !== 'rebuild') return base;
    return stored?.memoryDeepModel?.trim() || this.deepEnv() || base;
  }

  /** Transparent view for the admin UI: both tiers with effective value, source, env default, and override. */
  async getConfig(): Promise<MemoryModelConfigView> {
    const stored = await this.store.getMemoryConfig().catch(() => null);

    const baseEnv = this.baseEnv() ?? null;
    const baseOverride = stored?.memoryModel?.trim() || null;
    const baseModel = baseOverride ?? baseEnv;
    const base: MemoryModelSlot = {
      model: baseModel,
      source: baseOverride ? 'override' : baseEnv ? 'env' : 'chat',
      envDefault: baseEnv,
      override: baseOverride,
    };

    const deepEnv = this.deepEnv() ?? null;
    const deepOverride = stored?.memoryDeepModel?.trim() || null;
    const deepModel = deepOverride ?? deepEnv ?? baseModel;
    const deep: MemoryModelSlot = {
      model: deepModel,
      source: deepOverride ? 'override' : deepEnv ? 'env' : 'base',
      envDefault: deepEnv,
      override: deepOverride,
    };

    return {
      base,
      deep,
      ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      ...(stored?.updatedBy ? { updatedBy: stored.updatedBy } : {}),
    };
  }

  /** Admin write. Non-empty models set overrides; empty strings clear them. */
  async setModels(input: unknown, updatedBy?: string): Promise<MemoryModelConfigView> {
    const { memoryModel, memoryDeepModel } = parseSetMemoryModels(input);
    const base = memoryModel?.trim();
    const deep = memoryDeepModel?.trim();
    const config = parseMemoryModelConfig({
      ...(base ? { memoryModel: base } : {}),
      ...(deep ? { memoryDeepModel: deep } : {}),
      updatedAt: this.clock.now(),
      ...(updatedBy ? { updatedBy } : {}),
    });
    await this.store.putMemoryConfig(config);
    return this.getConfig();
  }
}
