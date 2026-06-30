/**
 * Bulk cleanup of a thread's blob assets — uploaded attachments, uploaded-document originals,
 * generated images, and code-interpreter artifacts. They all live under the `{userId}/{threadId}/`
 * prefix in the media container, so deleting that prefix removes everything a thread owns in Blob
 * Storage without ever touching another thread or user. Used when a thread is permanently deleted so
 * no files are left orphaned.
 */
export interface ThreadAssetStore {
  /** Delete every blob under the thread's `{userId}/{threadId}/` prefix. Best-effort: resolves even
   *  if individual deletes fail (the thread tombstone is the source of truth). */
  deleteThreadAssets(userId: string, threadId: string): Promise<void>;
}
