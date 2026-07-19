import { createHash } from 'node:crypto';
import { AppError } from '../domain/errors';
import type { MessageRecord } from '../ports/messageStore';
import type { ImageGenRecord } from '../ports/imageStore';
import type { ThreadRecord } from '../ports/threadStore';
import { parseLibraryItem, type LibraryItemRecord, type LibraryKind, type LibraryOrigin } from '../domain/library';

export interface InventoryBlob {
  name: string;
  bytes: number;
  contentType?: string;
}

export interface LibraryInventoryInput {
  messages: MessageRecord[];
  threads: ThreadRecord[];
  studioImages: ImageGenRecord[];
  blobs: InventoryBlob[];
  generatedAt: string;
}

export interface InventoryCandidate {
  proposedId: string;
  ingestionKey: string;
  origin: LibraryOrigin;
  kind: LibraryKind;
  sourceId: string;
  sourceThreadId?: string;
  blobPath: string;
  declaredBytes: number;
  actualBytes?: number;
  provenanceComplete: boolean;
  projection: LibraryItemRecord;
}

export interface LibraryInventoryReport {
  schema: 'watai.library-inventory.v1';
  mode: 'dry-run';
  generatedAt: string;
  summary: {
    messages: number;
    threads: number;
    studioImages: number;
    blobs: number;
    blobBytes: number;
    eligibleItems: number;
    eligibleBytes: number;
    missingBlobItems: number;
    orphanBlobs: number;
    orphanBytes: number;
    temporaryExcludedItems: number;
    serviceOnlyDocuments: number;
    partialProvenanceItems: number;
    duplicateIngestionKeys: number;
    duplicateProposedIds: number;
    duplicateBlobReferences: number;
    unknownPathBlobs: number;
  };
  gates: {
    passed: boolean;
    eligibleBlobCoverage: boolean;
    studioBlobCoverage: boolean;
    uniqueIngestionKeys: boolean;
    uniqueProposedIds: boolean;
    everyBlobClassified: boolean;
  };
  candidates: InventoryCandidate[];
  missingBlobItems: InventoryCandidate[];
  orphanBlobs: InventoryBlob[];
  temporaryExcluded: Array<{ sourceId: string; threadId: string; blobPath: string }>;
  serviceOnlyDocuments: Array<{ threadId: string; fileId: string; name: string; status: string }>;
  partialProvenance: Array<{ proposedId: string; origin: LibraryOrigin; sourceId: string }>;
  duplicateIngestionKeys: string[];
  duplicateProposedIds: string[];
  duplicateBlobReferences: Array<{ blobPath: string; proposedIds: string[] }>;
  pathFamilies: Record<'thread' | 'studio' | 'library' | 'skills' | 'unknown', { count: number; bytes: number }>;
}

function key(userId: string, threadId: string): string {
  return `${userId}\u0000${threadId}`;
}

function proposedId(userId: string, ingestionKey: string): string {
  return `lib-${createHash('sha256').update(`${userId}\u0000${ingestionKey}`).digest('hex').slice(0, 32)}`;
}

function kindFor(mime: string, name = ''): LibraryKind {
  const lowerMime = mime.toLowerCase();
  const lowerName = name.toLowerCase();
  if (lowerMime.startsWith('image/')) return 'image';
  if (lowerMime.startsWith('audio/')) return 'audio';
  if (lowerMime === 'application/pdf' || lowerName.endsWith('.pdf')) return 'pdf';
  if (lowerMime.includes('spreadsheet') || /\.(xlsx|xls)$/.test(lowerName)) return 'spreadsheet';
  if (lowerMime.includes('presentation') || /\.(pptx|ppt)$/.test(lowerName)) return 'presentation';
  if (lowerMime.includes('wordprocessing') || /\.(docx|doc)$/.test(lowerName)) return 'document';
  if (lowerMime.includes('zip') || /\.(zip|tar|gz)$/.test(lowerName)) return 'archive';
  if (lowerMime === 'text/csv' || lowerMime === 'application/json' || /\.(csv|json)$/.test(lowerName)) return 'data';
  if (/javascript|typescript|x-python|x-sh|text\/html|text\/css/.test(lowerMime) || /\.(js|ts|tsx|py|sh|html|css)$/.test(lowerName)) return 'code';
  if (lowerMime.startsWith('text/') || /\.(txt|md|markdown)$/.test(lowerName)) return 'text';
  return 'other';
}

