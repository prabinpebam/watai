import { z } from 'zod';
import { parseOrThrow } from './validate';
import { attachmentSchema } from './message';

/** Run lifecycle status. `queued`/`running` are active; the rest are terminal. */
export type RunStatus = 'queued' | 'running' | 'complete' | 'error' | 'canceled';

export interface RunError {
  code: string;
  message: string;
}

const TERMINAL: readonly RunStatus[] = ['complete', 'error', 'canceled'];

export function isTerminal(s: RunStatus): boolean {
  return TERMINAL.includes(s);
}

/** Active = holds the per-thread lock (no second run may start on the thread). */
export function isActive(s: RunStatus): boolean {
  return s === 'queued' || s === 'running';
}

const ALLOWED: Record<RunStatus, readonly RunStatus[]> = {
  queued: ['running', 'error', 'canceled'],
  running: ['complete', 'error', 'canceled'],
  complete: [],
  error: [],
  canceled: [],
};

export function canTransition(from: RunStatus, to: RunStatus): boolean {
  return ALLOWED[from].includes(to);
}

/** Input to start a run: the user's prompt + optional tool allowlist for this run. */
const runInputSchema = z
  .object({
    text: z.string().max(100_000).optional(),
    attachments: z.array(attachmentSchema).max(20).optional(),
    /** Client-supplied id for the user message (idempotent submit). */
    clientMessageId: z.string().min(1).max(64).optional(),
    /** Tools enabled for this run (subset of the configured tools). */
    tools: z.array(z.string().min(1).max(40)).max(20).optional(),
    /** Destructive tools explicitly authorized for this run (see 06 §4). */
    allowDestructive: z.array(z.string().min(1).max(40)).max(10).optional(),
  })
  .strict()
  .refine((o) => !!o.text?.trim() || (o.attachments?.length ?? 0) > 0, {
    message: 'A run needs text or at least one attachment.',
  });

export type RunInput = z.infer<typeof runInputSchema>;

export function parseRunInput(input: unknown): RunInput {
  return parseOrThrow(runInputSchema, input, 'Invalid run request.');
}
