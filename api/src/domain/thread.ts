import { z } from 'zod';
import { parseOrThrow } from './validate';

const title = z.string().min(1).max(200);
const vectorStoreId = z.string().min(1).max(128);

const createSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    title: title.default('New chat'),
    temporary: z.boolean().default(false),
    vectorStoreId: vectorStoreId.optional(),
  })
  .strict();

const updateSchema = z
  .object({
    title: title.optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
    vectorStoreId: vectorStoreId.optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required.' });

export type CreateThreadInput = z.infer<typeof createSchema>;
export type UpdateThreadInput = z.infer<typeof updateSchema>;

export function parseCreateThread(input: unknown): CreateThreadInput {
  return parseOrThrow(createSchema, input);
}

export function parseUpdateThread(input: unknown): UpdateThreadInput {
  return parseOrThrow(updateSchema, input);
}
