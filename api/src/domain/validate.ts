import type { z } from 'zod';
import { AppError } from './errors';

/** Validate `input` against `schema`, throwing a uniform `validation` AppError on failure. */
export function parseOrThrow<S extends z.ZodTypeAny>(
  schema: S,
  input: unknown,
  message = 'Invalid request body.',
): z.infer<S> {
  const result = schema.safeParse(input);
  if (!result.success) {
    throw new AppError('validation', message, result.error.flatten());
  }
  return result.data;
}
