import { parseMemoryModelConfig, parseSetMemoryModel, type MemoryModelConfigView } from '../domain/appConfig';
import type { AppConfigStore } from '../ports/appConfigStore';
import type { ServiceClock } from './threadService';

/**
 * Resolves and manages the server-decided model used for background memory extraction.
 * Users never select this; an admin can override it at runtime through the admin UI.
 *
 * Precedence for the effective model:
 *   1. admin override (stored)         — set via the admin UI, survives redeploys
 *   2. MEMORY_MODEL env default        — baseline shipped with infra
 *   3. undefined → caller falls back to the user's own chat model
 */
export class MemoryModelService {
  constructor(
    private readonly store: AppConfigStore,
    private readonly envModel: () => string | undefined,
    private readonly clock: ServiceClock,
  ) {}

  private env(): string | undefined {
    return this.envModel()?.trim() || undefined;
  }

  /** The model passed to the extractor, or undefined to fall back to the user's chat model. */
  async effectiveModel(): Promise<string | undefined> {
    const stored = await this.store.getMemoryConfig().catch(() => null);
    return stored?.memoryModel?.trim() || this.env();
  }

  /** Transparent view for the admin UI: effective value, source, env default, and override. */
  async getConfig(): Promise<MemoryModelConfigView> {
    const stored = await this.store.getMemoryConfig().catch(() => null);
    const env = this.env() ?? null;
    const override = stored?.memoryModel?.trim() || null;
    const effective = override ?? env;
    const source = override ? 'override' : env ? 'env' : 'chat';
    return {
      memoryModel: effective,
      source,
      envDefault: env,
      override,
      ...(stored?.updatedAt ? { updatedAt: stored.updatedAt } : {}),
      ...(stored?.updatedBy ? { updatedBy: stored.updatedBy } : {}),
    };
  }

  /** Admin write. A non-empty model sets the override; an empty string clears it. */
  async setModel(input: unknown, updatedBy?: string): Promise<MemoryModelConfigView> {
    const { memoryModel } = parseSetMemoryModel(input);
    const trimmed = memoryModel?.trim();
    const config = parseMemoryModelConfig({
      ...(trimmed ? { memoryModel: trimmed } : {}),
      updatedAt: this.clock.now(),
      ...(updatedBy ? { updatedBy } : {}),
    });
    await this.store.putMemoryConfig(config);
    return this.getConfig();
  }
}
