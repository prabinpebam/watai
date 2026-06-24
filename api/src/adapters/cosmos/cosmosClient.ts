import { CosmosClient, type Database } from '@azure/cosmos';
import { DefaultAzureCredential } from '@azure/identity';

let cached: { client: CosmosClient; database: Database } | undefined;

/**
 * Cosmos client using AAD (the account has local/key auth disabled). Locally this uses
 * the developer's `az login` identity via DefaultAzureCredential; in the Function App it
 * uses the system-assigned managed identity. Endpoint/database come from app settings.
 */
export function getCosmosDatabase(): Database {
  if (cached) return cached.database;
  const endpoint = process.env.COSMOS_ENDPOINT;
  if (!endpoint) throw new Error('COSMOS_ENDPOINT is not set.');
  const databaseId = process.env.COSMOS_DATABASE ?? 'watai';
  const client = new CosmosClient({ endpoint, aadCredentials: new DefaultAzureCredential() });
  const database = client.database(databaseId);
  cached = { client, database };
  return database;
}