function pathFamily(name: string): keyof LibraryInventoryReport['pathFamilies'] {
  if (name.startsWith('skills/')) return 'skills';
  const parts = name.split('/');
  if (parts.length >= 3 && parts[1] === 'images') return 'studio';
  if (parts.length >= 3 && parts[1] === 'library') return 'library';
  if (parts.length >= 3) return 'thread';
  return 'unknown';
}

function duplicates(values: string[]): string[] {
  const counts = new Map<string, number>();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return [...counts].filter(([, count]) => count > 1).map(([value]) => value).sort();
}

export function buildLibraryInventory(input: LibraryInventoryInput): LibraryInventoryReport {
  const threads = new Map(input.threads.map((thread) => [key(thread.userId, thread.id), thread]));
  const blobs = new Map(input.blobs.map((blob) => [blob.name, blob]));
  const candidates: InventoryCandidate[] = [];
  const temporaryExcluded: LibraryInventoryReport['temporaryExcluded'] = [];
  const serviceOnlyDocuments: LibraryInventoryReport['serviceOnlyDocuments'] = [];
  const knownExcludedPaths = new Set<string>();

  const addCandidate = (args: Omit<InventoryCandidate, 'proposedId' | 'actualBytes' | 'projection'> & {
    userId: string;
    name: string;
    mime: string;
    createdAt: string;
    source: LibraryItemRecord['source'];
    image?: LibraryItemRecord['image'];
    artifact?: LibraryItemRecord['artifact'];
  }) => {
    const blob = blobs.get(args.blobPath);
    const id = proposedId(args.userId, args.ingestionKey);
    let projection: LibraryItemRecord;
    try {
      projection = parseLibraryItem({
        id,
        userId: args.userId,
        ingestionKey: args.ingestionKey,
        state: 'active',
        kind: args.kind,
        origin: args.origin,
        name: args.name,
        mime: args.mime,
        bytes: blob?.bytes ?? args.declaredBytes,
        blobPath: args.blobPath,
        createdAt: args.createdAt,
        updatedAt: args.createdAt,
        source: args.source,
        ...(args.image ? { image: args.image } : {}),
        ...(args.artifact ? { artifact: args.artifact } : {}),
      });
    } catch (error) {
      const details = error instanceof AppError ? ` ${JSON.stringify(error.details)}` : '';
      throw new Error(`Invalid Library projection for ${args.origin}/${args.sourceId}.${details}`);
    }
    candidates.push({
      proposedId: id,
      ingestionKey: args.ingestionKey,
      origin: args.origin,
      kind: args.kind,
      sourceId: args.sourceId,
      ...(args.sourceThreadId ? { sourceThreadId: args.sourceThreadId } : {}),
      blobPath: args.blobPath,
      declaredBytes: args.declaredBytes,
      ...(blob ? { actualBytes: blob.bytes } : {}),
      provenanceComplete: args.provenanceComplete,
      projection,
    });
  };

  for (const message of input.messages) {
    if (message.deletedAt) continue;
    const thread = threads.get(key(message.userId, message.threadId));
    const temporary = thread?.temporary === true;
    for (const attachment of message.attachments ?? []) {
      if (!attachment.blobPath) continue;
      if (temporary) {
        temporaryExcluded.push({ sourceId: attachment.id, threadId: message.threadId, blobPath: attachment.blobPath });
        knownExcludedPaths.add(attachment.blobPath);
        continue;
      }
      addCandidate({
        userId: message.userId,
        ingestionKey: `chat_attachment:${attachment.id}`,
        origin: 'chat_upload',
        kind: kindFor(attachment.mime, attachment.name),
        sourceId: attachment.id,
        sourceThreadId: message.threadId,
        blobPath: attachment.blobPath,
        declaredBytes: attachment.bytes,
        provenanceComplete: true,
        name: attachment.name ?? `Attachment ${attachment.id}`,
        mime: attachment.mime,
        createdAt: message.orderAt ?? message.createdAt,
        source: {
          surface: 'chat',
          threadId: message.threadId,
          messageId: message.id,
          ...(thread?.title ? { threadTitleSnapshot: thread.title } : {}),
          createdAt: message.orderAt ?? message.createdAt,
        },
        ...(attachment.kind === 'image' ? {
          image: {
            ...(attachment.width ? { width: attachment.width } : {}),
            ...(attachment.height ? { height: attachment.height } : {}),
            provenanceComplete: true,
          },
        } : {}),
      });
    }
    for (const image of message.images ?? []) {
      if (temporary) {
        temporaryExcluded.push({ sourceId: image.id, threadId: message.threadId, blobPath: image.blobPath });
        knownExcludedPaths.add(image.blobPath);
        continue;
      }
      addCandidate({
        userId: message.userId,
        ingestionKey: `chat_generated_image:${image.id}`,
        origin: 'chat_generated_image',
        kind: 'image',
        sourceId: image.id,
        sourceThreadId: message.threadId,
        blobPath: image.blobPath,
        declaredBytes: blobs.get(image.blobPath)?.bytes ?? 0,
        provenanceComplete: false,
        name: `Generated image ${image.id}`,
        mime: `image/${image.outputFormat}`,
        createdAt: image.createdAt,
        source: {
          surface: 'chat',
          threadId: message.threadId,
          messageId: message.id,
          ...(thread?.title ? { threadTitleSnapshot: thread.title } : {}),
          createdAt: image.createdAt,
        },
        image: {
          size: image.size,
          format: image.outputFormat,
          prompt: image.prompt,
          provenanceComplete: false,
        },
      });
    }
    for (const artifact of message.artifacts ?? []) {
      if (temporary) {
        temporaryExcluded.push({ sourceId: artifact.id, threadId: message.threadId, blobPath: artifact.blobPath });
        knownExcludedPaths.add(artifact.blobPath);
        continue;
      }
      addCandidate({
        userId: message.userId,
        ingestionKey: `code_artifact:${artifact.id}`,
        origin: 'code_artifact',
        kind: artifact.kind,
        sourceId: artifact.id,
        sourceThreadId: message.threadId,
        blobPath: artifact.blobPath,
        declaredBytes: artifact.bytes,
        provenanceComplete: false,
        name: artifact.name,
        mime: artifact.mime,
        createdAt: artifact.createdAt,
        source: {
          surface: 'chat',
          threadId: message.threadId,
          messageId: message.id,
          ...(artifact.sourceToolCallId ? { toolCallId: artifact.sourceToolCallId } : {}),
          ...(thread?.title ? { threadTitleSnapshot: thread.title } : {}),
          createdAt: artifact.createdAt,
        },
        ...(artifact.kind === 'image' ? { image: { provenanceComplete: false } } : {}),
        artifact: { provenanceComplete: false },
      });
    }
  }

  for (const thread of input.threads) {
    for (const file of thread.files ?? []) {
      if ((file.kind ?? 'document') !== 'document') continue;
      if (!file.blobPath) {
        serviceOnlyDocuments.push({ threadId: thread.id, fileId: file.fileId, name: file.name, status: file.status });
        continue;
      }
      if (thread.temporary) {
        temporaryExcluded.push({ sourceId: file.fileId, threadId: thread.id, blobPath: file.blobPath });
        knownExcludedPaths.add(file.blobPath);
        continue;
      }
      addCandidate({
        userId: thread.userId,
        ingestionKey: `thread_document:${file.fileId}`,
        origin: 'thread_document',
        kind: kindFor(file.mime ?? '', file.name),
        sourceId: file.fileId,
        sourceThreadId: thread.id,
        blobPath: file.blobPath,
        declaredBytes: file.bytes,
        provenanceComplete: true,
        name: file.name,
        mime: file.mime ?? 'application/octet-stream',
        createdAt: file.createdAt,
        source: {
          surface: 'chat',
          threadId: thread.id,
          threadTitleSnapshot: thread.title,
          createdAt: file.createdAt,
        },
      });
    }
  }

  for (const image of input.studioImages) {
    if (!image.blobPath) continue;
    if (image.status !== 'ready') {
      knownExcludedPaths.add(image.blobPath);
      continue;
    }
    addCandidate({
      userId: image.userId,
      ingestionKey: `studio_generated_image:${image.id}`,
      origin: 'studio_generated_image',
      kind: 'image',
      sourceId: image.id,
      blobPath: image.blobPath,
      declaredBytes: blobs.get(image.blobPath)?.bytes ?? 0,
      provenanceComplete: !image.useReference || !!image.sourceImageId,
      name: `Studio image ${image.id}`,
      mime: `image/${image.outputFormat}`,
      createdAt: image.createdAt,
      source: { surface: 'image_studio', createdAt: image.createdAt },
      image: {
        size: image.size,
        format: image.outputFormat,
        prompt: image.prompt,
        ...(image.revisedPrompt ? { revisedPrompt: image.revisedPrompt } : {}),
        model: image.model,
        ...(image.quality ? { quality: image.quality } : {}),
        ...(image.sourceImageId ? { referenceItemIds: [proposedId(image.userId, `studio_generated_image:${image.sourceImageId}`)] } : {}),
        provenanceComplete: !image.useReference || !!image.sourceImageId,
      },
    });
  }

  const duplicateIngestionKeys = duplicates(candidates.map((candidate) => candidate.ingestionKey));
  const duplicateProposedIds = duplicates(candidates.map((candidate) => candidate.proposedId));
  const byBlob = new Map<string, string[]>();
  for (const candidate of candidates) {
    const ids = byBlob.get(candidate.blobPath) ?? [];
    ids.push(candidate.proposedId);
    byBlob.set(candidate.blobPath, ids);
  }
  const duplicateBlobReferences = [...byBlob]
    .filter(([, ids]) => ids.length > 1)
    .map(([blobPath, proposedIds]) => ({ blobPath, proposedIds }));
  const missingBlobItems = candidates.filter((candidate) => candidate.actualBytes === undefined);
  const referencedPaths = new Set([...candidates.map((candidate) => candidate.blobPath), ...knownExcludedPaths]);
  const orphanBlobs = input.blobs.filter((blob) => !referencedPaths.has(blob.name) && pathFamily(blob.name) !== 'skills');
  const partialProvenance = candidates
    .filter((candidate) => !candidate.provenanceComplete)
    .map(({ proposedId: id, origin, sourceId }) => ({ proposedId: id, origin, sourceId }));
  const pathFamilies: LibraryInventoryReport['pathFamilies'] = {
    thread: { count: 0, bytes: 0 },
    studio: { count: 0, bytes: 0 },
    library: { count: 0, bytes: 0 },
    skills: { count: 0, bytes: 0 },
    unknown: { count: 0, bytes: 0 },
  };
  for (const blob of input.blobs) {
    const family = pathFamily(blob.name);
    pathFamilies[family].count++;
    pathFamilies[family].bytes += blob.bytes;
  }
  const studioCandidates = candidates.filter((candidate) => candidate.origin === 'studio_generated_image');
  const eligibleBlobCoverage = missingBlobItems.length === 0;
  const studioBlobCoverage = studioCandidates.every((candidate) => candidate.actualBytes !== undefined);
  const uniqueIngestionKeys = duplicateIngestionKeys.length === 0;
  const uniqueProposedIds = duplicateProposedIds.length === 0;
  const everyBlobClassified = orphanBlobs.length === 0 && pathFamilies.unknown.count === 0;
  const gates = {
    passed: eligibleBlobCoverage && studioBlobCoverage && uniqueIngestionKeys && uniqueProposedIds && everyBlobClassified,
    eligibleBlobCoverage,
    studioBlobCoverage,
    uniqueIngestionKeys,
    uniqueProposedIds,
    everyBlobClassified,
  };
  return {
    schema: 'watai.library-inventory.v1',
    mode: 'dry-run',
    generatedAt: input.generatedAt,
    summary: {
      messages: input.messages.length,
      threads: input.threads.length,
      studioImages: input.studioImages.length,
      blobs: input.blobs.length,
      blobBytes: input.blobs.reduce((sum, blob) => sum + blob.bytes, 0),
      eligibleItems: candidates.length,
      eligibleBytes: candidates.reduce((sum, candidate) => sum + (candidate.actualBytes ?? candidate.declaredBytes), 0),
      missingBlobItems: missingBlobItems.length,
      orphanBlobs: orphanBlobs.length,
      orphanBytes: orphanBlobs.reduce((sum, blob) => sum + blob.bytes, 0),
      temporaryExcludedItems: temporaryExcluded.length,
      serviceOnlyDocuments: serviceOnlyDocuments.length,
      partialProvenanceItems: partialProvenance.length,
      duplicateIngestionKeys: duplicateIngestionKeys.length,
      duplicateProposedIds: duplicateProposedIds.length,
      duplicateBlobReferences: duplicateBlobReferences.length,
      unknownPathBlobs: pathFamilies.unknown.count,
    },
    gates,
    candidates,
    missingBlobItems,
    orphanBlobs,
    temporaryExcluded,
    serviceOnlyDocuments,
    partialProvenance,
    duplicateIngestionKeys,
    duplicateProposedIds,
    duplicateBlobReferences,
    pathFamilies,
  };
}
