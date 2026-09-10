import { z } from 'zod';
import { parseOrThrow } from './validate';
import { libraryItemIdFor } from './library';

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

export function canonicalAttachmentBlobPath(
  userId: string,
  threadId: string,
  assetId: string,
  contentType: AllowedContentType,
  temporary: boolean,
): string {
  const ext = extForContentType(contentType);
  if (temporary) return `${userId}/${threadId}/${assetId}.${ext}`;
  return `${userId}/library/${libraryItemIdFor(userId, 'chat_attachment', assetId)}.${ext}`;
}

export function isOwnerBlobPath(userId: string, blobPath: string, threadId?: string): boolean {
  if (!userId || !blobPath || blobPath.includes('\\')) return false;
  const segments = blobPath.split('/');
  if (segments.length < 3 || segments.some((segment) => !segment || segment === '.' || segment === '..')) return false;
  if (segments[0] !== userId) return false;
  return segments[1] === 'library' || segments[1] === 'images' || (!!threadId && segments[1] === threadId);
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
