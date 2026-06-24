import { z } from 'zod';
import { parseOrThrow } from './validate';

export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXT: Record<AllowedContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
};

export function extForContentType(ct: AllowedContentType): string {
  return EXT[ct];
}

const sasSchema = z
  .object({
    threadId: z.string().min(1).max(64),
    assetId: z.string().min(1).max(64),
    op: z.enum(['read', 'write']),
    contentType: z.enum(ALLOWED_CONTENT_TYPES),
  })
  .strict();

export type SasRequestInput = z.infer<typeof sasSchema>;

export function parseSasRequest(input: unknown): SasRequestInput {
  return parseOrThrow(sasSchema, input, 'Invalid asset request.');
}
