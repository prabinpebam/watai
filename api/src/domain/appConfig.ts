import { z } from 'zod';
import { parseOrThrow } from './validate';

/** A model deployment name (e.g. `gpt-5.4-mini`). Mirrors the credentials deployment bound. */
const deployment = z.string().trim().min(1).max(100);
const iso = z.string().trim().min(1).max(40);

/** Persisted global memory-model override, set by an admin. Absent `memoryModel` means
 *  "no override" — the server falls back to the MEMORY_MODEL env default, then the user's chat model. */
const memoryModelConfigSchema = z
  .object({
    memoryModel: deployment.optional(),
    updatedAt: iso,
    updatedBy: z.string().trim().min(1).max(200).optional(),
  })
  .strict();

export type MemoryModelConfig = z.infer<typeof memoryModelConfigSchema>;

/** Admin write: a non-empty deployment sets the override; an empty string clears it. */
const setMemoryModelSchema = z
  .object({
    memoryModel: z.union([deployment, z.literal('')]).optional(),
  })
  .strict();

export type SetMemoryModelInput = z.infer<typeof setMemoryModelSchema>;

/** Where the effective memory model comes from, for transparent admin UI. */
export type MemoryModelSource = 'override' | 'env' | 'chat';

/** Resolved view returned to the admin UI. */
export interface MemoryModelConfigView {
  /** The effective model used for memory extraction, or null when it falls back to the user's chat model. */
  memoryModel: string | null;
  /** Whether the effective value comes from the admin override, the env default, or the per-user chat model. */
  source: MemoryModelSource;
  /** The MEMORY_MODEL env default, if any (shown as the fallback below an override). */
  envDefault: string | null;
  /** The admin override deployment, if set. */
  override: string | null;
  updatedAt?: string;
  updatedBy?: string;
}

export function parseMemoryModelConfig(input: unknown): MemoryModelConfig {
  return parseOrThrow(memoryModelConfigSchema, input, 'Invalid memory model config.');
}

export function parseSetMemoryModel(input: unknown): SetMemoryModelInput {
  return parseOrThrow(setMemoryModelSchema, input, 'Invalid memory model update.');
}
