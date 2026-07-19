import { AppError } from '../domain/errors';
import { ALLOWED_CONTENT_TYPES, type AllowedContentType } from '../domain/asset';
import type { ThreadRecord, ThreadStore, ThreadFileMeta } from '../ports/threadStore';
import type { AoaiCreds, AoaiFiles, VectorFileStatus } from '../ai/files';
import type { DecryptedCredentials } from './credentialService';
import type { ServiceClock } from './threadService';
import { libraryItemIdFor } from '../domain/library';

/** Just the decrypt capability this service needs from the credential vault. */
export interface CredentialDecryptor {
  getDecrypted(userId: string): Promise<DecryptedCredentials>;
}

export interface ThreadFileUpload {
  name: string;
  mime: string;
  /** The file bytes, base64-encoded (a `data:` prefix is tolerated). */
  dataBase64: string;
}

export interface ThreadFilesOptions {
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  uploadOriginal?: (
    userId: string,
    threadId: string,
    assetId: string,
    bytes: Uint8Array,
    contentType: AllowedContentType,
  ) => Promise<string>;
  resolveLibraryItem?: (userId: string, itemId: string) => Promise<{ name: string; mime: string; bytes: Uint8Array } | null>;
  recordLibraryItem?: (input: { userId: string; thread: ThreadRecord; file: ThreadFileMeta }) => Promise<void>;
  /** Indexing poll cadence + bound (defaults ~18s total). */
  pollMs?: number;
  maxPolls?: number;
}

/** 25 MB cap per document — generous for text/PDF/office docs, bounded for a function body. */
const MAX_BYTES = 25 * 1024 * 1024;

function decodeBase64(data: string): Uint8Array {
  const b64 = data.replace(/^data:[^;]*;base64,/, '');
  return new Uint8Array(Buffer.from(b64, 'base64'));
}

function allowedContentType(mime: string): AllowedContentType | null {
  return (ALLOWED_CONTENT_TYPES as readonly string[]).includes(mime) ? mime as AllowedContentType : null;
}

/**
 * Manages a thread's knowledge base: uploads documents to the Azure OpenAI Files API, attaches
 * them to a per-thread vector store (created on first upload), and records the file metadata on
 * the thread so `file_search` can ground on them. Ownership is enforced by the caller's userId
 * (the thread is read from that user's partition); credentials come from the encrypted vault.
 */
export class ThreadFilesService {
  constructor(
    private readonly threads: ThreadStore,
    private readonly credentials: CredentialDecryptor,
    private readonly files: AoaiFiles,
    private readonly clock: ServiceClock,
    private readonly opts: ThreadFilesOptions = {},
  ) {}

  private async load(userId: string, threadId: string): Promise<ThreadRecord> {
    const t = await this.threads.get(userId, threadId);
    if (!t || t.deletedAt) throw new AppError('not_found', 'Thread not found.');
    return t;
  }

  private toCreds(c: DecryptedCredentials): AoaiCreds {
    return { baseUrl: c.baseUrl, key: c.key, fetchImpl: this.opts.fetchImpl };
  }

  async list(userId: string, threadId: string): Promise<ThreadFileMeta[]> {
    return (await this.load(userId, threadId)).files ?? [];
  }

  async upload(userId: string, threadId: string, input: ThreadFileUpload): Promise<ThreadFileMeta> {
    const name = input.name?.trim() || 'document';
    const bytes = decodeBase64(input.dataBase64 ?? '');
    if (!bytes.byteLength) throw new AppError('validation', 'The file is empty.');
    if (bytes.byteLength > MAX_BYTES) throw new AppError('validation', 'The file exceeds the 25 MB limit.');

    return this.indexBytes(userId, threadId, name, input.mime || 'application/octet-stream', bytes, true);
  }

  async attachLibraryItem(userId: string, threadId: string, itemId: string): Promise<ThreadFileMeta> {
    if (!this.opts.resolveLibraryItem) throw new AppError('conflict', 'Library document reuse is unavailable.');
    const resolved = await this.opts.resolveLibraryItem(userId, itemId);
    if (!resolved) throw new AppError('not_found', 'Library item not found.');
    if (!resolved.bytes.byteLength || resolved.bytes.byteLength > MAX_BYTES) throw new AppError('validation', 'Library item cannot be indexed.');
    return this.indexBytes(userId, threadId, resolved.name, resolved.mime, resolved.bytes, false, itemId);
  }

