#!/usr/bin/env node
/**
 * Metadata-only Library index backfill (LSL-02).
 *
 * Default mode is a fresh dry run. `--commit` is accepted only when that same-process inventory
 * passes every gate. Commit writes deterministic documents to Cosmos `library`; it never writes,
 * copies, or deletes Blob data and never mutates source containers.
 */
import { DefaultAzureCredential } from '@azure/identity';
import { CosmosClient } from '@azure/cosmos';
import { CosmosLibraryStore } from '../src/adapters/cosmos/libraryStore';
import type { LibraryItemRecord } from '../src/domain/library';
import { runLibraryInventory } from './library-inventory';

interface BackfillArgs {
  commit: boolean;
  output?: string;
}

function parseArgs(argv: string[]): BackfillArgs {
  const parsed: BackfillArgs = { commit: false };
  for (let index = 0; index < argv.length; index++) {
    if (argv[index] === '--commit') parsed.commit = true;
    else if (argv[index] === '--output') {
      if (!argv[index + 1]) throw new Error('--output requires a directory.');
      parsed.output = argv[++index];
    } else throw new Error(`Unknown argument: ${argv[index]}`);
  }
  return parsed;
}

function sameIdentity(existing: LibraryItemRecord, expected: LibraryItemRecord): boolean {
  return existing.id === expected.id
    && existing.userId === expected.userId
    && existing.ingestionKey === expected.ingestionKey
    && existing.origin === expected.origin
    && existing.blobPath === expected.blobPath;
}

export async function runLibraryBackfill(options: BackfillArgs): Promise<{ created: number; verified: number; total: number }> {
  const { report } = await runLibraryInventory({ output: options.output });
  if (!report.gates.passed) throw new Error('Library inventory gates failed. Backfill is blocked.');
  if (!options.commit) return { created: 0, verified: 0, total: report.candidates.length };

  const endpoint = process.env.COSMOS_ENDPOINT ?? 'https://cosmos-watai-cbroocyg3omrk.documents.azure.com:443/';
  const databaseId = process.env.COSMOS_DATABASE ?? 'watai';
  const cosmos = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  const store = new CosmosLibraryStore(cosmos.database(databaseId).container('library'));
  let created = 0;
  let verified = 0;

  for (const candidate of report.candidates) {
    const expected = candidate.projection;
    const existing = await store.get(expected.userId, expected.id);
    if (existing) {
      if (!sameIdentity(existing, expected)) {
        throw new Error(`Library index conflict for deterministic item ${expected.id}.`);
      }
      verified++;
      continue;
    }
    await store.put(expected);
    created++;
  }

  for (const candidate of report.candidates) {
    const expected = candidate.projection;
    const stored = await store.get(expected.userId, expected.id);
    if (!stored || !sameIdentity(stored, expected)) {
      throw new Error(`Library index parity verification failed for ${expected.id}.`);
    }
  }

  return { created, verified, total: report.candidates.length };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const result = await runLibraryBackfill(options);
  if (!options.commit) {
    console.log(`Library backfill dry run passed for ${result.total} deterministic index items.`);
    console.log('No cloud data was changed. Re-run with --commit to create Library index documents.');
    return;
  }
  console.log(`Library backfill complete: ${result.created} created, ${result.verified} already verified, ${result.total} total.`);
  console.log('Blob and source containers were not changed.');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
