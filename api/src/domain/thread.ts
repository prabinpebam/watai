import { z } from 'zod';
import { AppError } from './errors';

const title = z.string().min(1).max(200);

const createSchema = z
  .object({
    title: title.default('New chat'),
    temporary: z.boolean().default(false),
  })
  .strict();

const updateSchema = z
  .object({
    title: title.optional(),
    pinned: z.boolean().optional(),
    archived: z.boolean().optional(),
  })
  .strict()
  .refine((o) => Object.keys(o).length > 0, { message: 'At least one field is required.' });

export type CreateThreadInput = z.infer<typeof createSchema>;
export type UpdateThreadInput = z.infer<typeof updateSchema>;

function parse<S extends z.ZodTypeAny>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('validation', 'Invalid request body.', result.error.flatten());
  }
  return result.data;
}

export function parseCreateThread(input: unknown): CreateThreadInput {
  return parse(createSchema, input);
}

export function parseUpdateThread(input: unknown): UpdateThreadInput {
  return parse(updateSchema, input);
}