  private async indexBytes(
    userId: string,
    threadId: string,
    name: string,
    mime: string,
    bytes: Uint8Array,
    persistOriginal: boolean,
    libraryItemId?: string,
  ): Promise<ThreadFileMeta> {
    const thread = await this.load(userId, threadId);
    const creds = this.toCreds(await this.credentials.getDecrypted(userId));

    // 1. upload the bytes; 2. ensure a thread vector store; 3. attach + briefly await indexing.
    const up = await this.files.uploadFile(creds, {
      bytes,
      filename: name,
      mime,
    });
    const vectorStoreId = thread.vectorStoreId ?? (await this.files.createVectorStore(creds, `thread:${threadId}`));
    const attached = await this.files.addFile(creds, vectorStoreId, up.id);
    const status = await this.waitForReady(creds, vectorStoreId, up.id, attached);
    const contentType = allowedContentType(mime);
    const blobPath = persistOriginal && contentType && this.opts.uploadOriginal
      ? await this.opts.uploadOriginal(userId, threadId, up.id, bytes, contentType).catch(() => undefined)
      : undefined;

    const meta: ThreadFileMeta = {
      fileId: up.id,
      ...(libraryItemId
        ? { libraryItemId }
        : blobPath
          ? { libraryItemId: libraryItemIdFor(userId, 'thread_document', up.id) }
          : {}),
      name,
      bytes: up.bytes,
      status,
      createdAt: this.clock.now(),
      ...(blobPath ? { blobPath } : {}),
      ...(contentType ? { mime: contentType } : {}),
    };
    if (persistOriginal && blobPath && meta.libraryItemId && this.opts.recordLibraryItem) {
      await this.opts.recordLibraryItem({ userId, thread, file: meta });
    }
    await this.threads.put({
      ...thread,
      vectorStoreId,
      files: [...(thread.files ?? []), meta],
      updatedAt: this.clock.now(),
    });
    return meta;
  }

  async remove(userId: string, threadId: string, fileId: string): Promise<void> {
    const thread = await this.load(userId, threadId);
    const creds = await this.tryCreds(userId);
    if (thread.vectorStoreId && creds) {
      await this.files.removeFile(creds, thread.vectorStoreId, fileId).catch(() => {});
      await this.files.deleteFile(creds, fileId).catch(() => {});
    }
    const files = (thread.files ?? []).filter((f) => f.fileId !== fileId);
    // When the last document goes, drop the store so file_search auto-disables.
    let vectorStoreId: string | undefined = thread.vectorStoreId;
    if (files.length === 0 && vectorStoreId && creds) {
      await this.files.deleteVectorStore(creds, vectorStoreId).catch(() => {});
      vectorStoreId = undefined;
    }
    await this.threads.put({ ...thread, files, vectorStoreId, updatedAt: this.clock.now() });
  }

  /** Best-effort provider cleanup when a thread is deleted (store + every file). */
  async cleanup(userId: string, threadId: string): Promise<void> {
    const thread = await this.threads.get(userId, threadId);
    if (!thread?.vectorStoreId && !(thread?.files?.length)) return;
    const creds = await this.tryCreds(userId);
    if (!creds) return;
    if (thread?.vectorStoreId) await this.files.deleteVectorStore(creds, thread.vectorStoreId).catch(() => {});
    for (const f of thread?.files ?? []) await this.files.deleteFile(creds, f.fileId).catch(() => {});
  }

  private async tryCreds(userId: string): Promise<AoaiCreds | null> {
    try {
      return this.toCreds(await this.credentials.getDecrypted(userId));
    } catch {
      return null;
    }
  }

  private async waitForReady(
    creds: AoaiCreds,
    vectorStoreId: string,
    fileId: string,
    initial: VectorFileStatus,
  ): Promise<VectorFileStatus> {
    const sleep = this.opts.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    const pollMs = this.opts.pollMs ?? 1500;
    const maxPolls = this.opts.maxPolls ?? 12;
    let status = initial;
    for (let n = 0; status === 'indexing' && n < maxPolls; n++) {
      await sleep(pollMs);
      status = await this.files.fileStatus(creds, vectorStoreId, fileId).catch(() => status);
    }
    return status;
  }
}
