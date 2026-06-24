import { z } from 'zod';
import { parseOrThrow } from './validate';

const emailSchema = z.string().trim().toLowerCase().email().max(320);

const createInviteSchema = z.object({ email: emailSchema }).strict();

export type CreateInviteInput = z.infer<typeof createInviteSchema>;

export function parseCreateInvite(input: unknown): CreateInviteInput {
  return parseOrThrow(createInviteSchema, input, 'Invalid invite.');
}

/** Normalize an email for stable allowlist comparison (trim + lowercase). */
export function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}
