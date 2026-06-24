import { z } from 'zod';
import { AppError } from './errors';

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'interrupted' | 'error';

const appendSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().min(1).max(200_000),
    model: z.string().min(1).max(100).optional(),
    parentId: z.string().min(1).max(64).optional(),
  })
  .strict();

export type AppendMessageInput = z.infer<typeof appendSchema>;

export function parseAppendMessage(input: unknown): AppendMessageInput {
  const result = appendSchema.safeParse(input);
  if (!result.success) {
    throw new AppError('validation', 'Invalid message.', result.error.flatten());
  }
  return result.data;
}
