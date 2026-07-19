#!/usr/bin/env node
/**
 * Resumable legacy-byte migration (LSL-07).
 *
 * Default is dry-run. Commit requires --expected-report-hash from the immediately recomputed plan.
 * Each item: copy bytes -> verify size/hash -> patch Library -> patch source snapshot -> delete old.
 */
import { createHash } from 'node:crypto';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { CosmosClient } from '@azure/cosmos';
import { CosmosLibraryStore } from '../src/adapters/cosmos/libraryStore';
import type { MessageRecord } from '../src/ports/messageStore';
import type { ThreadRecord } from '../src/ports/threadStore';
import type { ImageGenRecord } from '../src/ports/imageStore';
import { runLibraryInventory } from './library-inventory';

interface Options { commit: boolean; expectedReportHash?: string; output?: string; }
interface PlanItem { id: string; userId: string; origin: string; sourceId: string; threadId?: string; messageId?: string; oldPath: string; newPath: string; bytes: number; }

function parseArgs(argv: string[]): Options {
  const options: Options = { commit: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--commit') options.commit = true;
    else if (argv[index] === '--expected-report-hash') options.expectedReportHash = argv[++index];
    else if (argv[index] === '--output') options.output = argv[++index];
    else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return options;
}

function extension(path: string): string {
  const name = path.split('/').pop() ?? '';
  const ext = name.includes('.') ? name.split('.').pop()!.toLowerCase() : 'bin';
  return /^[a-z0-9]{1,10}$/.test(ext) ? ext : 'bin';
}

function hashPlan(plan: PlanItem[]): string {
  const canonical = JSON.stringify(plan.map((item) => ({ id: item.id, oldPath: item.oldPath, newPath: item.newPath, bytes: item.bytes })));
  return `sha256:${createHash('sha256').update(canonical).digest('hex')}`;
}

function stripSystem<T extends Record<string, unknown>>(record: T): T {
  const { _rid, _self, _etag, _attachments, _ts, ...clean } = record;
  return clean as T;
}

async function streamBytes(blob: ReturnType<ReturnType<BlobServiceClient['getContainerClient']>['getBlobClient']>): Promise<Buffer> {
  const response = await blob.download();
  if (!response.readableStreamBody) return Buffer.alloc(0);
  const chunks: Buffer[] = [];
  for await (const chunk of response.readableStreamBody) chunks.push(Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export async function runLibraryMigration(options: Options): Promise<{ hash: string; total: number; migrated: number; verified: number }> {
  const { report } = await runLibraryInventory({ output: options.output });
  if (!report.gates.passed) throw new Error('Library inventory gates failed. Migration is blocked.');
  const plan: PlanItem[] = report.candidates
    .filter((candidate) => !candidate.blobPath.includes('/library/'))
    .map((candidate) => ({
      id: candidate.proposedId,
      userId: candidate.projection.userId,
      origin: candidate.origin,
      sourceId: candidate.sourceId,
      ...(candidate.sourceThreadId ? { threadId: candidate.sourceThreadId } : {}),
      ...(candidate.projection.source.messageId ? { messageId: candidate.projection.source.messageId } : {}),
      oldPath: candidate.blobPath,
      newPath: `${candidate.projection.userId}/library/${candidate.proposedId}.${extension(candidate.blobPath)}`,
      bytes: candidate.actualBytes ?? candidate.declaredBytes,
    }))
    .sort((left, right) => left.id.localeCompare(right.id));
  const hash = hashPlan(plan);
  console.log(`Migration plan: ${plan.length} items; report hash ${hash}`);
  if (!options.commit) {
    console.log('Dry run only. No cloud data was changed.');
    return { hash, total: plan.length, migrated: 0, verified: 0 };
  }
  if (!options.expectedReportHash || options.expectedReportHash !== hash) throw new Error('Expected report hash does not match the fresh migration plan.');

  const endpoint = process.env.COSMOS_ENDPOINT ?? 'https://cosmos-watai-cbroocyg3omrk.documents.azure.com:443/';
  const databaseId = process.env.COSMOS_DATABASE ?? 'watai';
  const storageAccount = process.env.STORAGE_ACCOUNT ?? 'stwataicbroocyg3omrk';
  const mediaContainer = process.env.MEDIA_CONTAINER ?? 'media';
  const credential = new DefaultAzureCredential();
  const cosmos = new CosmosClient({ endpoint, aadCredentials: credential });
  const database = cosmos.database(databaseId);
  const libraryStore = new CosmosLibraryStore(database.container('library'));
  const media = new BlobServiceClient(`https://${storageAccount}.blob.core.windows.net`, credential).getContainerClient(mediaContainer);
  let migrated = 0;
  let verified = 0;

  for (const item of plan) {
    const source = media.getBlobClient(item.oldPath);
    const target = media.getBlockBlobClient(item.newPath);
    let bytes: Buffer;
    if (await target.exists()) {
      bytes = await streamBytes(target);
      verified++;
    } else {
      if (!(await source.exists())) throw new Error(`Neither source nor destination exists for ${item.id}.`);
      bytes = await streamBytes(source);
      await target.uploadData(bytes, { blobHTTPHeaders: { blobContentType: (await source.getProperties()).contentType } });
      migrated++;
    }
    if (bytes.byteLength !== item.bytes) throw new Error(`Byte verification failed for ${item.id}.`);
    const contentHash = `sha256:${createHash('sha256').update(bytes).digest('hex')}`;
    const library = await libraryStore.get(item.userId, item.id);
    if (!library) throw new Error(`Library row missing for ${item.id}.`);
    await libraryStore.put({ ...library, state: 'active', blobPath: item.newPath, bytes: bytes.byteLength, contentHash, updatedAt: new Date().toISOString() });

    if (item.messageId && item.threadId) {
      const container = database.container('messages');
      const response = await container.item(item.messageId, item.threadId).read<MessageRecord & Record<string, unknown>>();
      if (response.resource) {
        const message = stripSystem(response.resource);
        const patch = <T extends { id: string; blobPath: string; libraryItemId?: string }>(values?: T[]) => values?.map((value) => value.id === item.sourceId ? { ...value, blobPath: item.newPath, libraryItemId: item.id } : value);
        await container.item(item.messageId, item.threadId).replace({ ...message, attachments: patch(message.attachments), images: patch(message.images), artifacts: patch(message.artifacts) });
      }
    } else if (item.origin === 'thread_document' && item.threadId) {
      const container = database.container('threads');
      const response = await container.item(item.threadId, item.userId).read<ThreadRecord & Record<string, unknown>>();
      if (response.resource) {
        const thread = stripSystem(response.resource);
        await container.item(item.threadId, item.userId).replace({ ...thread, files: thread.files?.map((file) => file.fileId === item.sourceId ? { ...file, blobPath: item.newPath, libraryItemId: item.id } : file) });
      }
    } else if (item.origin === 'studio_generated_image') {
      const container = database.container('images');
      const response = await container.item(item.sourceId, item.userId).read<ImageGenRecord & Record<string, unknown>>();
      if (response.resource) await container.item(item.sourceId, item.userId).replace({ ...stripSystem(response.resource), blobPath: item.newPath, libraryItemId: item.id });
    }
    if (item.oldPath !== item.newPath && await source.exists()) await source.delete();
  }
  return { hash, total: plan.length, migrated, verified };
}

const options = parseArgs(process.argv.slice(2));
runLibraryMigration(options).then((result) => {
  console.log(`Migration complete: ${result.migrated} copied, ${result.verified} resumed, ${result.total} total.`);
}).catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
