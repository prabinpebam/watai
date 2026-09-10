import type { ImageStatus, ImageError, ImageQuality } from '../domain/imageGen';

/** Server-side image record (Cosmos `images`, partition key /userId). One row per image. */
export interface ImageGenRecord {
  id: string;
  libraryItemId?: string;
  userId: string;
  /** Groups images created together in one request. */
  batchId: string;
  status: ImageStatus;
  prompt: string;
  /** The model's rewritten prompt, when returned. */
  revisedPrompt?: string;
  size: string;
  quality?: ImageQuality;
  outputFormat: 'png' | 'jpeg' | 'webp';
  model: string;
  /** Set when `ready`: `${userId}/images/${id}.${ext}`. */
  blobPath?: string;
  /** Remix lineage — the image this one was generated from. */
  sourceImageId?: string;
  referenceItemIds?: string[];
  provenanceComplete?: boolean;
  /** Whether the remix used the source image as an edit reference. */
  useReference?: boolean;
  error?: ImageError | null;
  createdAt: string;
  updatedAt: string;
  releaseId?: string;
  executionToken?: string;
  dispatchAttempt?: number;
}

export interface ImageDispatchRecord {
  imageId: string;
  userId: string;
  releaseId: string;
  executionToken: string;
  attempt: number;
  state: 'pending' | 'sent';
  createdAt: string;
  updatedAt: string;
}

export interface ImageListOptions {
  /** Case-insensitive prompt substring filter. */
  q?: string;
  /** Exact size filter (e.g. `1024x1536`). */
  size?: string;
  sort?: 'newest' | 'oldest';
  limit?: number;
  /** Opaque continuation token from a previous page. */
  cursor?: string;
}

export interface ImageListResult {
  items: ImageGenRecord[];
  cursor?: string;
}

export interface ImageStore {
  get(userId: string, id: string): Promise<ImageGenRecord | null>;
  put(record: ImageGenRecord): Promise<ImageGenRecord>;
  putQueued(record: ImageGenRecord): Promise<ImageGenRecord>;
  transition(userId: string, id: string, expected: ImageStatus[], patch: Partial<ImageGenRecord>): Promise<ImageGenRecord | null>;
  listPendingDispatch(limit?: number): Promise<ImageDispatchRecord[]>;
  listStaleActive(before: string, limit?: number): Promise<ImageGenRecord[]>;
  markDispatchSent(record: ImageDispatchRecord, sentAt: string): Promise<void>;
  list(userId: string, options?: ImageListOptions): Promise<ImageListResult>;
  delete(userId: string, id: string): Promise<void>;
}
