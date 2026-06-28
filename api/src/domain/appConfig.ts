import { z } from 'zod';
import { parseOrThrow } from './validate';

/** A model deployment name (e.g. `gpt-5.4-mini`). Mirrors the credentials deployment bound. */
const deployment = z.string().trim().min(1).max(100);
const iso = z.string().trim().min(1).max(40);

/**
 * Persisted global memory-model overrides, set by an admin. Two tiers:
 *  - `memoryModel`: routine background extraction (a lighter/faster model).
 *  - `memoryDeepModel`: heavier operations (rebuilds, merges, conflict resolution).
 * An absent value means "no override" — the server falls back to the env default,
 * then (for routine) the user's chat model, or (for deep) the routine model.
 */
const memoryModelConfigSchema = z
  .object({
    memoryModel: deployment.optional(),
    memoryDeepModel: deployment.optional(),
    updatedAt: iso,
    updatedBy: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type MemoryModelConfig = z.infer<typeof memoryModelConfigSchema>;

/** Admin write: a non-empty deployment sets the override; an empty string clears it. */
const setMemoryModelsSchema = z
  .object({
    memoryModel: z.union([deployment, z.literal('')]).optional(),
    memoryDeepModel: z.union([deployment, z.literal('')]).optional(),
  })
  .strict();

export type SetMemoryModelsInput = z.infer<typeof setMemoryModelsSchema>;

/** Where an effective model value comes from, for transparent admin UI.
 *  `chat` = falls back to the user's chat model (routine only).
 *  `base` = falls back to the routine model (deep only). */
export type MemoryModelSource = 'override' | 'env' | 'chat' | 'base';

/** One resolved model tier (routine or deep). */
export interface MemoryModelSlot {
  /** Effective model for this tier, or null when it falls back to the user's chat model. */
  model: string | null;
  source: MemoryModelSource;
  /** The env default for this tier, if any. */
  envDefault: string | null;
  /** The admin override for this tier, if set. */
  override: string | null;
}

/** Resolved view returned to the admin UI. */
export interface MemoryModelConfigView {
  /** Routine background extraction model (command + turn lanes). */
  base: MemoryModelSlot;
  /** Heavy operations model (rebuild/import, merges, conflict resolution). */
  deep: MemoryModelSlot;
  updatedAt?: string;
  updatedBy?: string;
}

export function parseMemoryModelConfig(input: unknown): MemoryModelConfig {
  return parseOrThrow(memoryModelConfigSchema, input, 'Invalid memory model config.');
}

export function parseSetMemoryModels(input: unknown): SetMemoryModelsInput {
  return parseOrThrow(setMemoryModelsSchema, input, 'Invalid memory model update.');
}
