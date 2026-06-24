import { z } from 'zod';
import { parseOrThrow } from './validate';

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
  return parseOrThrow(appendSchema, input, 'Invalid message.');
}
