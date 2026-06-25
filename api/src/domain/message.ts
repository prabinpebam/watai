import { z } from 'zod';
import { parseOrThrow } from './validate';

export type Role = 'user' | 'assistant' | 'system';
export type MessageStatus = 'complete' | 'interrupted' | 'error';

/** A generated/attached image's cloud metadata (the bytes live in Blob Storage at `blobPath`). */
const imageSchema = z
  .object({
    id: z.string().min(1).max(64),
    blobPath: z.string().min(1).max(512),
    prompt: z.string().max(8000).default(''),
    size: z.string().min(1).max(32),
    outputFormat: z.enum(['png', 'jpeg', 'webp']),
    createdAt: z.string().min(1).max(40),
  })
  .strict();

export type MessageImage = z.infer<typeof imageSchema>;

/** Bounded, secret-free record of one tool invocation (agentic transcript). */
const toolCallSchema = z
  .object({
    id: z.string().min(1).max(64),
    kind: z.enum(['function', 'web_search', 'code_interpreter', 'file_search', 'image']),
    name: z.string().max(100).optional(),
    status: z.enum(['running', 'done', 'error']),
    summary: z.string().max(400).optional(),
  })
  .strict();

export type MessageToolCall = z.infer<typeof toolCallSchema>;

/** A grounding citation (web url_citation or file_citation). */
const citationSchema = z
  .object({
    url: z.string().url().max(2048).optional(),
    title: z.string().max(400).optional(),
    source: z.enum(['web', 'file']).optional(),
    filename: z.string().max(256).optional(),
  })
  .strict();

export type MessageCitation = z.infer<typeof citationSchema>;

const appendSchema = z
  .object({
    id: z.string().min(1).max(64).optional(),
    role: z.enum(['user', 'assistant', 'system']),
    content: z.string().max(200_000),
    model: z.string().min(1).max(100).optional(),
    parentId: z.string().min(1).max(64).optional(),
    images: z.array(imageSchema).max(16).optional(),
    toolCalls: z.array(toolCallSchema).max(32).optional(),
    citations: z.array(citationSchema).max(64).optional(),
  })
  .strict()
  // Allow image-only messages (no text), but reject fully-empty ones.
  .refine((m) => m.content.trim().length > 0 || (m.images?.length ?? 0) > 0, {
    message: 'A message must have text or at least one image.',
  });

export type AppendMessageInput = z.infer<typeof appendSchema>;

export function parseAppendMessage(input: unknown): AppendMessageInput {
  return parseOrThrow(appendSchema, input, 'Invalid message.');
}
