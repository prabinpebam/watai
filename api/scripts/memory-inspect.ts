/**
 * memory-inspect — read-only diagnostic: lists the memory records and whether each has an
 * embedding. Uses AAD (the signed-in az identity must hold a Cosmos data role). Throwaway tool.
 *
 *   npx tsx scripts/memory-inspect.ts
 */
import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

const endpoint = process.env.COSMOS_ENDPOINT ?? 'https://cosmos-watai-cbroocyg3omrk.documents.azure.com:443/';

async function main(): Promise<void> {
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  const container = client.database('watai').container('memory');
  const { resources } = await container.items
    .query('SELECT c.id, c.userId, c.kind, c.status, c.text, c.embeddingModel, IS_DEFINED(c.embedding) AS hasEmbedding, ARRAY_LENGTH(c.embedding) AS dims, c.updatedAt FROM c')
    .fetchAll();
  const records = resources.filter((r) => r.kind !== 'summary');
  console.log(`memory docs: ${resources.length} (records: ${records.length})`);
  const withEmb = records.filter((r) => r.hasEmbedding).length;
  console.log(`records with embedding: ${withEmb}/${records.length}`);
  const users = [...new Set(records.map((r) => r.userId))];
  console.log(`distinct userIds: ${users.length} -> ${users.join(', ')}`);
  console.log('---');
  for (const r of records.sort((a, b) => String(a.updatedAt).localeCompare(String(b.updatedAt)))) {
    console.log(`[${r.status}] emb=${r.hasEmbedding ? `yes(${r.dims}d,${r.embeddingModel})` : 'NO'} ${r.kind} ${r.updatedAt} :: ${String(r.text).slice(0, 70)}`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
