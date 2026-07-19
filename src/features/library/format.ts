import type { LibraryItemDTO, LibraryKind, LibraryOrigin } from '../../data/cloud/types';

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`;
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`;
}

export function formatDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
}

export function itemTitle(item: LibraryItemDTO): string {
  return item.userMetadata?.title ?? item.image?.prompt ?? item.name;
}

export function kindLabel(kind: LibraryKind): string {
  const labels: Record<LibraryKind, string> = {
    image: 'Image',
    pdf: 'PDF',
    document: 'Document',
    spreadsheet: 'Spreadsheet',
    presentation: 'Presentation',
    data: 'Data',
    audio: 'Audio',
    archive: 'Archive',
    code: 'Code',
    text: 'Text',
    other: 'File',
  };
  return labels[kind];
}

export function originLabel(origin: LibraryOrigin): string {
  const labels: Record<LibraryOrigin, string> = {
    chat_upload: 'Uploaded in chat',
    library_upload: 'Uploaded to Library',
    chat_generated_image: 'Created in chat',
    studio_generated_image: 'Created in Image Studio',
    code_artifact: 'Created by Watai',
    thread_document: 'Added to chat knowledge',
  };
  return labels[origin];
}

export function iconForKind(kind: LibraryKind): string {
  if (kind === 'image') return 'file-image';
  if (kind === 'pdf') return 'file-pdf';
  if (kind === 'code') return 'file-code';
  if (kind === 'spreadsheet' || kind === 'data') return 'file-csv';
  if (kind === 'archive') return 'file-zip';
  if (kind === 'audio') return 'file-audio';
  return 'file-text';
}
