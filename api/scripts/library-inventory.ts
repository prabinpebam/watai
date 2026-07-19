#!/usr/bin/env node
/**
 * Read-only Library inventory (LSL-01).
 *
 * Reads Cosmos messages/threads/images plus Blob `media`, classifies existing content, and writes
 * a local JSON + Markdown report. It never writes to Azure. Reports are gitignored.
 *
 *   npm run library:inventory
 *   npm run library:inventory -- --output C:\private\watai-library-inventory
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';
import { buildLibraryInventory, type InventoryBlob, type LibraryInventoryReport } from '../src/application/libraryInventory';
import type { MessageRecord } from '../src/ports/messageStore';
import type { ThreadRecord } from '../src/ports/threadStore';
import type { ImageGenRecord } from '../src/ports/imageStore';

interface Args {
  output?: string;
}

function args(argv: string[]): Args {
  const parsed: Args = {};
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--output') {
      if (!argv[index + 1]) throw new Error('--output requires a directory.');
      parsed.output = argv[++index];
    } else {
      throw new Error(`Unknown argument: ${argv[index]}`);
    }
  }
  return parsed;
}

async function queryAll<T>(client: CosmosClient, databaseId: string, containerId: string): Promise<T[]> {
  const container = client.database(databaseId).container(containerId);
  const { resources } = await container.items.query<T>('SELECT * FROM c').fetchAll();
  return resources;
}

async function listBlobs(service: BlobServiceClient, containerName: string): Promise<InventoryBlob[]> {
  const blobs: InventoryBlob[] = [];
  const container = service.getContainerClient(containerName);
  for await (const blob of container.listBlobsFlat()) {
    blobs.push({
      name: blob.name,
      bytes: blob.properties.contentLength ?? 0,
      ...(blob.properties.contentType ? { contentType: blob.properties.contentType } : {}),
    });
  }
  return blobs;
}

function number(value: number): string {
  return new Intl.NumberFormat('en-US').format(value);
}

function bytes(value: number): string {
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KiB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(2)} MiB`;
  return `${(value / 1024 ** 3).toFixed(2)} GiB`;
}

function markdown(report: LibraryInventoryReport): string {
  const s = report.summary;
  const gateRows = Object.entries(report.gates)
    .filter(([name]) => name !== 'passed')
    .map(([name, passed]) => `| ${name} | ${passed ? 'PASS' : 'FAIL'} |`)
    .join('\n');
  const familyRows = Object.entries(report.pathFamilies)
    .map(([family, value]) => `| ${family} | ${number(value.count)} | ${bytes(value.bytes)} |`)
    .join('\n');
  const missing = report.missingBlobItems.slice(0, 100).map((item) => `- ${item.origin} / ${item.sourceId}: ${item.blobPath}`).join('\n') || '- None';
  const orphans = report.orphanBlobs.slice(0, 100).map((blob) => `- ${blob.name} (${bytes(blob.bytes)})`).join('\n') || '- None';
  return `# Watai Library Inventory — Dry Run

Generated: ${report.generatedAt}

**Overall gate: ${report.gates.passed ? 'PASS' : 'FAIL'}**

This report is read-only. No Cosmos documents or Blob objects were changed.

## Summary

| Metric | Value |
| --- | ---: |
| Messages | ${number(s.messages)} |
| Threads | ${number(s.threads)} |
| Image Studio records | ${number(s.studioImages)} |
| Blobs | ${number(s.blobs)} |
| Blob bytes | ${bytes(s.blobBytes)} |
| Eligible items | ${number(s.eligibleItems)} |
| Eligible bytes | ${bytes(s.eligibleBytes)} |
| Missing blob items | ${number(s.missingBlobItems)} |
| Orphan blobs | ${number(s.orphanBlobs)} |
| Orphan bytes | ${bytes(s.orphanBytes)} |
| Temporary excluded | ${number(s.temporaryExcludedItems)} |
| Service-only documents | ${number(s.serviceOnlyDocuments)} |
| Partial provenance | ${number(s.partialProvenanceItems)} |
| Duplicate ingestion keys | ${number(s.duplicateIngestionKeys)} |
| Duplicate proposed IDs | ${number(s.duplicateProposedIds)} |
| Duplicate blob references | ${number(s.duplicateBlobReferences)} |
| Unknown-path blobs | ${number(s.unknownPathBlobs)} |

## Gates

| Gate | Result |
| --- | --- |
${gateRows}

## Blob path families

| Family | Count | Bytes |
| --- | ---: | ---: |
${familyRows}

## Missing blob items (first 100)

${missing}

## Orphan blobs (first 100)

${orphans}

## Notes

- Full candidate and finding details are in the adjacent JSON report.
- A failed gate blocks migration commit mode.
- Unidentified orphan blobs are never deleted automatically.
`;
}

export async function runLibraryInventory(options: Args = {}): Promise<{ report: LibraryInventoryReport; jsonPath: string; markdownPath: string }> {
  const endpoint = process.env.COSMOS_ENDPOINT ?? 'https://cosmos-watai-cbroocyg3omrk.documents.azure.com:443/';
  const databaseId = process.env.COSMOS_DATABASE ?? 'watai';
  const storageAccount = process.env.STORAGE_ACCOUNT ?? 'stwataicbroocyg3omrk';
  const mediaContainer = process.env.MEDIA_CONTAINER ?? 'media';
  const credential = new DefaultAzureCredential();
  const cosmos = new CosmosClient({ endpoint, aadCredentials: credential });
  const blobService = new BlobServiceClient(`https://${storageAccount}.blob.core.windows.net`, credential);
  const [messages, threads, studioImages, blobs] = await Promise.all([
    queryAll<MessageRecord>(cosmos, databaseId, 'messages'),
    queryAll<ThreadRecord>(cosmos, databaseId, 'threads'),
    queryAll<ImageGenRecord>(cosmos, databaseId, 'images'),
    listBlobs(blobService, mediaContainer),
  ]);
  const generatedAt = new Date().toISOString();
  const report = buildLibraryInventory({ messages, threads, studioImages, blobs, generatedAt });
  const defaultRoot = fileURLToPath(new URL('../../documentation/library-system/inventory-runs/', import.meta.url));
  const outputRoot = resolve(options.output ?? defaultRoot);
  await mkdir(outputRoot, { recursive: true });
  const stamp = generatedAt.replace(/[:.]/g, '-');
  const jsonPath = resolve(outputRoot, `${stamp}.json`);
  const markdownPath = resolve(outputRoot, `${stamp}.md`);
  await Promise.all([
    writeFile(jsonPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8'),
    writeFile(markdownPath, markdown(report), 'utf8'),
  ]);
  return { report, jsonPath, markdownPath };
}

async function main(): Promise<void> {
  const { report, jsonPath, markdownPath } = await runLibraryInventory(args(process.argv.slice(2)));
  console.log(`Library inventory: ${report.gates.passed ? 'PASS' : 'FAIL'}`);
  console.log(`Eligible: ${report.summary.eligibleItems} items / ${bytes(report.summary.eligibleBytes)}`);
  console.log(`Missing: ${report.summary.missingBlobItems}; orphans: ${report.summary.orphanBlobs}; partial provenance: ${report.summary.partialProvenanceItems}`);
  console.log(`JSON: ${jsonPath}`);
  console.log(`Markdown: ${markdownPath}`);
  if (!report.gates.passed) process.exitCode = 2;
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : '';
if (invokedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
  });
}
