import { BlobServiceClient } from '@azure/storage-blob';
import { DefaultAzureCredential } from '@azure/identity';
import type { ThreadAssetStore } from '../../ports/threadAssetStore';

/**
 * Deletes a thread's blob assets directly with the function's managed identity (which holds Storage
 * Blob Data Contributor). Every attachment, document original, generated image, and code-interpreter
 * artifact for a thread is stored under the `{userId}/{threadId}/` prefix in the media container, so a
 * prefix-scoped sweep removes them all and can never reach another thread or user.
 */
export class AzureThreadAssetStore implements ThreadAssetStore {
  private readonly client: BlobServiceClient;
  private readonly container: string;

  constructor(opts?: { accountName?: string; container?: string; client?: BlobServiceClient }) {
    this.container = opts?.container ?? (process.env.MEDIA_CONTAINER ?? 'media');
    if (opts?.client) {
      this.client = opts.client;
    } else {
      const accountName = opts?.accountName ?? process.env.STORAGE_ACCOUNT;
      if (!accountName) throw new Error('Missing required environment variable: STORAGE_ACCOUNT');
      this.client = new BlobServiceClient(
        `https://${accountName}.blob.core.windows.net`,
        new DefaultAzureCredential(),
      );
    }
  }

  async deleteThreadAssets(userId: string, threadId: string): Promise<void> {
    // Refuse to run with an empty segment — that would widen the prefix to a whole user (or the
    // entire container) and delete far more than the one thread being removed.
    if (!userId || !threadId) return;
    const prefix = `${userId}/${threadId}/`;
    const container = this.client.getContainerClient(this.container);
    for await (const blob of container.listBlobsFlat({ prefix })) {
      await container.deleteBlob(blob.name).catch(() => {});
    }
  }
}
