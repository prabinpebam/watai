import type { ThreadAssetStore } from '../../ports/threadAssetStore';

/**
 * In-memory ThreadAssetStore: a flat blob map keyed by path, with the same prefix-scoped deletion as
 * the Azure adapter. For unit tests and local dev.
 */
export class InMemoryThreadAssetStore implements ThreadAssetStore {
  readonly blobs = new Map<string, Uint8Array>();

  /** Seed a blob at the given path (bytes are irrelevant to the cleanup logic). */
  put(blobPath: string, bytes: Uint8Array = new Uint8Array()): void {
    this.blobs.set(blobPath, bytes);
  }

  async deleteThreadAssets(userId: string, threadId: string): Promise<void> {
    if (!userId || !threadId) return;
    const prefix = `${userId}/${threadId}/`;
    for (const path of [...this.blobs.keys()]) {
      if (path.startsWith(prefix)) this.blobs.delete(path);
    }
  }
}
