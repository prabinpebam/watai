import { z } from 'zod';
import { parseOrThrow } from './validate';

export const ALLOWED_CONTENT_TYPES = [
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/gif',
  'audio/webm',
  'audio/mpeg',
  'audio/mp3',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/zip',
] as const;

export type AllowedContentType = (typeof ALLOWED_CONTENT_TYPES)[number];

const EXT: Record<AllowedContentType, string> = {
  'image/png': 'png',
  'image/jpeg': 'jpg',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'audio/webm': 'webm',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'application/pdf': 'pdf',
  'text/plain': 'txt',
  'text/markdown': 'md',
  'text/csv': 'csv',
  'application/json': 'json',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': 'docx',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation': 'pptx',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet': 'xlsx',
  'application/zip': 'zip',
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
