import { describe, expect, it } from 'vitest';
import { buildLibraryInventory, type LibraryInventoryInput } from './libraryInventory';
import type { MessageRecord } from '../ports/messageStore';
import type { ThreadRecord } from '../ports/threadStore';
import type { ImageGenRecord } from '../ports/imageStore';

const NOW = '2026-07-19T12:00:00.000Z';

function thread(id: string, temporary = false): ThreadRecord {
  return {
    id,
    userId: 'user-1',
    title: id,
    pinned: false,
    archived: false,
    temporary,
    messageCount: 0,
    createdAt: NOW,
    updatedAt: NOW,
    deletedAt: null,
  };
}

function message(id: string, threadId: string, extras: Partial<MessageRecord>): MessageRecord {
  return {
    id,
    threadId,
    userId: 'user-1',
    role: 'user',
    content: '',
    status: 'complete',
    createdAt: NOW,
    deletedAt: null,
    ...extras,
  };
}

function studio(id: string, blobPath: string): ImageGenRecord {
  return {
    id,
    userId: 'user-1',
    batchId: 'batch-1',
    status: 'ready',
    prompt: 'studio image',
    size: '1024x1024',
    outputFormat: 'png',
    model: 'gpt-image',
    blobPath,
    createdAt: NOW,
    updatedAt: NOW,
  };
}

function baseInput(): LibraryInventoryInput {
  const normal = thread('thread-1');
  normal.files = [
    { fileId: 'service-doc', name: 'service.pdf', bytes: 20, status: 'ready', kind: 'document', createdAt: NOW },
    { fileId: 'original-doc', name: 'original.pdf', bytes: 30, status: 'ready', kind: 'document', createdAt: NOW, blobPath: 'user-1/thread-1/original.pdf', mime: 'application/pdf' },
  ];
  return {
    generatedAt: NOW,
    threads: [normal, thread('temp-1', true)],
    messages: [
      message('m1', 'thread-1', {
        attachments: [{ id: 'att-1', kind: 'image', blobPath: 'user-1/thread-1/att-1.png', mime: 'image/png', bytes: 10 }],
        images: [{ id: 'img-1', blobPath: 'user-1/thread-1/img-1.png', prompt: 'image', size: '1024x1024', outputFormat: 'png', createdAt: NOW }],
        artifacts: [{ id: 'art-1', name: 'report.pdf', mime: 'application/pdf', kind: 'pdf', bytes: 40, blobPath: 'user-1/thread-1/art-1.pdf', createdAt: NOW }],
      }),
      message('m2', 'temp-1', {
        attachments: [{ id: 'temp-att', kind: 'file', blobPath: 'user-1/temp-1/temp.txt', mime: 'text/plain', bytes: 5 }],
      }),
    ],
    studioImages: [studio('studio-1', 'user-1/images/studio-1.png')],
    blobs: [
      { name: 'user-1/thread-1/att-1.png', bytes: 10, contentType: 'image/png' },
      { name: 'user-1/thread-1/img-1.png', bytes: 50, contentType: 'image/png' },
      { name: 'user-1/thread-1/art-1.pdf', bytes: 40, contentType: 'application/pdf' },
      { name: 'user-1/thread-1/original.pdf', bytes: 30, contentType: 'application/pdf' },
      { name: 'user-1/temp-1/temp.txt', bytes: 5, contentType: 'text/plain' },
      { name: 'user-1/images/studio-1.png', bytes: 60, contentType: 'image/png' },
      { name: 'skills/user-1/skill.zip', bytes: 7, contentType: 'application/zip' },
    ],
  };
}

describe('Library inventory', () => {
  it('classifies all eligible sources, exclusions, path families, and lineage gaps', () => {
    const report = buildLibraryInventory(baseInput());
    expect(report.summary).toMatchObject({
      eligibleItems: 5,
      missingBlobItems: 0,
      orphanBlobs: 0,
      temporaryExcludedItems: 1,
      serviceOnlyDocuments: 1,
      partialProvenanceItems: 2,
      duplicateIngestionKeys: 0,
      duplicateProposedIds: 0,
      unknownPathBlobs: 0,
    });
    expect(report.candidates.map((candidate) => candidate.origin).sort()).toEqual([
      'chat_generated_image',
      'chat_upload',
      'code_artifact',
      'studio_generated_image',
      'thread_document',
    ]);
    expect(report.pathFamilies).toMatchObject({
      thread: { count: 5, bytes: 135 },
      studio: { count: 1, bytes: 60 },
      skills: { count: 1, bytes: 7 },
    });
    expect(report.gates.passed).toBe(true);
  });

  it('fails dry-run gates and reports missing, orphan, and unknown blobs without deleting them', () => {
    const input = baseInput();
    input.blobs = input.blobs.filter((blob) => !blob.name.endsWith('art-1.pdf'));
    input.blobs.push(
      { name: 'user-1/thread-9/orphan.bin', bytes: 99 },
      { name: 'unknown.bin', bytes: 12 },
    );
    const report = buildLibraryInventory(input);
    expect(report.gates.passed).toBe(false);
    expect(report.missingBlobItems.map((item) => item.sourceId)).toEqual(['art-1']);
    expect(report.orphanBlobs.map((blob) => blob.name).sort()).toEqual(['unknown.bin', 'user-1/thread-9/orphan.bin']);
    expect(report.pathFamilies.unknown.count).toBe(1);
  });

  it('detects duplicate logical ingestion keys and physical blob references', () => {
    const input = baseInput();
    input.messages.push(message('m3', 'thread-1', {
      attachments: [{ id: 'att-1', kind: 'image', blobPath: 'user-1/thread-1/att-1.png', mime: 'image/png', bytes: 10 }],
    }));
    const report = buildLibraryInventory(input);
    expect(report.duplicateIngestionKeys).toEqual(['chat_attachment:att-1']);
    expect(report.duplicateProposedIds).toHaveLength(1);
    expect(report.duplicateBlobReferences).toHaveLength(1);
    expect(report.gates.passed).toBe(false);
  });

  it('never inventories deleted messages or external web image URLs', () => {
    const input = baseInput();
    input.messages.push(message('deleted', 'thread-1', {
      deletedAt: NOW,
      attachments: [{ id: 'deleted-att', kind: 'file', blobPath: 'user-1/thread-1/deleted.txt', mime: 'text/plain', bytes: 1 }],
      webImages: [{ id: 'web-1', url: 'https://example.com/image.jpg' }],
    }));
    input.messages.push(message('web', 'thread-1', {
      webImages: [{ id: 'web-2', url: 'https://example.com/another.jpg' }],
    }));
    const report = buildLibraryInventory(input);
    expect(report.candidates.some((candidate) => candidate.sourceId === 'deleted-att')).toBe(false);
    expect(report.candidates.some((candidate) => candidate.sourceId.startsWith('web-'))).toBe(false);
  });
});
