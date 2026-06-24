import { describe, it, expect, afterAll, beforeAll } from 'vitest';
import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import { AzureSasMinter } from './sasMinter';

// Only runs when pointed at a real Storage account (skipped in the normal offline suite).
const RUN = !!process.env.STORAGE_ACCOUNT;
const account = process.env.STORAGE_ACCOUNT ?? '';
const container = process.env.MEDIA_CONTAINER ?? 'media';

describe.runIf(RUN)('AzureSasMinter (integration)', () => {
  let minter: AzureSasMinter;
  const blobPath = `it-sas-${Date.now()}/thread/asset.txt`;
  const content = `hello-${Date.now()}`;

  beforeAll(() => {
    minter = new AzureSasMinter();
  });

  afterAll(async () => {
    const svc = new BlobServiceClient(`https://${account}.blob.core.windows.net`, new DefaultAzureCredential());
    await svc.getContainerClient(container).getBlockBlobClient(blobPath).deleteIfExists().catch(() => undefined);
  });

  it('mints a write SAS that can upload, then a read SAS that reads it back', async () => {
    const write = await minter.mint({ blobPath, op: 'write', contentType: 'text/plain', ttlSeconds: 300 });
    const put = await fetch(write.url, {
      method: 'PUT',
      headers: { 'x-ms-blob-type': 'BlockBlob', 'Content-Type': 'text/plain' },
      body: content,
    });
    expect(put.status).toBe(201);

    const read = await minter.mint({ blobPath, op: 'read', ttlSeconds: 300 });
    const get = await fetch(read.url);
    expect(get.status).toBe(200);
    expect(await get.text()).toBe(content);
  });

  it('write-scoped SAS cannot be used to read (least privilege)', async () => {
    const write = await minter.mint({ blobPath, op: 'write', contentType: 'text/plain', ttlSeconds: 300 });
    const get = await fetch(write.url); // GET with a create+write-only token
    expect(get.status).toBe(403);
  });
});
