/** Blob storage for user skill zips (the normalized package). Keyed by an opaque blob path. */
export interface SkillBlobStore {
  put(blobPath: string, bytes: Uint8Array): Promise<void>;
  get(blobPath: string): Promise<Uint8Array>;
  remove(blobPath: string): Promise<void>;
  /** A short-lived READ url for the client to download the zip directly. */
  readUrl(blobPath: string): Promise<string>;
}
