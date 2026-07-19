import { cloudApi } from '../../data';
import type { LibraryItemDTO } from '../../data/cloud/types';
import { isImageUpload, normalizeImageUpload } from '../../lib/imageUpload';
import type { LibraryReadApi } from './LibraryApi';

const MIME_BY_EXTENSION: Record<string, string> = {
  pdf: 'application/pdf', txt: 'text/plain', md: 'text/markdown', markdown: 'text/markdown',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  csv: 'text/csv', json: 'application/json',
  xlsx: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  webm: 'audio/webm', mp3: 'audio/mpeg', zip: 'application/zip',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
};

function resolvedMime(file: File): string {
  if (file.type) return file.type.toLowerCase();
  const extension = file.name.split('.').pop()?.toLowerCase() ?? '';
  return MIME_BY_EXTENSION[extension] ?? '';
}

async function sha256(file: File): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return `sha256:${[...new Uint8Array(digest)].map((byte) => byte.toString(16).padStart(2, '0')).join('')}`;
}

export async function prepareLibraryUpload(file: File): Promise<File> {
  const prepared = isImageUpload(file) ? await normalizeImageUpload(file) : file;
  const mime = resolvedMime(prepared);
  if (!mime) throw new Error('This file type is not supported by Library upload.');
  return prepared.type === mime ? prepared : new File([prepared], prepared.name, { type: mime, lastModified: prepared.lastModified });
}

export async function uploadToLibrary(file: File, onProgress?: (progress: number) => void, api: Pick<LibraryReadApi, 'reserveLibraryUpload' | 'completeLibraryUpload'> = cloudApi): Promise<LibraryItemDTO> {
  const prepared = await prepareLibraryUpload(file);
  const contentHash = await sha256(prepared);
  const reservation = await api.reserveLibraryUpload({ name: prepared.name, mime: prepared.type, bytes: prepared.size, contentHash });
  onProgress?.(15);
  let response: Response | undefined;
  for (let attempt = 0; attempt < 2; attempt++) {
    response = await fetch(reservation.upload.url, { method: 'PUT', headers: reservation.upload.headers, body: prepared });
    if (response.ok) break;
  }
  if (!response?.ok) throw new Error('The file could not be uploaded.');
  onProgress?.(85);
  const item = await api.completeLibraryUpload(reservation.item.id, { bytes: prepared.size, contentHash });
  onProgress?.(100);
  return item;
}
